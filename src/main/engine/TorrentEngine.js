"use strict";

const { EventEmitter } = require("node:events");
const path = require("node:path");
const fs = require("node:fs/promises");
const { sanitizeFilename } = require("./utils");

const LEGACY_FOLDER =
  /^Torrent \[[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\]$/i;
const MAX_PEERS = 200;
const METADATA_TIMEOUT_MS = 180_000;
const NO_PEER_TIMEOUT_MS = 30 * 60_000;

function connectionTarget(connections = 8, activeTransfers = 3) {
  const perDownload = Number.isFinite(connections) ? connections : 8;
  const concurrent = Number.isFinite(activeTransfers) ? activeTransfers : 3;
  return Math.max(
    40,
    Math.min(
      MAX_PEERS,
      Math.floor(600 / Math.max(1, concurrent)),
      perDownload * 20,
    ),
  );
}

function supplementalTrackers(url, trackers = []) {
  if (!/^magnet:/i.test(url)) return [];
  try {
    return new URL(url).searchParams.getAll("tr").length ? [] : trackers;
  } catch {
    return trackers;
  }
}

function trackerUrls(url, torrentTrackers = [], fallbackTrackers = []) {
  const explicit = [...new Set((torrentTrackers || []).filter(Boolean))];
  if (explicit.length) return explicit;
  return [
    ...new Set(supplementalTrackers(url, fallbackTrackers).filter(Boolean)),
  ];
}

function selectedTorrentFiles(torrent, selectedFiles) {
  // Remove the default whole-torrent selection, including for resumed jobs.
  if (torrent.pieces.length) torrent.deselect(0, torrent.pieces.length - 1);
  const selected = Array.isArray(selectedFiles) ? new Set(selectedFiles) : null;
  return torrent.files.filter((file, index) => {
    if (selected) {
      const include = selected.has(index + 1);
      include ? file.select() : file.deselect();
      return include;
    }
    file.select();
    return true;
  });
}

class TorrentEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    Object.assign(this, options);
    this.status = "queued";
    this.stopping = false;
  }

  setStatus(status, data = {}) {
    this.status = status;
    this.emit("status", this.id, status, { speed: 0, ...data });
  }

  start() {
    if (!this.task) this.task = this.run();
    return this.task;
  }

  resolveSavePath() {
    this.savePath = this.savePath || this.basePath;
    if (LEGACY_FOLDER.test(path.basename(this.savePath)))
      this.savePath = path.dirname(this.savePath);
    return this.savePath;
  }

  destinationName() {
    return sanitizeFilename(
      this.torrent?.name || this.torrentName || "Torrent",
    );
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
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      if (!["EXDEV", "EPERM", "EACCES"].includes(error.code)) throw error;
    }
    await fs.cp(source, target, { recursive: true, errorOnExist: true });
    await fs.rm(source, { recursive: true, force: true });
  }

  async createTorrentInput() {
    if (this.torrentMetadataPath) {
      try {
        return await fs.readFile(this.torrentMetadataPath);
      } catch {}
    }
    if (/^https?:\/\//i.test(this.url)) {
      const { readRemoteTorrent } = require("./aria2");
      return readRemoteTorrent(this.url);
    }
    return this.url;
  }

  async outputPath(files) {
    const existing = [];
    for (const file of files) {
      const target = path.resolve(this.workPath, file.path);
      if (
        target !== path.resolve(this.workPath) &&
        !target.startsWith(path.resolve(this.workPath) + path.sep)
      )
        throw new Error("Torrent metadata contains an unsafe file path.");
      if (
        await fs.stat(target).then(
          () => true,
          () => false,
        )
      )
        existing.push(target);
    }
    if (!existing.length)
      throw new Error(
        "Selected torrent files were not found after completion.",
      );
    if (existing.length === 1) return existing[0];

    const output = path.join(this.workPath, ".getanny-output");
    await fs.rm(output, { recursive: true, force: true });
    for (const source of existing) {
      const target = path.join(output, path.relative(this.workPath, source));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.rename(source, target);
    }
    return output;
  }

  async run() {
    let poller;
    try {
      this.resolveSavePath();
      this.workPath =
        this.tempPath ||
        path.join(this.savePath, ".getanny-torrent", String(this.id));
      await fs.mkdir(this.savePath, { recursive: true });
      await fs.mkdir(this.workPath, { recursive: true });

      this.setStatus("connecting", {
        phase: "Connecting to torrent peers",
        savePath: this.savePath,
      });

      this.clientOwned = !this.sharedTorrentClient;
      if (this.clientOwned) {
        const { default: WebTorrent } = await import("webtorrent");
        this.client = new WebTorrent({
          maxConns: connectionTarget(
            this.connections,
            this.maxConcurrentDownloads,
          ),
          utp: true,
          downloadLimit: this.speedLimit || -1,
        });
      } else {
        this.client = this.sharedTorrentClient;
      }
      if (this.wantedState) return;

      const announce = trackerUrls(
        this.url,
        this.torrentTrackers,
        this.getTrackers?.() || [],
      );
      const source = await this.createTorrentInput();
      const torrent = this.client.add(source, {
        path: this.workPath,
        announce,
        strategy: "rarest",
        deselect: true,
      });
      this.torrent = torrent;

      const startedAt = Date.now();
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(metadataTimer);
          error ? reject(error) : resolve();
        };
        const metadataTimer = setTimeout(
          () =>
            finish(
              new Error(
                "Torrent metadata was not available within three minutes. Check the magnet link and peer access.",
              ),
            ),
          METADATA_TIMEOUT_MS,
        );
        metadataTimer.unref?.();
        this.finish = () => finish();
        torrent.once("error", finish);
        torrent.once("ready", () => finish());
      });
      if (this.wantedState) return;

      const files = selectedTorrentFiles(torrent, this.selectedFiles);
      if (!files.length)
        throw new Error("Select at least one file to download.");
      const totalSize = files.reduce((sum, file) => sum + file.length, 0);
      if (this.prioritizeFirstLast) {
        for (const file of files) {
          if (!file.length) continue;
          const first = Math.floor(file.offset / torrent.pieceLength);
          const last = Math.floor(
            (file.offset + file.length - 1) / torrent.pieceLength,
          );
          torrent.critical(first, first);
          torrent.critical(last, last);
        }
      }
      const selectedDownloaded = () =>
        files.reduce((sum, file) => sum + file.downloaded, 0);
      const selectedDone = () => files.every((file) => file.done);
      const connectedTrackers = new Set();
      let trackerReportedPeers = 0;
      const tracker = torrent.discovery?.tracker;
      tracker?.on("update", (data = {}) => {
        const announceUrl = data.announce || data.announceUrl;
        if (announceUrl) connectedTrackers.add(announceUrl);
        trackerReportedPeers = Math.max(
          trackerReportedPeers,
          Number(data.complete || 0) + Number(data.incomplete || 0),
        );
      });
      this.setStatus("downloading", {
        filename: torrent.name,
        totalSize,
        infoHash: torrent.infoHash,
        phase: "Downloading and verifying pieces",
      });

      await new Promise((resolve, reject) => {
        this.transferActive = true;
        this.finish = resolve;
        this.clientError = reject;
        let noPeerSince = 0;
        poller = setInterval(() => {
          if (this.wantedState === "paused") return;
          if (this.wantedState) return resolve();
          const peers = torrent.numPeers || 0;
          if (selectedDone()) return resolve();
          const seeds = (torrent.wires || []).filter(
            (wire) => wire.isSeeder,
          ).length;
          if (!peers && !torrent.downloaded) {
            if (!noPeerSince) noPeerSince = Date.now();
            if (Date.now() - noPeerSince > NO_PEER_TIMEOUT_MS) {
              return reject(
                new Error(
                  "No torrent peers connected after 30 minutes. The transfer stayed active while discovery was retried.",
                ),
              );
            }
          } else {
            noPeerSince = 0;
          }
          this.emit("progress", this.id, {
            downloadedSize: selectedDownloaded(),
            totalSize,
            speed: torrent.downloadSpeed || 0,
            uploadSpeed: torrent.uploadSpeed || 0,
            eta:
              torrent.downloadSpeed > 0
                ? Math.max(0, totalSize - selectedDownloaded()) /
                  torrent.downloadSpeed
                : null,
            peers,
            seeds,
            trackerCount:
              torrent.discovery?._announce?.length || announce.length,
            connectedTrackers: connectedTrackers.size,
            trackerReportedPeers,
            peerConnectionWarning:
              trackerReportedPeers > 0 &&
              peers === 0 &&
              Date.now() - startedAt > 60_000,
            trackerWarning:
              announce.length > 0 &&
              Date.now() - startedAt > 60_000 &&
              connectedTrackers.size === 0,
            trackerEmptyWarning: false,
            emptyPeerSources: [],
            torrentTransport: this.client.utp ? "TCP + uTP" : "TCP",
          });
        }, 500);
        poller.unref?.();
        if (selectedDone()) resolve();
        else torrent.once("done", resolve);
        torrent.once("error", reject);
      });

      if (this.wantedState) return;
      if (!selectedDone())
        throw new Error(
          "The torrent stopped before all selected pieces were verified.",
        );
      const output = await this.outputPath(files);
      const target = await this.uniqueTarget(
        files.length > 1
          ? this.destinationName()
          : sanitizeFilename(path.basename(output)),
      );
      this.setStatus("processing", { phase: "Saving completed torrent" });
      await this.destroyTorrent(false);
      await this.publish(output, target);
      await fs
        .rm(this.workPath, { recursive: true, force: true })
        .catch(() => {});
      const stat = await fs.stat(target);
      this.setStatus("completed");
      this.emit("complete", this.id, {
        filename: path.basename(target),
        totalSize: stat.isDirectory() ? totalSize : stat.size,
        downloadedSize: stat.isDirectory() ? totalSize : stat.size,
        filePath: target,
        savePath: this.savePath,
      });
    } catch (error) {
      if (this.wantedState) this.setStatus(this.wantedState);
      else {
        this.setStatus("failed", { error: error.message });
        this.emit("error", this.id, error);
      }
    } finally {
      clearInterval(poller);
      this.transferActive = false;
      if (!(this.keepTorrentPaused && this.wantedState === "paused"))
        await this.destroyTorrent(this.wantedState === "cancelled");
      if (this.clientOwned && this.client && !this.client.destroyed)
        await new Promise((resolve) => this.client.destroy(resolve));
      if (this.wantedState && this.status !== this.wantedState)
        this.setStatus(this.wantedState);
    }
  }

  async destroyTorrent(destroyStore = false) {
    const torrent = this.torrent;
    this.torrent = null;
    if (!torrent || torrent.destroyed) return;
    await new Promise((resolve) =>
      torrent.destroy({ destroyStore }, () => resolve()),
    );
  }

  async stop(status) {
    if (["completed", "failed", "cancelled"].includes(this.status))
      return false;
    this.wantedState = status;
    if (
      status === "paused" &&
      this.torrent?.ready &&
      this.transferActive &&
      this.client &&
      !this.clientOwned
    ) {
      this.keepTorrentPaused = true;
      this.torrent.pause();
      this.setStatus("paused");
      return true;
    }
    this.finish?.();
    await this.destroyTorrent(status === "cancelled");
    await this.task;
    this.keepTorrentPaused = false;
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

  resume() {
    if (!this.keepTorrentPaused || !this.torrent || this.torrent.destroyed)
      return false;
    this.wantedState = null;
    this.keepTorrentPaused = false;
    this.torrent.resume();
    this.setStatus("downloading", {
      phase: "Resumed from verified local pieces",
    });
    return true;
  }

  cancel() {
    return this.stop("cancelled");
  }

  async shutdown() {
    if (["completed", "failed", "cancelled"].includes(this.status)) return;
    this.wantedState = "paused";
    this.keepTorrentPaused = false;
    this.finish?.();
    await this.destroyTorrent(false);
    await this.task;
    this.setStatus("paused");
  }
}

module.exports = {
  TorrentEngine,
  LEGACY_FOLDER,
  connectionTarget,
  supplementalTrackers,
  trackerUrls,
  selectedTorrentFiles,
};
