const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  TorrentEngine,
  connectionTarget,
  supplementalTrackers,
} = require("./TorrentEngine");
const { temporary } = require("../../../tests/helpers");

test("torrent connection targets ramp within a global budget and sparse magnets get trackers", () => {
  const trackers = ["udp://tracker.example:80/announce"];
  assert.equal(connectionTarget(), 100);
  assert.equal(connectionTarget(8, 12), 25);
  assert.equal(connectionTarget(16, 1), 120);
  assert.deepEqual(
    supplementalTrackers("magnet:?xt=urn:btih:abc", trackers),
    trackers,
  );
  assert.deepEqual(
    supplementalTrackers(
      "magnet:?xt=urn:btih:abc&tr=udp%3A%2F%2Fa&tr=udp%3A%2F%2Fb&tr=udp%3A%2F%2Fc",
      trackers,
    ),
    [],
  );
  assert.deepEqual(
    supplementalTrackers("https://example.test/file.torrent", trackers),
    trackers,
  );
});

test("torrent progress reports live peers, seeds and responding trackers", async (t) => {
  const root = await temporary(t, "getanny-torrent-status-");
  const trackers = ["udp://tracker.example:80/announce"];
  let clientOptions;
  let addOptions;
  class FakeTorrent extends EventEmitter {
    constructor() {
      super();
      this.done = false;
      this.downloaded = 512;
      this.length = 1024;
      this.name = "Status fixture";
      this.numPeers = 2;
      this.downloadSpeed = 1234;
      this.uploadSpeed = 99;
      this.timeRemaining = 1000;
      this.wires = [{ isSeeder: true }, { isSeeder: false }];
      this.discovery = {
        _announce: ["udp://source.example/announce", ...trackers],
        tracker: new EventEmitter(),
      };
    }
  }
  class FakeClient extends EventEmitter {
    constructor(options) {
      super();
      clientOptions = options;
      this.destroyed = false;
    }
    add(_url, options) {
      addOptions = options;
      const torrent = new FakeTorrent();
      setTimeout(async () => {
        await fs.mkdir(options.path, { recursive: true });
        await fs.writeFile(path.join(options.path, torrent.name), "verified");
        torrent.emit("ready");
        setTimeout(() => {
          torrent.discovery.tracker.emit("update", {
            announce: "udp://source.example/announce",
          });
        }, 10);
        setTimeout(() => {
          torrent.downloaded = torrent.length;
          torrent.done = true;
          torrent.emit("done");
        }, 650);
      }, 10);
      return torrent;
    }
    destroy(callback) {
      this.destroyed = true;
      callback?.();
    }
  }
  const engine = new TorrentEngine({
    id: "torrent-status",
    url: "magnet:?xt=urn:btih:abc",
    savePath: path.join(root, "downloads"),
    tempPath: path.join(root, "work"),
    connections: 8,
    maxConcurrentDownloads: 3,
    speedLimit: 0,
    getTrackers: () => trackers,
    WebTorrentClass: FakeClient,
  });
  const progress = new Promise((resolve) =>
    engine.once("progress", (_id, data) => resolve(data)),
  );
  const task = engine.start();
  const result = await progress;
  assert.equal(result.peers, 2);
  assert.equal(result.seeds, 1);
  assert.equal(result.connectedTrackers, 1);
  assert.equal(result.trackerCount, 2);
  assert.equal(result.trackerWarning, false);
  assert.equal(result.speed, 1234);
  assert.equal(clientOptions.downloadLimit, -1);
  assert.equal(clientOptions.uploadLimit, 128 * 1024);
  assert.equal(clientOptions.maxConns, 40);
  assert.deepEqual(addOptions.announce, trackers);
  assert.equal(addOptions.strategy, "rarest");
  await task;
  assert.equal(engine.status, "completed");
  assert.equal(
    await fs.readFile(path.join(root, "downloads", "Status fixture"), "utf8"),
    "verified",
  );
});
