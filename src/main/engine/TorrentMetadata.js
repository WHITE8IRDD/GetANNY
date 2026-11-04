"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { readRemoteTorrent } = require("./aria2");

const MAX_METADATA_BYTES = 16 * 1024 * 1024;

function trackerUrlsFromMagnet(source) {
  try {
    return [
      ...new Set(new URL(source).searchParams.getAll("tr").filter(Boolean)),
    ];
  } catch {
    return [];
  }
}

function metadataResult(torrent, torrentFile, trackers = []) {
  if (!torrent?.files?.length)
    throw new Error("No files were found in this torrent.");
  const bytes = Buffer.from(torrentFile || []);
  if (!bytes.length || bytes.length > MAX_METADATA_BYTES)
    throw new Error("Torrent metadata is empty or exceeds the 16 MB limit.");
  return {
    name: torrent.name || "Torrent",
    infoHash: torrent.infoHash || "",
    comment: torrent.comment || "",
    length:
      torrent.length ||
      torrent.files.reduce((sum, file) => sum + file.length, 0),
    trackers,
    torrentFileBase64: bytes.toString("base64"),
    files: torrent.files.map((file, index) => ({
      index: index + 1,
      path: file.path,
      name: path.basename(file.path),
      length: file.length,
    })),
  };
}

async function inspectTorrent(
  source,
  { timeoutMs = 90000, trackers = [] } = {},
) {
  if (!source) throw new Error("Choose a torrent file or enter a magnet link.");
  let parsed;
  if (/^magnet:/i.test(source)) {
    const { default: WebTorrent } = await import("webtorrent");
    const staging = await fs.mkdtemp(
      path.join(os.tmpdir(), "getanny-metadata-"),
    );
    const client = new WebTorrent({ maxConns: 96, utp: true });
    try {
      parsed = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          error ? reject(error) : resolve(result);
        };
        const timeout = setTimeout(
          () =>
            finish(
              new Error(
                "Torrent file list was not available within 90 seconds. Check the magnet link and peer connection.",
              ),
            ),
          timeoutMs,
        );
        client.once("error", (error) => finish(error));
        const torrent = client.add(source, {
          path: staging,
          deselect: true,
          announce: trackerUrlsFromMagnet(source).length ? [] : trackers,
        });
        torrent.once("error", (error) => finish(error));
        torrent.once("metadata", () => {
          torrent.pause();
          finish(
            null,
            metadataResult(
              torrent,
              torrent.torrentFile,
              trackerUrlsFromMagnet(source).length
                ? trackerUrlsFromMagnet(source)
                : trackers,
            ),
          );
        });
      });
    } finally {
      await new Promise((resolve) => client.destroy(resolve));
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
    return parsed;
  }

  let data;
  if (/^https?:\/\//i.test(source)) data = await readRemoteTorrent(source);
  else {
    if (!path.isAbsolute(source))
      throw new Error("Choose a local .torrent file.");
    data = await fs.readFile(source);
  }
  const parseTorrent = (await import("parse-torrent")).default;
  const torrent = await parseTorrent(data);
  if (!torrent?.files?.length)
    throw new Error("No files were found in this torrent.");
  return metadataResult(torrent, data, torrent.announce || []);
}

module.exports = { inspectTorrent };
