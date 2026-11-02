/* Browser download handoff. Loaded before background.js in both extension families. */
(() => {
  const validUrl = (value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  };
  const filename = (item, url) => {
    // Chrome normally supplies an absolute path; Firefox may supply a name.
    const nativeName = String(item.filename || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1);
    if (nativeName) return nativeName;
    // Do not make a URL segment authoritative: Content-Disposition may still
    // provide a better name in the desktop engine.
    return undefined;
  };

  class GetANNYDownloadInterceptor {
    constructor({ api, request, onError = () => {} }) {
      this.api = api;
      this.request = request;
      this.onError = onError;
      this.entries = new Map();
      this.session = api.storage?.session;
      this.saveQueue = Promise.resolve();
      this.ready = Promise.resolve();
      this.listener = (item) => this.created(item).catch(this.onError);
    }

    start() {
      // MV3 service workers can be suspended between pausing a browser item
      // and receiving the desktop acknowledgement. Session storage survives a
      // worker restart, but is cleared by the browser between browser sessions.
      this.ready = this.restore();
      this.api.downloads?.onCreated.addListener(this.listener);
    }

    async save() {
      if (!this.session) return;
      const entries = [...this.entries.values()].map((entry) => ({ ...entry }));
      const write = this.saveQueue
        .catch(() => {})
        .then(() => this.session.set({ getannyHandoffs: entries }));
      this.saveQueue = write;
      await write;
    }

    async restore() {
      if (!this.session) return;
      const stored = await this.session.get("getannyHandoffs");
      for (const entry of Array.isArray(stored.getannyHandoffs)
        ? stored.getannyHandoffs
        : []) {
        if (
          !Number.isInteger(entry.downloadId) ||
          typeof entry.transferId !== "string"
        )
          continue;
        this.entries.set(entry.transferId, entry);
        if (!entry.requestStarted) {
          // A worker may die just after pause() but before recording it. Ask
          // the browser rather than assuming the item is still running.
          const matches = await this.api.downloads.search({
            id: entry.downloadId,
          });
          if (matches[0]?.state === "in_progress" && matches[0]?.paused) {
            entry.paused = true;
            if (!(await this.resumeEntry(entry))) {
              entry.stage = "restore-resume";
              continue;
            }
          }
          this.entries.delete(entry.transferId);
        }
      }
      await this.save();
    }

    stop() {
      this.api.downloads?.onCreated.removeListener(this.listener);
    }

    entry(id) {
      // Browser download IDs can be reused in another profile or after a
      // browser restart. They are not suitable as persistent desktop IDs.
      const existing = [...this.entries.values()].find(
        (entry) => entry.downloadId === id,
      );
      if (existing) return existing;
      const entry = {
        downloadId: id,
        transferId: crypto.randomUUID(),
        paused: false,
        stage: "preparing",
        requestStarted: false,
      };
      this.entries.set(entry.transferId, entry);
      return entry;
    }

    async pause(entry) {
      try {
        await this.api.downloads.pause(entry.downloadId);
        entry.paused = true;
      } catch (error) {
        // A short, completed, or non-resumable native transfer cannot be handed
        // off without risking two active copies. Keep it in the browser.
        entry.paused = false;
        entry.pauseError = error.message;
        throw new Error(
          `GetANNY left this download in the browser: ${error.message}`,
        );
      }
    }

    async metadata(item, url) {
      const headers = {};
      if (item.referrer && validUrl(item.referrer))
        headers.Referer = item.referrer;
      if (globalThis.navigator?.userAgent)
        headers["User-Agent"] = globalThis.navigator.userAgent;
      const cookiePreference = await this.api.storage.local.get([
        "includeSiteCookies",
      ]);
      // Cloud/private downloads need this by default. Only an explicit opt-out
      // disables forwarding, and the choice persists between popup sessions.
      const siteCookies = cookiePreference.includeSiteCookies !== false;
      if (siteCookies && this.api.cookies?.getAll) {
        try {
          // Firefox containers and other cookie stores must not silently use
          // a different account's default-store cookies.
          const query = { url };
          if (item.cookieStoreId) query.storeId = item.cookieStoreId;
          const cookies = await this.api.cookies.getAll(query);
          if (cookies.length)
            headers.Cookie = cookies
              .map((cookie) => `${cookie.name}=${cookie.value}`)
              .join("; ");
        } catch {
          // Cookie access can be unavailable in private or restricted contexts.
          // The browser remains the fallback if the desktop rejects the request.
        }
      }
      return { headers, siteCookies };
    }

    async created(item) {
      await this.ready;
      const id = Number(item?.id);
      const url = validUrl(item?.finalUrl) ? item.finalUrl : item?.url;
      // Private downloads stay native: the downloads API does not provide a
      // reliable cookie-store identity for a safe desktop handoff.
      if (
        !Number.isInteger(id) ||
        id < 0 ||
        [...this.entries.values()].some((entry) => entry.downloadId === id) ||
        item.byExtensionId === this.api.runtime.id ||
        item.incognito === true ||
        !validUrl(url) ||
        (item.state && item.state !== "in_progress")
      )
        return;
      const entry = this.entry(id);
      try {
        // Save the identity before pausing, so a restarted worker can return
        // an unsent request to the browser without guessing ownership.
        await this.save();
        await this.pause(entry);
        await this.save();
        const { headers, siteCookies } = await this.metadata(item, url);
        if (entry.connectionLost)
          throw new Error("Desktop disconnected before the handoff began.");
        entry.requestStarted = true;
        await this.save();
        const result = await this.request({
          type: "download",
          kind: "file",
          url,
          filename: filename(item, url),
          headers,
          includeSiteCookies: siteCookies,
          mimeType: item.mime || item.mimeType || null,
          intercepted: true,
          transferId: entry.transferId,
        });
        if (result.action === "queued") {
          entry.desktopQueued = true;
          await this.save();
          await this.cancel(entry.transferId);
          this.entries.delete(entry.transferId);
          await this.save();
        } else if (result.action === "review") {
          // Keep the browser copy paused while the user reviews it in GetANNY.
          entry.stage = "review";
          await this.save();
        } else {
          throw new Error("GetANNY returned an unsupported handoff response.");
        }
      } catch (error) {
        if (entry.desktopQueued) {
          // GetANNY owns the transfer now. Never resume the native copy; retain
          // this entry so a later reconciliation can retry native cleanup.
          entry.stage = entry.stage === "cancelling" ? "cancelling" : "cleanup";
        } else if (entry.requestStarted && error.ambiguous) {
          entry.stage = "reconcile";
        } else {
          const resumed = await this.resumeEntry(entry);
          if (entry.paused && !resumed) entry.stage = "restore-resume";
          else this.entries.delete(entry.transferId);
        }
        await this.save().catch((failure) => this.onError(failure));
        this.onError(error);
      }
    }

    async cancel(transferId) {
      const entry = this.entries.get(String(transferId));
      if (!entry) throw new Error("Browser transfer is no longer available.");
      const id = entry.downloadId;
      if (entry?.stage !== "cancelling") {
        try {
          await this.api.downloads.cancel(id);
        } catch (error) {
          if (!this.api.downloads.search) throw error;
          const matches = await this.api.downloads.search({ id });
          if (matches[0]?.state === "in_progress") throw error;
        }
        entry.stage = "cancelling";
        await this.save();
      }
      // Remove only the browser history entry. Never delete an unknown file.
      await this.api.downloads.erase({ id });
      if (entry) entry.stage = "transferred";
    }

    async resumeEntry(entry) {
      if (!entry?.paused) return false;
      try {
        await this.api.downloads.resume(entry.downloadId);
        entry.paused = false;
        entry.stage = "browser";
        return true;
      } catch {
        // It may already have finished or been removed by the browser user.
        return false;
      }
    }

    async resume(transferId) {
      const entry = this.entries.get(String(transferId));
      const resumed = await this.resumeEntry(entry);
      if (entry?.paused && !resumed) return false;
      this.entries.delete(String(transferId));
      await this.save();
      return resumed;
    }

    async command(message) {
      await this.ready;
      const transferId = String(message.transferId || "");
      if (!this.entries.has(transferId)) {
        // Commands are idempotent after a worker restart or duplicate response.
        return { success: true, missing: true };
      }
      if (message.action === "cancel") {
        await this.cancel(transferId);
        this.entries.delete(transferId);
        await this.save();
        return { success: true };
      }
      if (message.action === "resume") {
        const resumed = await this.resume(transferId);
        return { success: resumed };
      }
      throw new Error("Unsupported browser download command.");
    }

    async reconnect() {
      await this.ready;
      // Resolve the ambiguous period where the desktop may have persisted a
      // request just before its transport disconnected.
      for (const entry of [...this.entries.values()]) {
        if (entry.stage === "restore-resume") {
          await this.resume(entry.transferId);
          continue;
        }
        if (!entry.requestStarted || entry.stage === "transferred") continue;
        try {
          const result = await this.request({
            type: "download-status",
            transferId: entry.transferId,
          });
          if (result.action === "queued") {
            await this.cancel(entry.transferId);
            this.entries.delete(entry.transferId);
            await this.save();
          } else if (result.action === "review") {
            entry.stage = "review";
            await this.save();
          } else if (result.action === "missing") {
            // The desktop did not persist the request, regardless of whether it
            // was awaiting review or an acknowledgement when disconnected.
            await this.resume(entry.transferId);
          }
        } catch {
          // Keep paused until the next reconciliation rather than risking two
          // simultaneous downloads. Initial connection failures resume directly.
        }
      }
    }

    async disconnected() {
      await this.ready;
      // Requests not yet sent can safely return to the browser. Reviews and
      // ambiguous in-flight requests remain paused: the desktop may still be
      // actionable or may have persisted the transfer. Reconnection, dismissal,
      // or clean desktop shutdown resolves them without creating two copies.
      // Do not resume concurrently with pause() or metadata(): that can race
      // with the original handler and create two transfers or strand a pause.
      // The active handler checks this flag before it sends anything.
      for (const entry of this.entries.values())
        if (!entry.requestStarted) entry.connectionLost = true;
      await this.save();
    }
  }

  globalThis.GetANNYDownloadInterceptor = GetANNYDownloadInterceptor;
})();
