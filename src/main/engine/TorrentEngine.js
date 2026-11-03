const { EventEmitter } = require("node:events");
const path = require("node:path");
const fs = require("node:fs/promises");
const { sanitizeFilename } = require("./utils");

// Older builds nested every torrent inside "Torrent [<uuid>]". Recognise that
// shape so existing entries migrate to a human-readable location.
const LEGACY_FOLDER =
  /^Torrent \[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i;

function connectionTarget(connections = 8, activeTransfers = 3) {
  const perDownload = Number.isFinite(connections) ? connections : 8;
  const concurrent = Number.isFinite(activeTransfers) ? activeTransfers : 3;
  return Math.max(
    20,
    Math.min(120, Math.floor(300 / Math.max(1, concurrent)), perDownload * 13),
  );
}

function supplementalTrackers(url, trackers = []) {
  if (!url.startsWith("magnet:")) return trackers;
  return trackers.length && new URL(url).searchParams.getAll("tr").length < 3
    ? trackers
    : [];
}

// Per-download client makes pause stop sockets/uploads, and bandwidth settings
// unambiguous. Resume rechecks pieces on disk instead of trusting saved progress.
class TorrentEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    Object.assign(this, options);
    this.status = "queued";
  }
  setStatus(status, data = {}) {
    this.status = status;
    this.emit("status", this.id, status, { speed: 0, ...data });
  }
  start() {
    if (!this.task) this.task = this.run();
    return this.task;
  }
  destinationName() {
    // Torrent names are arbitrary Unicode from the swarm. Strip only what
    // Windows cannot store, never replace it with an internal identifier.
    return sanitizeFilename(this.torrent?.name || "torrent");
  }
  async uniqueTarget(name) {
    const extension = path.extname(name);
    const basename = path.basename(name, extension);
    let candidate = path.join(this.savePath, name);
    let counter = 0;
    while (
      await fs.access(candidate).then(
        () => true,
        () => false,
      )
    )
      candidate = path.join(
        this.savePath,
        `${basename} (${++counter})${extension}`,
      );
    return candidate;
  }
  async publish(source, target) {
    await fs.mkdir(this.savePath, { recursive: true });
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      if (!["EXDEV", "EPERM", "EACCES"].includes(error.code)) throw error;
    }
    await fs.cp(source, target, { recursive: true, errorOnExist: true });
    await fs.rm(source, { recursive: true, force: true });
  }
  resolveSavePath() {
    // Destination collection folder. The visible folder inside it is always
    // the torrent's own name, never a UUID.
    this.savePath = this.savePath || this.basePath;
    if (LEGACY_FOLDER.test(path.basename(this.savePath)))
      this.savePath = path.dirname(this.savePath);
    return this.savePath;
  }
  async run() {
    let ticker, timeout, ramp;
    try {
      this.resolveSavePath();
      // Work data stays out of the destination until every piece is verified.
      this.workPath =
        this.tempPath || path.join(this.savePath, ".getanny-torrent");
      await fs.mkdir(this.workPath, { recursive: true });
      this.setStatus("connecting", {
        phase: "Finding torrent metadata",
        savePath: this.savePath,
      });
      const WebTorrent =
        this.WebTorrentClass || (await import("webtorrent")).default;
      if (this.wantedState) return;
      const targetConnections = connectionTarget(
        this.connections,
        this.maxConcurrentDownloads,
      );
      this.client = new WebTorrent({
        downloadLimit: this.speedLimit || -1,
        uploadLimit: 128 * 1024,
        maxConns: Math.min(40, targetConnections),
      });
      ramp = setInterval(() => {
        if (!this.client || this.client.destroyed) return;
        this.client.maxConns = Math.min(
          targetConnections,
          this.client.maxConns + 20,
        );
        if (this.client.maxConns >= targetConnections) {
          clearInterval(ramp);
          ramp = null;
        }
      }, 5000);
      ramp.unref?.();
      await new Promise((resolve, reject) => {
        this.finish = resolve;
        this.client.once("error", reject);
        const trackerList = this.getTrackers?.() || [];
        const announce = supplementalTrackers(this.url, trackerList);
        const torrent = this.client.add(this.url, {
          path: this.workPath,
          announce,
          strategy: "rarest",
        });
        this.torrent = torrent;
        const trackerSuccess = new Map();
        const startedAt = Date.now();
        let trackerCount = announce.length;
        torrent.once("ready", () => {
          const tracker = torrent.discovery?.tracker;
          trackerCount = torrent.discovery?._announce?.length || trackerCount;
          tracker?.on("update", (data = {}) => {
            const url = data.announce || data.announceUrl;
            if (url) trackerSuccess.set(url, Date.now());
          });
        });
        torrent.once("error", reject);
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                "No torrent metadata received within 90 seconds. Check the magnet link, peers and network.",
              ),
            ),
          90000,
        );
        torrent.once("ready", () => {
          clearTimeout(timeout);
          this.setStatus("downloading", {
            filename: torrent.name,
            totalSize: torrent.length,
            phase: "Downloading verified pieces",
          });
        });
        ticker = setInterval(() => {
          this.emit("progress", this.id, {
            downloadedSize: torrent.downloaded || 0,
            totalSize: torrent.length || 0,
            speed: torrent.downloadSpeed || 0,
            uploadSpeed: torrent.uploadSpeed || 0,
            eta: Number.isFinite(torrent.timeRemaining)
              ? torrent.timeRemaining / 1000
              : null,
            peers: torrent.numPeers || 0,
            seeds: (torrent.wires || []).filter((wire) => wire.isSeeder).length,
            connectedTrackers: [...trackerSuccess.values()].filter(
              (time) => Date.now() - time < 30 * 60 * 1000,
            ).length,
            trackerCount,
            trackerWarning:
              Date.now() - startedAt > 45_000 &&
              (!trackerCount || trackerSuccess.size === 0),
          });
        }, 500);
        torrent.once("done", resolve);
      });
      if (this.wantedState) {
        this.setStatus(this.wantedState);
        return;
      }
      if (!this.torrent.done || this.torrent.downloaded < this.torrent.length)
        throw new Error("The torrent stopped before all pieces were verified.");
      const name = this.destinationName();
      const source = path.join(this.workPath, this.torrent.name);
      const target = await this.uniqueTarget(name);
      this.setStatus("processing", { phase: "Publishing torrent files" });
      await this.publish(source, target);
      await fs
        .rm(this.workPath, { recursive: true, force: true })
        .catch(() => {});
      const stat = await fs.stat(target);
      const data = {
        filename: path.basename(target),
        totalSize: this.torrent.length,
        downloadedSize: this.torrent.length,
        filePath: target,
        savePath: this.savePath,
        ...(stat.isDirectory() ? {} : { totalSize: stat.size }),
      };
      this.setStatus("completed");
      this.emit("complete", this.id, data);
    } catch (error) {
      if (this.wantedState) this.setStatus(this.wantedState);
      else {
        this.setStatus("failed", { error: error.message });
        this.emit("error", this.id, error);
      }
    } finally {
      clearInterval(ticker);
      clearInterval(ramp);
      clearTimeout(timeout);
      await this.destroyClient();
      if (this.wantedState && this.status !== this.wantedState)
        this.setStatus(this.wantedState);
    }
  }
  async destroyClient() {
    if (this.client && !this.client.destroyed)
      await new Promise((resolve) => this.client.destroy(resolve));
  }
  async stop(status) {
    if (["completed", "failed", "cancelled"].includes(this.status))
      return false;
    this.wantedState = status;
    this.finish?.();
    await this.destroyClient();
    await this.task;
    if (status === "cancelled" && this.workPath)
      await fs
        .rm(this.workPath, { recursive: true, force: true })
        .catch(() => {});
    this.setStatus(status);
    return true;
  }
  pause() {
    return this.stop("paused");
  }
  cancel() {
    return this.stop("cancelled");
  }
}
module.exports = {
  TorrentEngine,
  LEGACY_FOLDER,
  connectionTarget,
  supplementalTrackers,
};
