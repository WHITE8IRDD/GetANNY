const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { DownloadEngine } = require("../src/main/engine/DownloadEngine");
const { ChunkDownloader } = require("../src/main/engine/ChunkDownloader");
const { DownloadManager } = require("../src/main/engine/DownloadManager");
const { Database } = require("../src/main/database/database");
const { DownloadsRepo } = require("../src/main/database/downloads-repo");
const { temporary, waitFor, checksum, fixtureServer } = require("./helpers");
async function run(engine) {
  let error;
  engine.on("error", (_id, value) => {
    error = value;
  });
  await engine.start();
  return error;
}
for (const route of [
  "/file.bin",
  "/redirect",
  "/headless",
  "/ignores-range",
  "/unknown",
]) {
  test(`HTTP ${route}: exact bytes and server filename`, async (t) => {
    const server = await fixtureServer(t, { size: 256 * 1024 });
    const dir = await temporary(t);
    const engine = new ChunkDownloader({
      url: server.url + route,
      savePath: dir,
      connections: 4,
    });
    assert.equal(await run(engine), undefined);
    assert.equal(engine.status, "completed");
    assert.equal(engine.filename, "server-file.bin");
    assert.equal(
      checksum(await fs.readFile(path.join(dir, engine.filename))),
      checksum(server.state.data),
    );
    assert.ok(
      !(await fs.readdir(dir)).some((name) => name.startsWith(".getanny")),
    );
  });
}
test("HTTPS validates TLS certificates, with an explicitly trusted local test CA", async (t) => {
  const server = await fixtureServer(t, { tls: true, size: 3 * 1024 * 1024 });
  const dir = await temporary(t);
  const refused = new DownloadEngine({
    url: server.url + "/file.bin",
    savePath: dir,
  });
  assert.ok(await run(refused));
  assert.equal(refused.status, "failed");
  const engine = new ChunkDownloader({
    url: server.url + "/file.bin",
    savePath: dir,
    connections: 3,
    requestOptions: { ca: server.cert },
  });
  assert.equal(await run(engine), undefined);
  assert.equal(engine.status, "completed");
  assert.equal(
    checksum(await fs.readFile(path.join(dir, engine.filename))),
    checksum(server.state.data),
  );
});
test("128 MiB parallel transfer is streamed, byte-count checked, and hash verified", async (t) => {
  const server = await fixtureServer(t);
  const dir = await temporary(t);
  const engine = new ChunkDownloader({
    url: server.url + "/large",
    savePath: dir,
    connections: 8,
  });
  assert.equal(await run(engine), undefined);
  assert.equal(engine.totalSize, 128 * 1024 * 1024);
  const actual = createHash("sha256");
  for await (const chunk of createReadStream(path.join(dir, engine.filename)))
    actual.update(chunk);
  const expected = createHash("sha256");
  for (let i = 0; i < 128; i++)
    expected.update(Buffer.alloc(1024 * 1024, 0x23));
  assert.equal(actual.digest("hex"), expected.digest("hex"));
  assert.ok(server.state.maxActive > 1);
});
for (const connections of [1, 4]) {
  test(`${connections} connection(s): pause waits for closure, resume uses saved bytes`, async (t) => {
    const server = await fixtureServer(t, { size: 8 * 1024 * 1024, delay: 10 });
    const dir = await temporary(t);
    const options = {
      id: `resume-${connections}`,
      url: server.url + "/file.bin",
      savePath: dir,
      connections,
    };
    const first = new ChunkDownloader(options);
    const task = run(first);
    await waitFor(
      () => first.downloadedSize > 128 * 1024 && first.status === "downloading",
    );
    await first.pause();
    await task;
    assert.equal(first.status, "paused");
    assert.equal(first.segmentStreams.size, 0);
    const partials = (await fs.readdir(dir)).filter((name) =>
      name.includes(".part"),
    );
    assert.ok(partials.length > 0);
    const sizes = await Promise.all(
      partials.map((name) =>
        fs.stat(path.join(dir, name)).then((stat) => stat.size),
      ),
    );
    assert.ok(sizes.reduce((a, b) => a + b, 0) > 0);
    server.state.requests.length = 0;
    const resumed = new ChunkDownloader({ ...options, connections: 2 });
    assert.equal(await run(resumed), undefined);
    assert.equal(resumed.status, "completed");
    assert.equal(
      checksum(await fs.readFile(path.join(dir, resumed.filename))),
      checksum(server.state.data),
    );
    assert.ok(
      server.state.requests.some(
        (request) =>
          request.ifRange === '"fixture-v1"' && request.range !== "bytes=0-0",
      ),
    );
  });
}
test("changed entity validators discard old segments instead of corrupting the output", async (t) => {
  const server = await fixtureServer(t, { size: 4 * 1024 * 1024, delay: 8 });
  const dir = await temporary(t);
  const options = {
    id: "changed-entity",
    url: server.url + "/file.bin",
    savePath: dir,
    connections: 4,
  };
  const first = new ChunkDownloader(options);
  const task = run(first);
  await waitFor(() => first.downloadedSize > 256 * 1024);
  await first.pause();
  await task;
  server.state.data.fill(77);
  server.state.etag = '"fixture-v2"';
  const second = new ChunkDownloader(options);
  assert.equal(await run(second), undefined);
  assert.equal(
    checksum(await fs.readFile(path.join(dir, second.filename))),
    checksum(server.state.data),
  );
});
for (const route of ["/bad-range", "/truncated", "/missing"]) {
  test(`${route}: failure never creates a completed file`, async (t) => {
    const server = await fixtureServer(t, { size: 3 * 1024 * 1024 });
    const dir = await temporary(t);
    const engine = new ChunkDownloader({
      url: server.url + route,
      savePath: dir,
      connections: 3,
    });
    assert.ok(await run(engine));
    assert.equal(engine.status, "failed");
    assert.equal(engine.segmentStreams.size, 0);
    assert.ok(!(await fs.readdir(dir)).includes("server-file.bin"));
  });
}
test("cancelling stops segment streams and removes only this transfer’s incomplete files", async (t) => {
  const server = await fixtureServer(t, { size: 8 * 1024 * 1024, delay: 10 });
  const dir = await temporary(t);
  await fs.writeFile(path.join(dir, "keep.txt"), "keep");
  const engine = new ChunkDownloader({
    url: server.url + "/file.bin",
    savePath: dir,
    connections: 4,
  });
  const task = run(engine);
  await waitFor(() => engine.downloadedSize > 128 * 1024);
  await engine.cancel();
  await task;
  assert.equal(engine.status, "cancelled");
  assert.equal(engine.segmentStreams.size, 0);
  assert.deepEqual(await fs.readdir(dir), ["keep.txt"]);
});
test("explicit filenames are honored and pre-existing files cannot be overwritten", async (t) => {
  const server = await fixtureServer(t, { size: 1000 });
  const dir = await temporary(t);
  await fs.writeFile(path.join(dir, "custom.bin"), "original");
  const engine = new ChunkDownloader({
    url: server.url + "/file.bin",
    savePath: dir,
    filename: "custom.bin",
    filenameExplicit: true,
  });
  assert.ok(await run(engine));
  assert.equal(
    await fs.readFile(path.join(dir, "custom.bin"), "utf8"),
    "original",
  );
});
test("valid empty files complete at exactly zero bytes", async (t) => {
  const server = await fixtureServer(t);
  const dir = await temporary(t);
  const engine = new DownloadEngine({
    url: server.url + "/empty",
    savePath: dir,
  });
  assert.equal(await run(engine), undefined);
  assert.equal(engine.status, "completed");
  assert.equal(engine.totalSize, 0);
  assert.equal((await fs.stat(path.join(dir, engine.filename))).size, 0);
});
test("per-transfer speed limit is shared across connections", async (t) => {
  const server = await fixtureServer(t, { size: 256 * 1024 });
  const dir = await temporary(t);
  const start = Date.now();
  const engine = new ChunkDownloader({
    url: server.url + "/file.bin",
    savePath: dir,
    speedLimit: 256 * 1024,
  });
  assert.equal(await run(engine), undefined);
  assert.ok(Date.now() - start >= 950);
});
async function managerFixture(t, settings = {}, options = {}) {
  const dir = await fs.mkdtemp(
    path.join(require("node:os").tmpdir(), "getanny-manager-"),
  );
  const db = new Database(path.join(dir, "data"));
  await db.initialize();
  const repo = new DownloadsRepo(db),
    manager = new DownloadManager({
      downloadsRepo: repo,
      settings: {
        defaultDownloadPath: path.join(dir, "files"),
        maxConcurrentDownloads: 1,
        maxConnectionsPerDownload: 2,
        retryAttempts: 0,
        ...settings,
      },
      ...options,
    });
  t.after(async () => {
    await manager.shutdown();
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return { dir, db, repo, manager };
}
test("queue slots, retries, history and collision-safe naming are real", async (t) => {
  const server = await fixtureServer(t, { size: 1024 * 1024, delay: 10 });
  const { manager, repo } = await managerFixture(t);
  const first = await manager.addDownload({ url: server.url + "/file.bin" }),
    second = await manager.addDownload({ url: server.url + "/file.bin" });
  assert.equal(manager.running.size, 1);
  assert.equal(manager.requireItem(second).status, "queued");
  await waitFor(
    () =>
      manager.requireItem(first).status === "completed" &&
      manager.requireItem(second).status === "completed",
  );
  assert.equal(repo.getAll().length, 2);
  assert.notEqual(repo.get(first).filePath, repo.get(second).filePath);
  assert.equal(
    checksum(await fs.readFile(repo.get(second).filePath)),
    checksum(server.state.data),
  );
  await manager.clearCompleted();
  assert.equal(manager.getAll().length, 0);
  assert.equal(repo.getAll().length, 0);
});
test("new downloads can start paused, resume, cancel, retry and delete actual files", async (t) => {
  const server = await fixtureServer(t, { size: 512 * 1024, delay: 5 });
  const { manager } = await managerFixture(t, {
    autoStartDownloads: false,
    speedLimit: 1024,
  });
  const resumedId = await manager.addDownload({
    url: server.url + "/file.bin",
  });
  manager.resume(resumedId);
  await waitFor(() => manager.requireItem(resumedId).status === "downloading");
  await manager.pause(resumedId);
  assert.equal(manager.requireItem(resumedId).status, "paused");
  manager.updateSettings({ ...manager.settings, speedLimit: 0 });
  assert.equal(manager.resume(resumedId), true);
  await waitFor(() => manager.requireItem(resumedId).status === "completed");
  await waitFor(() => !manager.running.has(resumedId));
  await manager.remove(resumedId, true);

  const id = await manager.addDownload({ url: server.url + "/file.bin" });
  assert.equal(manager.requireItem(id).status, "paused");
  assert.equal(manager.running.size, 0);
  manager.resume(id);
  await waitFor(() => manager.requireItem(id).status === "downloading");
  await manager.cancel(id);
  assert.equal(manager.requireItem(id).status, "cancelled");
  await waitFor(() => !manager.running.has(id));
  assert.equal(manager.retry(id), true);
  assert.equal(manager.retry(id), false);
  await waitFor(() => manager.requireItem(id).status === "completed");
  const file = manager.requireItem(id).filePath;
  await manager.remove(id, true);
  assert.equal(
    await fs.access(file).then(
      () => true,
      () => false,
    ),
    false,
  );
  assert.equal(manager.getAll().length, 0);
});
test("transient HTTP failures have bounded automatic retries", async (t) => {
  const server = await fixtureServer(t, { size: 1024 });
  const { manager } = await managerFixture(t, {
    retryAttempts: 1,
    retryDelaySeconds: 1,
  });
  const id = await manager.addDownload({ url: server.url + "/flaky" });
  await waitFor(() => manager.requireItem(id).status === "completed");
  assert.equal(manager.requireItem(id).attempt, 1);
});
test("restart restores interrupted history as paused with zero stale speed", async (t) => {
  const { manager, repo } = await managerFixture(t);
  repo.save({
    id: "old",
    url: "https://example.test/a",
    filename: "a",
    savePath: manager.settings.defaultDownloadPath,
    status: "downloading",
    speed: 5000,
    targetReserved: true,
    filenameExplicit: true,
    connections: 4,
  });
  await manager.restoreDownloads();
  const item = manager.requireItem("old");
  assert.equal(item.status, "paused");
  assert.equal(item.speed, 0);
  assert.equal(item.filenameExplicit, true);
  assert.equal(repo.get("old").connections, 4);
});
test("session headers stay in memory, are omitted from persistence, and expire on restart", async (t) => {
  const { manager, repo } = await managerFixture(t, {
    autoStartDownloads: false,
  });
  let addedPayload;
  manager.once("added", (value) => (addedPayload = value));
  const id = await manager.addDownload({
    url: "https://example.test/private.zip",
    headers: {
      Cookie: "session=secret-value",
      Authorization: "Bearer secret-token",
      Referer: "https://example.test/",
    },
  });
  const item = manager.requireItem(id);
  assert.equal(item.sessionHeaders.Cookie, "session=secret-value");
  assert.equal(item.headers.Referer, "https://example.test/");
  assert.equal(Object.hasOwn(item.headers, "Cookie"), false);
  assert.equal(Object.hasOwn(manager.getAll()[0], "sessionHeaders"), false);
  assert.equal(JSON.stringify(addedPayload).includes("secret-value"), false);
  const persisted = repo.get(id);
  assert.equal(JSON.stringify(persisted).includes("secret-value"), false);
  assert.equal(JSON.stringify(persisted).includes("secret-token"), false);
  const restored = new DownloadManager({
    downloadsRepo: repo,
    settings: manager.settings,
  });
  t.after(() => restored.shutdown());
  await restored.restoreDownloads();
  assert.equal(restored.requireItem(id).status, "paused");
  assert.match(restored.requireItem(id).error, /Session expired/);
  assert.throws(() => restored.resume(id), /Session expired/);
});

test("concurrent name reservations cannot collide before files are created", async (t) => {
  const server = await fixtureServer(t, { size: 256 * 1024, delay: 5 });
  const { manager } = await managerFixture(t, { maxConcurrentDownloads: 3 });
  const ids = await Promise.all(
    [1, 2, 3].map(() => manager.addDownload({ url: server.url + "/file.bin" })),
  );
  await waitFor(() =>
    ids.every((id) => manager.requireItem(id).status === "completed"),
  );
  assert.equal(
    new Set(ids.map((id) => manager.requireItem(id).filePath)).size,
    3,
  );
});

test("a resumed URL without entity validators restarts rather than mixing changed bytes", async (t) => {
  const server = await fixtureServer(t, { size: 4 * 1024 * 1024, delay: 8 });
  const dir = await temporary(t);
  const options = {
    id: "missing-validators",
    url: server.url + "/no-validators",
    savePath: dir,
    connections: 4,
  };
  const first = new ChunkDownloader(options),
    task = run(first);
  await waitFor(() => first.downloadedSize > 256 * 1024);
  await first.pause();
  await task;
  server.state.data.fill(31);
  const next = new ChunkDownloader(options);
  assert.equal(await run(next), undefined);
  assert.equal(next.status, "completed");
  assert.equal(
    checksum(await fs.readFile(path.join(dir, next.filename))),
    checksum(server.state.data),
  );
});

test("partial data stays outside the destination and history clearing keeps files", async (t) => {
  const server = await fixtureServer(t, { size: 2 * 1024 * 1024, delay: 40 });
  const { dir, manager } = await managerFixture(t, {
    maxConnectionsPerDownload: 4,
  });
  // Work data belongs beside the app's data, not in the user's folder.
  manager.tempPath = path.join(dir, "transfer-temp");
  const id = await manager.addDownload({ url: server.url + "/large.bin" });
  await waitFor(() => manager.requireItem(id).status === "downloading");
  const workDir = path.join(dir, "transfer-temp", id);
  await waitFor(async () =>
    (await fs.readdir(workDir).catch(() => [])).some((name) =>
      name.includes(".getanny-"),
    ),
  );
  const destination = manager.requireItem(id).savePath;
  const visibleDuringTransfer = await fs.readdir(destination);
  assert.deepEqual(visibleDuringTransfer, []);
  const workFiles = await fs.readdir(workDir);
  assert.ok(workFiles.some((name) => name.includes(".getanny-")));
  await waitFor(() => manager.requireItem(id).status === "completed");
  const item = manager.requireItem(id);
  assert.deepEqual(await fs.readdir(destination), [item.filename]);
  assert.equal(
    checksum(await fs.readFile(item.filePath)),
    checksum(server.state.data),
  );
  await manager.clearHistory({ scope: "all" });
  assert.equal(
    await fs.access(item.filePath).then(
      () => true,
      () => false,
    ),
    true,
  );
});
test("clearing all history leaves unfinished transfers running", async (t) => {
  const server = await fixtureServer(t, { size: 32 * 1024 });
  const { manager } = await managerFixture(t);
  const completed = await manager.addDownload({
    url: server.url + "/done.bin",
  });
  await waitFor(() => manager.requireItem(completed).status === "completed");
  manager.settings.autoStartDownloads = false;
  const paused = await manager.addDownload({ url: server.url + "/later.bin" });
  assert.equal(manager.requireItem(paused).status, "paused");
  assert.equal(await manager.clearHistory({ scope: "all" }), 1);
  assert.equal(manager.getAll().length, 1);
  assert.equal(manager.requireItem(paused).status, "paused");
  assert.equal(
    await manager.clearHistory({ scope: "selected", ids: [paused] }),
    0,
  );
  assert.equal(
    await manager.clearHistory({
      scope: "selected",
      ids: [paused],
      stopUnfinished: true,
    }),
    1,
  );
  assert.equal(manager.getAll().length, 0);
});
test("daily start window handles daytime, overnight and equal endpoints in local time", () => {
  const { isWithinSchedule } = require("../src/main/engine/DownloadManager");
  const at = (hours, minutes = 0) => new Date(2026, 0, 15, hours, minutes);
  const day = {
    scheduleEnabled: true,
    scheduleStartMinute: 8 * 60,
    scheduleEndMinute: 17 * 60,
  };
  assert.equal(isWithinSchedule(day, at(8)), true);
  assert.equal(isWithinSchedule(day, at(17)), false);
  const overnight = {
    ...day,
    scheduleStartMinute: 22 * 60,
    scheduleEndMinute: 6 * 60,
  };
  assert.equal(isWithinSchedule(overnight, at(23)), true);
  assert.equal(isWithinSchedule(overnight, at(5, 59)), true);
  assert.equal(isWithinSchedule(overnight, at(12)), false);
  assert.equal(
    isWithinSchedule(
      { ...day, scheduleEndMinute: day.scheduleStartMinute },
      at(2),
    ),
    true,
  );
  assert.equal(
    isWithinSchedule({ ...day, scheduleEnabled: false }, at(2)),
    true,
  );
});

test("scheduled downloads remain queued across restart and start when scheduling is disabled", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(require("node:os").tmpdir(), "getanny-schedule-"),
  );
  const fixture = await fixtureServer(t, { size: 32768 });
  let db = new Database(dir);
  await db.initialize();
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const settings = {
    defaultDownloadPath: dir,
    scheduleEnabled: true,
    scheduleStartMinute: (minute + 5) % 1440,
    scheduleEndMinute: (minute + 6) % 1440,
    resumeOnStartup: false,
  };
  let manager = new DownloadManager({
    settings,
    downloadsRepo: new DownloadsRepo(db),
  });
  t.after(async () => {
    await manager.shutdown();
    db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const id = await manager.addDownload({ url: fixture.url + "/file.bin" });
  assert.equal(manager.requireItem(id).status, "queued");
  assert.equal(fixture.state.requests.length, 0);
  await manager.shutdown();
  db.close();
  db = new Database(dir);
  await db.initialize();
  manager = new DownloadManager({
    settings,
    downloadsRepo: new DownloadsRepo(db),
  });
  await manager.restoreDownloads();
  assert.equal(manager.requireItem(id).status, "queued");
  assert.equal(fixture.state.requests.length, 0);
  manager.updateSettings({ scheduleEnabled: false });
  await waitFor(() => manager.requireItem(id).status === "completed");
  assert.equal(
    checksum(await fs.readFile(manager.requireItem(id).filePath)),
    checksum(fixture.state.data),
  );
});
test("torrent output uses the swarm name and migrates legacy UUID folders", () => {
  const {
    TorrentEngine,
    LEGACY_FOLDER,
  } = require("../src/main/engine/TorrentEngine");
  const base = path.join(require("node:os").tmpdir(), "torrent-target");
  const legacy = new TorrentEngine({
    id: "legacy",
    url: "magnet:?xt=urn:btih:0000000000000000000000000000000000000000",
    basePath: base,
    savePath: path.join(base, "Torrent [69e406fe-c278-47c7-af6f-525c8e454847]"),
  });
  assert.equal(LEGACY_FOLDER.test(path.basename(legacy.savePath)), true);
  assert.equal(legacy.resolveSavePath(), base);
  legacy.torrent = { name: "Ubuntu 24.04: Desktop" };
  assert.equal(legacy.destinationName(), "Ubuntu 24.04_ Desktop");
  assert.equal(legacy.destinationName().includes("69e406fe"), false);
});
