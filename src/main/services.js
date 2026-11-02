const { EventEmitter } = require("node:events");
const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { Database } = require("./database/database");
const { DownloadsRepo } = require("./database/downloads-repo");
const { SettingsRepo } = require("./database/settings-repo");
const { SettingsService } = require("./settings/SettingsService");
const { DownloadManager } = require("./engine/DownloadManager");
const { TorrentEngine } = require("./engine/TorrentEngine");
const { MediaEngine } = require("./media/MediaEngine");
const { MediaDetector } = require("./media/MediaDetector");
const { PreviewService } = require("./previews/PreviewService");
const { WebSocketServer } = require("./browser-integration/WebSocketServer");
const { BrowserDetector } = require("./browser-integration/BrowserDetector");
const {
  ExtensionInstaller,
} = require("./browser-integration/ExtensionInstaller");
const {
  NativeMessagingHost,
} = require("./browser-integration/NativeMessagingHost");
const { getBridgeIdentity } = require("./browser-integration/BridgeIdentity");
const { validateUrl } = require("./engine/utils");
const themes = require("../shared/themes.json");

// The browser extension mirrors the desktop palette, so the bridge sends the
// resolved tokens rather than a theme name the extension cannot resolve.
function themePayload(id) {
  const theme =
    themes.find((item) => item.id === id) ||
    themes.find((item) => item.id === "nord") ||
    themes[0];
  return {
    id: theme.id,
    name: theme.name,
    mode: theme.mode,
    colors: theme.colors,
  };
}

async function createServices({
  userDataPath,
  downloadPath,
  binPath,
  extensionPath,
  appPath = process.execPath,
  isPackaged = false,
  isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  nativeImage = null,
  getFileIcon = null,
  port = 29615,
  onSettingChange = async () => {},
  onBrowserRequest = () => {},
  startTransfers = true,
}) {
  const events = new EventEmitter();
  const db = new Database(userDataPath);
  await db.initialize();
  const downloadsRepo = new DownloadsRepo(db);
  const settingsRepo = new SettingsRepo(db);
  const settings = new SettingsService({
    repo: settingsRepo,
    downloadPath,
    onChange: async (key, value) => {
      await onSettingChange(key, value);
      if (key === "browserIntegrationEnabled") wsServer?.setEnabled(value);
      if (key === "theme") wsServer?.setTheme(themePayload(value));
      manager?.updateSettings({ ...settings.getAll(), [key]: value });
      events.emit("event", "settings:changed", {
        ...settings.getAll(),
        [key]: value,
      });
    },
  });
  const mediaDetector = new MediaDetector({ binPath });
  const previews = new PreviewService({
    userDataPath,
    binPath,
    nativeImage,
    getFileIcon,
  });
  let manager, wsServer;
  manager = new DownloadManager({
    settings: settings.getAll(),
    downloadsRepo,
    tempPath: path.join(userDataPath, "transfer-temp"),
    engineFactory: (item, options) => {
      if (item.kind === "media")
        return new MediaEngine(options, mediaDetector.ytdlp);
      if (item.kind === "torrent") return new TorrentEngine(options);
      return null;
    },
  });
  for (const [event, channel] of [
    ["changed", "downloads:changed"],
    ["added", "download:added"],
    ["progress", "download:progress"],
    ["status", "download:status"],
    ["complete", "download:complete"],
    ["download-error", "download:error"],
  ])
    manager.on(event, (data) => events.emit("event", channel, data));
  const identity = await getBridgeIdentity(userDataPath);
  const browserDetector = new BrowserDetector({ userDataPath });
  const extensionInstaller = new ExtensionInstaller({
    userDataPath,
    extensionPath,
    clientTokens: identity.clientTokens,
    port,
  });
  const pendingBrowserRequests = [];
  const recentBrowserRequests = new Map();
  async function processBrowserRequest(request, { sessionId }) {
    request.url = validateUrl(request.url);
    if (request.kind === "media" && !settings.get("mediaIntegration"))
      throw new Error(
        "Media-page integration is disabled in GetANNY settings.",
      );
    const dedupeKey = request.transferId
      ? `${request.source}:${request.transferId}`
      : null;
    if (dedupeKey) {
      const existing = manager
        .getAll()
        .find(
          (item) =>
            item.browserSource === request.source &&
            item.browserTransferId === request.transferId,
        );
      if (existing) return { action: "queued", id: existing.id };
    }
    if (dedupeKey && recentBrowserRequests.has(dedupeKey))
      return recentBrowserRequests.get(dedupeKey);
    const operation = (async () => {
      // Media pages need a format choice, so they open in Media studio. File
      // handoffs are always taken over and started automatically: making the
      // user revisit GetANNY to press Start leaves the browser in charge and
      // defeats the point of the integration.
      if (request.kind === "media") {
        const existing = request.transferId
          ? pendingBrowserRequests.find(
              (item) =>
                item.source === request.source &&
                item.transferId === request.transferId,
            )
          : null;
        if (existing) {
          existing.sessionId = sessionId;
          return { action: "review", pendingId: existing.id };
        }
        if (pendingBrowserRequests.length >= 20)
          throw new Error(
            "Too many unreviewed browser requests. Review the pending requests in GetANNY first.",
          );
        const review = {
          ...request,
          sessionId,
          id: randomUUID(),
          createdAt: Date.now(),
        };
        pendingBrowserRequests.push(review);
        // A UI delivery/focus failure must not turn an already-recorded
        // review into a rejection that resumes the browser copy.
        try {
          events.emit("event", "browser:request", review);
        } catch {
          // The pending request remains available through bootstrap.
        }
        try {
          onBrowserRequest(review);
        } catch {
          // Window focus is best effort, not an ownership decision.
        }
        return { action: "analyze", pendingId: review.id };
      }
      const id = await manager.addDownload({
        url: request.url,
        filename: request.filename,
        headers: request.headers,
        browserTransferId: request.transferId || undefined,
        browserSource: request.source,
      });
      // Accepted automatic handoffs should be visible just like reviews.
      // The transfer has already been persisted, so a UI notification error
      // must not turn acceptance into a browser-side resume/duplicate.
      try {
        onBrowserRequest(request);
      } catch {
        // Window focus is best effort; it does not affect transfer ownership.
      }
      return { action: "queued", id };
    })();
    if (dedupeKey) {
      recentBrowserRequests.set(dedupeKey, operation);
      if (recentBrowserRequests.size > 100)
        recentBrowserRequests.delete(recentBrowserRequests.keys().next().value);
      operation.catch(() => recentBrowserRequests.delete(dedupeKey));
    }
    return operation;
  }
  wsServer = new WebSocketServer({
    port,
    nativeToken: identity.nativeToken,
    recoveryToken: identity.recoveryToken,
    clientTokens: identity.clientTokens,
    enabled: settings.get("browserIntegrationEnabled"),
    theme: themePayload(settings.get("theme")),
    onDownloadRequest: processBrowserRequest,
    onDownloadStatus: async ({ transferId, source }, { sessionId }) => {
      const review = pendingBrowserRequests.find(
        (item) => item.source === source && item.transferId === transferId,
      );
      if (review) {
        review.sessionId = sessionId;
        return { action: "review", pendingId: review.id };
      }
      const item = manager
        .getAll()
        .find(
          (item) =>
            item.browserSource === source &&
            item.browserTransferId === transferId,
        );
      return item ? { action: "queued", id: item.id } : { action: "missing" };
    },
    onHello: (session) => {
      const evidence = settingsRepo.get("integrationEvidence") || {};
      evidence[session.browserId] = {
        lastSeen: Date.now(),
        version: session.version,
        transport: session.transport,
      };
      settingsRepo.set("integrationEvidence", evidence);
      // A verified handshake is the completion signal for first-time setup, so
      // later launches open the library instead of the welcome screen.
      if (!settings.get("firstRunCompleted"))
        settings.set("firstRunCompleted", true).catch(() => {});
      events.emit("event", "browser:changed", wsServer.status());
    },
  });
  await new Promise((resolve) => {
    if (wsServer.server.address() || wsServer.error) resolve();
    else {
      wsServer.server.once("listening", resolve);
      wsServer.server.once("error", resolve);
    }
  });
  const nativeMessagingHost = new NativeMessagingHost({
    userDataPath,
    appPath,
    isPackaged,
    binPath,
    token: identity.nativeToken,
    port: wsServer.status().port,
  });
  if (!startTransfers) manager.stopped = true;
  else await manager.restoreDownloads();
  function takeBrowserRequest(id) {
    const index = pendingBrowserRequests.findIndex(
      (request) => request.id === id,
    );
    if (index < 0) return null;
    return pendingBrowserRequests.splice(index, 1)[0];
  }
  async function ackBrowserRequest(id) {
    const request = takeBrowserRequest(id);
    if (!request) return { found: false };
    if (request.intercepted && request.transferId) {
      const result = await wsServer.downloadCommand(
        request.sessionId,
        "resume",
        request.transferId,
      );
      return { found: true, resumed: result.success === true };
    }
    return { found: true };
  }
  async function commitBrowserRequest(id, downloadId) {
    const request = pendingBrowserRequests.find((request) => request.id === id);
    if (!request) return { found: false };
    if (request.intercepted && request.transferId) {
      if (!downloadId)
        throw new Error(
          "A matching desktop download is required before browser handoff.",
        );
      const item = manager.requireItem(downloadId);
      if (
        item.kind !== "file" ||
        item.browserTransferId !== request.transferId ||
        item.browserSource !== request.source ||
        item.url !== request.url
      )
        throw new Error(
          "The desktop download does not match this browser request.",
        );
    } else if (downloadId) manager.requireItem(downloadId);
    takeBrowserRequest(id);
    if (request.intercepted && request.transferId) {
      const result = await wsServer.downloadCommand(
        request.sessionId,
        "cancel",
        request.transferId,
      );
      return { found: true, cancelled: result.success === true };
    }
    return { found: true, cancelled: true };
  }
  async function browserStatus() {
    const websocket = wsServer.status();
    const evidence = settingsRepo.get("integrationEvidence") || {};
    const detected = await browserDetector.detect();
    const browsers = await Promise.all(
      detected.map(async (browser) => {
        const [prepared, host] = await Promise.all([
          extensionInstaller.check(browser.id),
          nativeMessagingHost.check(browser.id),
        ]);
        const session = websocket.sessions.find(
          (value) => value.browserId === browser.id,
        );
        return {
          ...browser,
          prepared: prepared.prepared,
          directProvisioned: prepared.directProvisioned,
          packagePath: prepared.path,
          registered: host.registered,
          nativeManifestPath: host.path,
          connected: !!session,
          extensionInstalled: session ? true : null,
          extensionEnabled: session ? true : null,
          transport: session?.transport || null,
          lastSeen: session?.lastSeen || evidence[browser.id]?.lastSeen || null,
        };
      }),
    );
    return { websocket, browsers };
  }
  async function prepareBrowser(id, onProgress = async () => {}) {
    if (isPortable)
      throw new Error(
        "The portable launcher uses temporary files and cannot keep a stable provisioned extension credential. Use the installed app, or load a release extension and enter its recovery key while GetANNY is running.",
      );
    await onProgress("extension-prepare", { browserId: id });
    const extension = await extensionInstaller.install(id);
    await onProgress("native-register", { browserId: id });
    try {
      const host = await nativeMessagingHost.register(id);
      return {
        ...extension,
        registered: host.registered,
        nativeManifestPath: host.path,
        hostPath: host.hostPath,
        instructions: extension.instructions,
      };
    } catch (error) {
      // The provisioned WebSocket is the primary transport. Native messaging
      // remains a cold-start/bootstrap adapter, so its failure must be visible
      // without invalidating a working direct package.
      await onProgress("native-warning", {
        browserId: id,
        error: error.message,
      });
      return {
        ...extension,
        registered: false,
        nativeError: error.message,
        instructions: extension.instructions,
      };
    }
  }
  async function setupInstalledBrowsers(onProgress = async () => {}) {
    const result = [];
    await onProgress("browser-detect");
    const detected = await browserDetector.detect();
    await onProgress("browser-detected", {
      installed: detected
        .filter((browser) => browser.installed)
        .map((browser) => browser.id),
    });
    // Registration used to be gated on executable detection. A missed custom
    // path therefore made both installers report success while writing no host
    // or usable fallback for that browser. Preparing all supported adapters is
    // deterministic, harmless for absent browsers and also covers browsers
    // installed after GetANNY.
    for (const browser of detected) {
      try {
        result.push({
          browserId: browser.id,
          browserDetected: browser.installed,
          ...(await prepareBrowser(browser.id, onProgress)),
        });
        await onProgress("browser-prepared", { browserId: browser.id });
      } catch (error) {
        result.push({
          browserId: browser.id,
          browserDetected: browser.installed,
          error: error.message,
        });
        await onProgress("browser-error", {
          browserId: browser.id,
          error: error.message,
        });
      }
    }
    await onProgress("write-setup-report");
    await fs.writeFile(
      path.join(userDataPath, "browser-setup-report.json"),
      JSON.stringify(result, null, 2),
    );
    return result;
  }
  return {
    events,
    db,
    manager,
    downloadsRepo,
    settings,
    settingsRepo,
    mediaDetector,
    previews,
    wsServer,
    browserDetector,
    extensionInstaller,
    nativeMessagingHost,
    identity,
    pendingBrowserRequests,
    browserStatus,
    ackBrowserRequest,
    commitBrowserRequest,
    prepareBrowser,
    setupInstalledBrowsers,
    async close() {
      await previews.close();
      // A reviewed native transfer is still paused in the browser. On clean
      // shutdown, explicitly return those reviews instead of stranding them.
      await Promise.all(
        pendingBrowserRequests
          .filter((request) => request.intercepted && request.transferId)
          .map((request) =>
            wsServer.downloadCommand(
              request.sessionId,
              "resume",
              request.transferId,
            ),
          ),
      );
      await wsServer.close();
      await manager.shutdown();
      db.close();
    },
  };
}
module.exports = { createServices };
