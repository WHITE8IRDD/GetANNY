const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DownloadEngine } = require("./DownloadEngine");
const { ChunkDownloader } = require("./ChunkDownloader");
const {
  AUTH_REQUIRED_MESSAGE,
  getFilenameFromHeaders,
  getFilenameFromURL,
  withMimeExtension,
  isDynamicArchive,
} = require("./utils");

async function temporary(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "getanny-engine-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  return folder;
}

async function serve(t, handler) {
  const state = { requests: [] };
  const server = http.createServer((request, response) => {
    state.requests.push({
      url: request.url,
      range: request.headers.range,
      cookie: request.headers.cookie,
    });
    handler(request, response, new URL(request.url, "http://localhost"), state);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
  };
}

async function run(engine) {
  let error;
  engine.on("error", (_id, value) => {
    error = value;
  });
  await engine.start();
  return error;
}

test("RFC 6266 filename*, MIME fallback and generic Drive names resolve safely", () => {
  assert.equal(
    getFilenameFromHeaders(
      "attachment; filename=\"fallback.bin\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20final.zip",
    ),
    "résumé final.zip",
  );
  assert.equal(
    getFilenameFromHeaders("attachment; filename*=iso-8859-1''caf%E9.zip"),
    "café.zip",
  );
  assert.equal(
    getFilenameFromURL("https://drive.google.com/uc?export=download&id=abc"),
    null,
  );
  assert.equal(
    getFilenameFromURL("https://drive.google.com/identifier?id=abc"),
    null,
  );
  assert.equal(
    withMimeExtension("download", "application/zip"),
    "download.zip",
  );
  assert.equal(
    isDynamicArchive("https://drive.google.com/drive/folders/abc", {
      "content-type": "application/zip",
      "content-length": "1024",
      "content-disposition": 'attachment; filename="folder.zip"',
    }),
    true,
  );
});

test("Google Drive HTML sign-in pages fail with the actionable authentication message", async (t) => {
  const page = Buffer.from(
    '<!doctype html><html><head><title>Sign in</title></head><body><form action="https://accounts.google.com/ServiceLogin">Log in</form></body></html>',
  );
  const server = await serve(t, (_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": page.length,
    });
    response.end(page);
  });
  const dir = await temporary(t);
  const engine = new DownloadEngine({
    url: server.url + "/uc?export=download&id=abc",
    savePath: dir,
  });
  const error = await run(engine);
  assert.equal(error.message, AUTH_REQUIRED_MESSAGE);
  assert.equal(error.code, "AUTH_REQUIRED");
  assert.equal(engine.status, "failed");
  assert.deepEqual(await fs.readdir(dir), []);
});

test("RFC 6266 filenames are used instead of generic URL endpoints", async (t) => {
  const body = Buffer.from("PK\x03\x04fixture-archive");
  const server = await serve(t, (_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": body.length,
      "Content-Disposition":
        "attachment; filename=\"fallback.zip\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20final.zip",
      "Accept-Ranges": "bytes",
    });
    response.end(body);
  });
  const dir = await temporary(t);
  const engine = new DownloadEngine({
    url: server.url + "/identifier?id=abc",
    savePath: dir,
  });
  assert.equal(await run(engine), undefined);
  assert.equal(engine.filename, "résumé final.zip");
  assert.deepEqual(await fs.readdir(dir), ["résumé final.zip"]);
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(path.join(dir, "résumé final.zip")))
      .digest("hex"),
    createHash("sha256").update(body).digest("hex"),
  );
});

test("MIME type supplies an extension when the URL and headers have no usable name", async (t) => {
  const body = Buffer.from("PK\x03\x04mime-fallback");
  const server = await serve(t, (_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": body.length,
    });
    response.end(body);
  });
  const dir = await temporary(t);
  const engine = new DownloadEngine({
    url: server.url + "/download?token=abc",
    savePath: dir,
  });
  assert.equal(await run(engine), undefined);
  assert.equal(engine.filename, "download.zip");
  assert.deepEqual(await fs.readdir(dir), ["download.zip"]);
});

test("missing Accept-Ranges forces a complete single-connection download", async (t) => {
  const data = Buffer.alloc(4 * 1024 * 1024);
  for (let index = 0; index < data.length; index++) data[index] = index % 251;
  const server = await serve(t, (_request, response) => {
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": data.length,
      "Content-Disposition": 'attachment; filename="data.bin"',
    });
    response.end(data);
  });
  const dir = await temporary(t);
  const engine = new ChunkDownloader({
    url: server.url + "/file.bin",
    savePath: dir,
    connections: 8,
  });
  assert.equal(await run(engine), undefined);
  assert.equal(engine.status, "completed");
  assert.equal(engine.resumable, false);
  assert.equal(engine.segmentCount, 1);
  assert.equal(
    server.state.requests.filter(
      (request) => request.range && request.range !== "bytes=0-0",
    ).length,
    0,
  );
  assert.equal(
    createHash("sha256")
      .update(await fs.readFile(path.join(dir, "data.bin")))
      .digest("hex"),
    createHash("sha256").update(data).digest("hex"),
  );
});
