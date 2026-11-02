const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const { ChunkDownloader } = require("./ChunkDownloader");
const {
  validateUrl,
  validateHeaders,
  sanitizeFilename,
  getFilenameFromURL,
  categoryFor,
} = require("./utils");

const ACTIVE = new Set(["connecting", "downloading", "processing"]);
// Daily local-time window. Equal endpoints mean the full day, avoiding a
// configuration that could silently prevent every transfer forever.
function isWithinSchedule(settings, date = new Date()) {
  if (!settings.scheduleEnabled) return true;
  const start = settings.scheduleStartMinute ?? 0;
  const end = settings.scheduleEndMinute ?? 360;
  const now = date.getHours() * 60 + date.getMinutes();
  if (start === end) return true;
  return start < end ? now >= start && now < end : now >= start || now < end;
}
class DownloadManager extends EventEmitter {
  constructor({
    settings = {},
    downloadsRepo,
    tempPath = null,
    engineFactory,
    onProgress = () => {},
    onStatusChange = () => {},
    onComplete = () => {},
    onError = () => {},
  } = {}) {
    super();
    Object.assign(this, {
      settings,
      repo: downloadsRepo,
      tempPath,
      engineFactory,
      onProgress,
      onStatusChange,
      onComplete,
      onError,
    });
    this.items = new Map();
    this.running = new Map();
    this.queue = [];
    this.retryTimers = new Map();
    this.pendingProgress = new Map();
    this.progressDirty = new Set();
    this.progressTimer = null;
    this.persistenceTimer = null;
    this.scheduleTimer = null;
    this.stopped = false;
    this.reservationQueue = Promise.resolve();
  }
  snapshot() {
    this.emit("changed", this.getAll());
  }
  publicItem(item) {
    const { sessionHeaders, ...safe } = item;
    safe.headers = persistentHeaders(safe.headers);
    return safe;
  }
  persist(item) {
    this.progressDirty.delete(item.id);
    if (this.repo) Object.assign(item, this.repo.save(item, item));
  }
  queueProgress(id, progress) {
    this.pendingProgress.set(id, progress);
    this.progressDirty.add(id);
    if (!this.progressTimer) {
      this.progressTimer = setTimeout(() => this.flushProgress(), 150);
      this.progressTimer.unref?.();
    }
    if (!this.persistenceTimer) {
      this.persistenceTimer = setTimeout(() => this.flushPersistence(), 2000);
      this.persistenceTimer.unref?.();
    }
  }
  flushProgress() {
    clearTimeout(this.progressTimer);
    this.progressTimer = null;
    const pending = [...this.pendingProgress];
    this.pendingProgress.clear();
    for (const [id, progress] of pending) {
      if (!this.items.has(id)) continue;
      this.onProgress(id, progress);
      this.emit("progress", { id, ...progress });
    }
  }
  flushPersistence() {
    clearTimeout(this.persistenceTimer);
    this.persistenceTimer = null;
    for (const id of this.progressDirty) {
      const item = this.items.get(id);
      if (item) this.persist(item);
    }
    this.progressDirty.clear();
  }
  discardProgress(id) {
    this.pendingProgress.delete(id);
    this.progressDirty.delete(id);
  }
  async addDownload(input) {
    return this.add({ ...input, kind: "file" });
  }
  async addMedia(input) {
    return this.add({ ...input, kind: "media" });
  }
  async addTorrent(input) {
    return this.add({ ...input, url: input.torrent, kind: "torrent" });
  }
  async add(input) {
    if (!input?.url) throw new Error("A download URL is required.");
    const url =
      input.kind === "torrent"
        ? String(input.url).trim()
        : validateUrl(input.url);
    if (input.kind === "torrent" && !url.startsWith("magnet:?")) {
      const remoteTorrent =
        /^https?:\/\//i.test(url) && /\.torrent(?:$|[?#])/i.test(url);
      if (!remoteTorrent && !path.isAbsolute(url))
        throw new Error(
          "Choose a .torrent file, a .torrent link, or paste a magnet link.",
        );
      if (remoteTorrent) validateUrl(url);
    }
    const savePath = input.savePath || this.settings.defaultDownloadPath;
    if (!savePath || !path.isAbsolute(savePath))
      throw new Error("Choose a valid absolute destination folder.");
    await fs.mkdir(savePath, { recursive: true });
    await fs.access(savePath, fs.constants.W_OK);
    if (
      input.kind === "media" &&
      this.settings.organizeByType &&
      !input.savePath
    ) {
      input.savePath = path.join(
        savePath,
        input.media.type === "subtitle"
          ? "Subtitles"
          : input.media.audioOnly
            ? "Audio"
            : "Video",
      );
      await fs.mkdir(input.savePath, { recursive: true });
    }
    const requestHeaders = validateHeaders(input.headers);
    const sessionHeaders = Object.fromEntries(
      Object.entries(requestHeaders).filter(([key]) =>
        /cookie|session|authorization|credential/i.test(key),
      ),
    );
    const safeHeaders = Object.fromEntries(
      Object.entries(requestHeaders).filter(
        ([key]) => !/cookie|session|authorization|credential/i.test(key),
      ),
    );
    const item = {
      id: randomUUID(),
      url,
      filename: input.filename
        ? sanitizeFilename(input.filename)
        : input.kind === "torrent"
          ? "Waiting for torrent metadata"
          : getFilenameFromURL(url) || "download",
      filenameExplicit: !!input.filename,
      savePath: input.savePath || savePath,
      destinationExplicit: !!input.savePath,
      status: this.settings.autoStartDownloads === false ? "paused" : "queued",
      totalSize: 0,
      downloadedSize: 0,
      speed: 0,
      eta: null,
      attempt: 0,
      createdAt: new Date().toISOString(),
      kind: input.kind || "file",
      headers: safeHeaders,
      ...(Object.keys(sessionHeaders).length
        ? { sessionHeaders, sessionRequired: true }
        : {}),
      browserTransferId: input.browserTransferId || undefined,
      browserSource: input.browserSource || undefined,
      ...(input.kind === "media"
        ? {
            media: input.media,
            filename: input.media.title,
            category:
              input.media.type === "subtitle"
                ? "Documents"
                : input.media.audioOnly
                  ? "Audio"
                  : "Video",
          }
        : {}),
    };
    this.items.set(item.id, item);
    this.persist(item);
    this.emit("added", this.publicItem(item));
    this.snapshot();
    if (item.status === "queued") this.queue.push(item.id);
    this.pump();
    return item.id;
  }
  reserve(item, info) {
    const next = this.reservationQueue.then(() =>
      this.reserveTarget(item, info),
    );
    this.reservationQueue = next.catch(() => {});
    return next;
  }
  async reserveTarget(item, info) {
    if (!item.targetReserved) {
      let filename = sanitizeFilename(info.filename);
      const category = categoryFor(filename);
      if (this.settings.organizeByType && !item.destinationExplicit)
        item.savePath = path.join(item.savePath, category);
      await fs.mkdir(item.savePath, { recursive: true });
      const extension = path.extname(filename);
      const basename = path.basename(filename, extension);
      let counter = 0;
      while (true) {
        const occupied = [...this.items.values()].some(
          (other) =>
            other.id !== item.id &&
            other.targetReserved &&
            other.savePath === item.savePath &&
            other.filename === filename,
        );
        const exists = await fs.access(path.join(item.savePath, filename)).then(
          () => true,
          () => false,
        );
        if (!occupied && !exists) break;
        filename = `${basename} (${++counter})${extension}`;
      }
      item.filename = filename;
      item.filenameExplicit = true;
      item.targetReserved = true;
      item.category = category;
      this.persist(item);
    }
    return { filename: item.filename, savePath: item.savePath };
  }
  workPath(item) {
    return this.tempPath ? path.join(this.tempPath, item.id) : null;
  }
  createEngine(item) {
    const options = {
      ...item,
      headers: { ...(item.headers || {}), ...(item.sessionHeaders || {}) },
      timeout: (this.settings.requestTimeoutSeconds || 30) * 1000,
      connections: this.settings.maxConnectionsPerDownload || 8,
      speedLimit: this.settings.speedLimit || 0,
      tempPath: this.workPath(item),
      reserveTarget: (info) => this.reserve(item, info),
    };
    const engine =
      this.engineFactory?.(item, options) || new ChunkDownloader(options);
    engine.on("progress", (_id, progress) => {
      if (this.running.get(item.id) !== engine) return;
      Object.assign(item, progress);
      this.queueProgress(item.id, progress);
    });
    engine.on("status", (_id, status, data = {}) => {
      this.flushProgress();
      if (["failed", "cancelled"].includes(status)) this.burnSession(item);
      Object.assign(item, data, { status, speed: 0, eta: null });
      this.persist(item);
      this.onStatusChange(item.id, status, data);
      this.emit("status", { id: item.id, status, ...data });
      this.snapshot();
    });
    engine.on("complete", (_id, data) => {
      this.flushProgress();
      this.burnSession(item);
      Object.assign(item, data, {
        status: "completed",
        completedAt: item.completedAt || new Date().toISOString(),
        speed: 0,
        eta: null,
        error: null,
      });
      this.persist(item);
      this.onComplete(item.id, data);
      this.emit("complete", { id: item.id, ...data });
      this.snapshot();
    });
    engine.on("error", (_id, error) => {
      this.flushProgress();
      this.burnSession(item);
      item.error = error.message;
      item.errorCode = error.code || null;
      item.speed = 0;
      item.status = "failed";
      engine.failure = error;
      this.persist(item);
      this.onError(item.id, error);
      this.emit("download-error", {
        id: item.id,
        error: error.message,
        ...(error.code ? { code: error.code } : {}),
      });
      this.snapshot();
    });
    return engine;
  }
  pump() {
    if (this.stopped) return;
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
    if (this.queue.length && !isWithinSchedule(this.settings)) {
      // Recheck after clock changes or wake from sleep as well as at the next
      // minute. Running transfers are not interrupted by the window closing.
      this.scheduleTimer = setTimeout(() => this.pump(), 30000);
      this.scheduleTimer.unref?.();
      return;
    }
    const limit = Math.max(1, this.settings.maxConcurrentDownloads || 3);
    while (this.running.size < limit && this.queue.length) {
      const id = this.queue.shift();
      const item = this.items.get(id);
      if (!item || item.status !== "queued" || this.running.has(id)) continue;
      const engine = this.createEngine(item);
      this.running.set(id, engine);
      Promise.resolve(engine.start())
        .catch((error) => {
          item.status = "failed";
          item.error = error.message;
          this.persist(item);
          this.snapshot();
        })
        .finally(() => {
          if (this.running.get(id) !== engine) return;
          this.running.delete(id);
          if (
            !this.stopped &&
            item.status === "failed" &&
            !item.sessionRequired &&
            engine.failure?.retryable &&
            item.attempt < (this.settings.retryAttempts || 0)
          ) {
            item.attempt++;
            item.status = "retrying";
            item.retryAt =
              Date.now() +
              (this.settings.retryDelaySeconds || 3) * 1000 * item.attempt;
            this.persist(item);
            const timer = setTimeout(() => {
              this.retryTimers.delete(id);
              if (item.status === "retrying") this.enqueue(item);
            }, item.retryAt - Date.now());
            this.retryTimers.set(id, timer);
            this.snapshot();
          }
          this.pump();
        });
    }
  }
  requireItem(id) {
    const item = this.items.get(id);
    if (!item) throw new Error("This download no longer exists.");
    return item;
  }
  clearRetry(id) {
    clearTimeout(this.retryTimers.get(id));
    this.retryTimers.delete(id);
  }
  enqueue(item) {
    this.clearRetry(item.id);
    item.status = "queued";
    item.error = null;
    item.retryAt = null;
    item.speed = 0;
    if (!this.queue.includes(item.id)) this.queue.push(item.id);
    this.persist(item);
    this.snapshot();
    this.pump();
    return true;
  }
  async pause(id) {
    const item = this.requireItem(id);
    if (ACTIVE.has(item.status)) await this.running.get(id)?.pause();
    else if (["queued", "retrying"].includes(item.status)) {
      this.clearRetry(id);
      this.queue = this.queue.filter((value) => value !== id);
      item.status = "paused";
      item.speed = 0;
      item.eta = null;
      this.persist(item);
      this.snapshot();
    } else return false;
    return true;
  }
  resume(id) {
    const item = this.requireItem(id);
    if (item.sessionRequired && !item.sessionHeaders)
      throw new Error(
        "Session expired. Refresh this download from your browser to resume it.",
      );
    if (
      !["paused", "failed", "cancelled"].includes(item.status) ||
      this.running.has(id)
    )
      return false;
    item.attempt = 0;
    return this.enqueue(item);
  }
  retry(id) {
    return this.resume(id);
  }
  async cancel(id) {
    const item = this.requireItem(id);
    if (["completed", "cancelled"].includes(item.status)) return false;
    this.clearRetry(id);
    this.queue = this.queue.filter((value) => value !== id);
    const engine = this.running.get(id);
    if (engine) await engine.cancel();
    else {
      item.status = "cancelled";
      item.speed = 0;
      item.eta = null;
      this.burnSession(item);
      await this.cleanup(item);
      this.persist(item);
      this.snapshot();
    }
    return true;
  }
  async cleanup(item) {
    // Work files live outside the destination now. The destination scan keeps
    // older interrupted transfers (from builds that used hidden in-place
    // partials) removable without exposing them to the user.
    const names = await fs.readdir(item.savePath).catch(() => []);
    const prefix = `.getanny-${item.id}`;
    await Promise.all(
      names
        .filter(
          (name) =>
            name.startsWith(`${prefix}.`) ||
            name.startsWith(`.getanny-media-${item.id}`),
        )
        .map((name) => fs.rm(path.join(item.savePath, name), { force: true })),
    );
    if (this.tempPath)
      await fs
        .rm(path.join(this.tempPath, item.id), {
          recursive: true,
          force: true,
        })
        .catch(() => {});
  }
  async clearHistory({ scope = "all", ids = [], stopUnfinished = false } = {}) {
    const selected = new Set(ids.map(String));
    const historical = (item) =>
      ["completed", "failed", "cancelled"].includes(item.status);
    const targets = [...this.items.values()].filter((item) => {
      if (scope === "selected")
        return selected.has(item.id) && (historical(item) || stopUnfinished);
      if (scope === "completed") return item.status === "completed";
      if (scope === "failed") return item.status === "failed";
      // "Clear all history" never cancels work that is still in progress or
      // paused; those entries remain until the user acts on them explicitly.
      return historical(item);
    });
    for (const item of targets) {
      if (["queued", "retrying"].includes(item.status)) {
        this.clearRetry(item.id);
        this.queue = this.queue.filter((value) => value !== item.id);
      }
      if (["completed", "cancelled", "failed"].includes(item.status))
        await this.cleanup(item);
      else await this.remove(item.id);
      this.discardProgress(item.id);
      this.items.delete(item.id);
      this.repo?.remove(item.id);
    }
    this.snapshot();
    return targets.length;
  }
  async remove(id, deleteFile = false) {
    const item = this.requireItem(id);
    if (item.status !== "completed") await this.cancel(id);
    await this.cleanup(item);
    if (deleteFile && item.filePath && item.kind !== "torrent")
      await fs.rm(item.filePath, { force: true });
    this.discardProgress(id);
    this.items.delete(id);
    this.repo?.remove(id);
    this.snapshot();
    return true;
  }
  async clearCompleted() {
    const ids = [...this.items.values()]
      .filter((item) => item.status === "completed")
      .map((item) => item.id);
    for (const id of ids) {
      this.discardProgress(id);
      this.items.delete(id);
      this.repo?.remove(id);
    }
    this.snapshot();
    return ids.length;
  }
  async restoreDownloads() {
    for (const saved of this.repo?.getAll() || []) {
      const hadPersistedSession = Object.keys(saved.headers || {}).some((key) =>
        /cookie|session|authorization|credential/i.test(key),
      );
      const item = {
        ...saved,
        headers: persistentHeaders(saved.headers),
        sessionRequired: !!saved.sessionRequired || hadPersistedSession,
        speed: 0,
        eta: null,
      };
      const scheduledQueue =
        this.settings.scheduleEnabled && item.status === "queued";
      if (
        ACTIVE.has(item.status) ||
        (!scheduledQueue &&
          ["queued", "pending", "retrying"].includes(item.status))
      )
        item.status = "paused";
      if (
        item.sessionRequired &&
        !["completed", "failed", "cancelled"].includes(item.status)
      ) {
        item.status = "paused";
        item.error =
          "Session expired. Refresh this download from your browser to resume it.";
      }
      this.items.set(item.id, item);
      this.persist(item);
      if (
        !item.sessionRequired &&
        (scheduledQueue ||
          (this.settings.resumeOnStartup && item.status === "paused"))
      )
        this.queue.push(item.id);
    }
    if (this.settings.resumeOnStartup)
      for (const id of this.queue) this.items.get(id).status = "queued";
    this.pump();
  }
  updateSettings(settings) {
    this.settings = { ...settings };
    this.pump();
  }
  async shutdown() {
    this.stopped = true;
    this.flushProgress();
    this.flushPersistence();
    clearTimeout(this.scheduleTimer);
    this.scheduleTimer = null;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    await Promise.all(
      [...this.running.values()].map((engine) => engine.pause()),
    );
    for (const item of this.items.values())
      if (["queued", "retrying"].includes(item.status)) {
        // Preserve scheduled queue entries across clean restarts. Retry timers
        // are not durable and remain paused rather than being silently reset.
        if (item.status === "queued" && this.settings.scheduleEnabled) {
          this.persist(item);
          continue;
        }
        item.status = "paused";
        item.speed = 0;
        this.persist(item);
      }
    for (const item of this.items.values()) this.burnSession(item);
    this.running.clear();
  }
  getAll() {
    return [...this.items.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((item) => this.publicItem(item));
  }
  burnSession(item) {
    if (!item?.sessionHeaders) return;
    for (const key of Object.keys(item.sessionHeaders))
      item.sessionHeaders[key] = "";
    delete item.sessionHeaders;
    item.sessionRequired = true;
    this.persist(item);
  }
}
function persistentHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).filter(
      ([key]) => !/cookie|session|authorization|credential/i.test(key),
    ),
  );
}
module.exports = { DownloadManager, ACTIVE, isWithinSchedule };
