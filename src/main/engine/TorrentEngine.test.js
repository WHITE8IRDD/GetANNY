const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  TorrentEngine,
  connectionTarget,
  supplementalTrackers,
} = require("./TorrentEngine");
const { aria2Args } = require("./aria2");
const { inspectTorrent } = require("./TorrentMetadata");
const { temporary } = require("../../../tests/helpers");

test(
  "real peer transfer saves only selected episodes to a custom destination",
  { timeout: 30000 },
  async (t) => {
    const { default: WebTorrent } = await import("webtorrent");
    const root = await temporary(t, "getanny-selected-peer-");
    const source = path.join(root, "Episodes");
    await fs.mkdir(source);
    for (let i = 1; i <= 4; i++)
      await fs.writeFile(
        path.join(source, `Episode ${i}.mkv`),
        Buffer.alloc(65536, i),
      );
    const seedClient = new WebTorrent({
      dht: false,
      tracker: false,
      lsd: false,
      utp: false,
    });
    const client = new WebTorrent({
      dht: false,
      tracker: false,
      lsd: false,
      utp: false,
    });
    t.after(async () => {
      await Promise.all(
        [seedClient, client].map(
          (c) => new Promise((resolve) => c.destroy(resolve)),
        ),
      );
    });
    const seed = await new Promise((resolve, reject) => {
      seedClient.once("error", reject);
      seedClient.seed(source, { pieceLength: 16384, announce: [] }, resolve);
    });
    const metadata = path.join(root, "source.torrent");
    await fs.writeFile(metadata, seed.torrentFile);
    const originalAdd = client.add.bind(client);
    client.add = (...args) => {
      const torrent = originalAdd(...args);
      torrent.once("ready", () =>
        torrent.addPeer(`127.0.0.1:${seedClient.torrentPort}`),
      );
      return torrent;
    };
    const destination = path.join(root, "custom-destination");
    const engine = new TorrentEngine({
      id: "selection",
      url: metadata,
      torrentMetadataPath: metadata,
      savePath: destination,
      selectedFiles: [2, 4],
      sharedTorrentClient: client,
    });
    let result;
    engine.on("error", () => {});
    engine.on("complete", (_, data) => {
      result = data;
    });
    await engine.start();
    assert.equal(engine.status, "completed");
    assert.equal(result.totalSize, 131072);
    assert.ok(result.filePath.startsWith(destination + path.sep));
    const output = path.join(result.filePath, "Episodes");
    assert.deepEqual(await fs.readdir(output), [
      "Episode 2.mkv",
      "Episode 4.mkv",
    ]);
    for (const i of [2, 4])
      assert.deepEqual(
        await fs.readFile(path.join(output, `Episode ${i}.mkv`)),
        Buffer.alloc(65536, i),
      );
  },
);

function multiFileTorrent(count = 3) {
  const bstr = (value) => `${Buffer.byteLength(value)}:${value}`;
  const files = Array.from({ length: count }, (_, i) => i + 1)
    .map(
      (index) =>
        `d6:lengthi5e4:pathl${bstr("Season 1")}${bstr(`Episode ${index}.mkv`)}ee`,
    )
    .join("");
  const pieces = "\0".repeat(Math.ceil((count * 5) / 16384) * 20);
  const info = `d5:filesl${files}e4:name${bstr("Test Season")}12:piece lengthi16384e6:pieces${bstr(pieces)}e`;
  return Buffer.from(`d4:info${info}e`, "binary");
}

test(
  "three simultaneous torrents share one client and publish exact bytes",
  { timeout: 30000 },
  async (t) => {
    const { default: WebTorrent } = await import("webtorrent");
    const root = await temporary(t, "getanny-concurrent-torrents-");
    const options = { dht: false, tracker: false, lsd: false, utp: false };
    const seeder = new WebTorrent(options);
    const client = new WebTorrent(options);
    t.after(async () => {
      await Promise.all(
        [client, seeder].map(
          (c) => new Promise((resolve) => c.destroy(resolve)),
        ),
      );
    });
    const add = client.add.bind(client);
    client.add = (...args) => {
      const torrent = add(...args);
      torrent.once("ready", () =>
        torrent.addPeer(`127.0.0.1:${seeder.torrentPort}`),
      );
      return torrent;
    };
    const engines = await Promise.all(
      [1, 2, 3].map(async (i) => {
        const bytes = Buffer.alloc(256 * 1024, i);
        const source = path.join(root, `job-${i}.bin`);
        await fs.writeFile(source, bytes);
        const seed = await new Promise((resolve) =>
          seeder.seed(source, { announce: [] }, resolve),
        );
        const metadata = path.join(root, `job-${i}.torrent`);
        await fs.writeFile(metadata, seed.torrentFile);
        const engine = new TorrentEngine({
          id: i,
          url: metadata,
          torrentMetadataPath: metadata,
          savePath: path.join(root, "downloads"),
          sharedTorrentClient: client,
        });
        engine.on("error", () => {});
        engine.on("complete", (_, data) => {
          engine.output = data.filePath;
        });
        return { engine, bytes };
      }),
    );
    await Promise.all(engines.map(({ engine }) => engine.start()));
    for (const { engine, bytes } of engines) {
      assert.equal(engine.status, "completed");
      assert.deepEqual(await fs.readFile(engine.output), bytes);
    }
  },
);

test("torrent peer targets respect configured concurrency and stay bounded", () => {
  assert.equal(connectionTarget(), 160);
  assert.equal(connectionTarget(8, 12), 50);
  assert.equal(connectionTarget(16, 1), 200);
});

test("inspection preserves all paths and indices for 2000 episode files", async (t) => {
  const root = await temporary(t, "getanny-large-metadata-");
  const source = path.join(root, "large.torrent");
  await fs.writeFile(source, multiFileTorrent(2000));
  const info = await inspectTorrent(source);
  assert.equal(info.files.length, 2000);
  assert.equal(info.length, 10000);
  assert.equal(info.files[1999].index, 2000);
  assert.match(info.files[1999].path, /Episode 2000\.mkv$/);
});

test("public trackers are only suggested for magnets without an announce list", () => {
  const trackers = ["udp://tracker.example:80/announce"];
  assert.deepEqual(
    supplementalTrackers("magnet:?xt=urn:btih:abc", trackers),
    trackers,
  );
  assert.deepEqual(
    supplementalTrackers("magnet:?xt=urn:btih:abc&tr=udp%3A%2F%2Fa", trackers),
    [],
  );
  assert.deepEqual(
    supplementalTrackers("C:\\files\\test.torrent", trackers),
    [],
  );
});

test("aria2 launch flags keep local RPC private and retain per-job resume data", () => {
  const args = aria2Args({
    workPath: "C:\\temp\\job-1",
    logPath: "C:\\temp\\job-1\\aria2.log",
    rpcPort: 45001,
    secret: "local-secret",
    btPort: 45002,
    dhtPort: 45003,
    speedLimit: 0,
    maxPeers: 120,
  });
  assert.ok(args.includes("--rpc-listen-all=false"));
  assert.ok(args.includes("--rpc-secret=local-secret"));
  assert.ok(args.includes("--always-resume=true"));
  assert.ok(args.includes("--enable-dht=true"));
  assert.ok(args.includes("--enable-peer-exchange=true"));
  assert.ok(args.includes("--bt-enable-lpd=true"));
  assert.ok(args.includes("--bt-max-peers=120"));
});

test("multi-file output keeps a torrent content folder without control files", async (t) => {
  const root = await temporary(t, "getanny-torrent-publish-");
  const workPath = path.join(root, "work");
  const season = path.join(workPath, "Season 2");
  await fs.mkdir(season, { recursive: true });
  const episode = path.join(season, "episode-01.mkv");
  await fs.writeFile(episode, "video");
  const engine = new TorrentEngine({ workPath });
  const output = await engine.outputPath([
    { path: episode, length: "5", selected: "true" },
  ]);
  assert.equal(output, episode);
  assert.equal(await fs.readFile(output, "utf8"), "video");
});

test("flat multi-file selection is collected into one clean output folder", async (t) => {
  const root = await temporary(t, "getanny-torrent-flat-");
  const workPath = path.join(root, "work");
  await fs.mkdir(workPath, { recursive: true });
  const first = path.join(workPath, "episode-01.mkv");
  const second = path.join(workPath, "episode-02.mkv");
  await fs.writeFile(first, "one");
  await fs.writeFile(second, "two");
  const engine = new TorrentEngine({ workPath });
  const output = await engine.outputPath([
    { path: first, length: "3", selected: "true" },
    { path: second, length: "3", selected: "true" },
  ]);
  assert.equal(path.basename(output), ".getanny-output");
  assert.deepEqual(await fs.readdir(output), [
    "episode-01.mkv",
    "episode-02.mkv",
  ]);
});

test("torrent inspection returns the complete multi-file list before queueing", async (t) => {
  const root = await temporary(t, "getanny-torrent-metadata-");
  const torrentPath = path.join(root, "season.torrent");
  await fs.writeFile(torrentPath, multiFileTorrent());
  const info = await inspectTorrent(torrentPath);
  assert.equal(info.name, "Test Season");
  assert.equal(info.files.length, 3);
  assert.equal(info.length, 15);
  assert.equal(
    info.files[1].path,
    path.join("Test Season", "Season 1", "Episode 2.mkv"),
  );
  assert.ok(info.infoHash);
});
