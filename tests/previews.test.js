const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { PreviewService } = require("../src/main/previews/PreviewService");
const { temporary } = require("./helpers");
const { mediaFixture } = require("./media-fixture");

test("completed previews are generated once per file version and cached as bounded JPEG data", async (t) => {
  const dir = await temporary(t);
  const file = path.join(dir, "large-video.mp4");
  await fs.writeFile(file, Buffer.alloc(2 * 1024 * 1024, 7));
  let generated = 0;
  const nativeImage = {
    createThumbnailFromPath: async (source, size) => {
      generated++;
      assert.equal(source, file);
      assert.deepEqual(size, { width: 160, height: 100 });
      return {
        isEmpty: () => false,
        toJPEG: (quality) => {
          assert.equal(quality, 76);
          return Buffer.from("small-jpeg-preview");
        },
      };
    },
  };
  const service = new PreviewService({
    userDataPath: dir,
    binPath: dir,
    nativeImage,
  });
  t.after(() => service.close());
  const item = {
    id: "complete",
    status: "completed",
    category: "Video",
    filePath: file,
  };
  const first = await service.get(item);
  const second = await service.get(item);
  assert.equal(
    first.url,
    `data:image/jpeg;base64,${Buffer.from("small-jpeg-preview").toString("base64")}`,
  );
  assert.equal(second.url, first.url);
  assert.equal(generated, 1);
  await fs.writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1, 8));
  await service.get(item);
  assert.equal(generated, 2, "changed files receive a fresh cache key");
  const cache = await fs.readdir(path.join(dir, "preview-cache"));
  assert.equal(cache.filter((name) => name.endsWith(".jpg")).length, 2);
});

test("application downloads use their embedded operating-system icon when available", async (t) => {
  const dir = await temporary(t);
  const file = path.join(dir, "BraveBrowserSetup.exe");
  await fs.writeFile(file, Buffer.from("installer"));
  let requestedPath;
  const service = new PreviewService({
    userDataPath: dir,
    getFileIcon: async (source, options) => {
      requestedPath = source;
      assert.deepEqual(options, { size: "large" });
      return {
        isEmpty: () => false,
        resize: (size) => {
          assert.deepEqual(size, { width: 160, height: 100, quality: "best" });
          return { toJPEG: () => Buffer.from("embedded-app-icon") };
        },
      };
    },
  });
  t.after(() => service.close());
  const result = await service.get({
    id: "brave-installer",
    status: "completed",
    category: "Applications",
    filePath: file,
  });
  assert.equal(requestedPath, file);
  assert.equal(
    result.url,
    `data:image/jpeg;base64,${Buffer.from("embedded-app-icon").toString("base64")}`,
  );
});

test("REAL FFmpeg preview extracts a small cached JPEG without loading the video into memory", async (t) => {
  const fixture = await mediaFixture(t);
  if (!fixture) return;
  const service = new PreviewService({
    userDataPath: fixture.dir,
    binPath: path.resolve("bin"),
  });
  t.after(() => service.close());
  const result = await service.get({
    status: "completed",
    category: "Video",
    filePath: path.join(fixture.dir, "video.mp4"),
  });
  assert.ok(result.url?.startsWith("data:image/jpeg;base64,"));
  const jpeg = Buffer.from(result.url.split(",")[1], "base64");
  assert.equal(jpeg.subarray(0, 3).toString("hex"), "ffd8ff");
  assert.ok(jpeg.length < 300 * 1024);
  assert.equal(
    (
      await service.get({
        status: "completed",
        category: "Video",
        filePath: path.join(fixture.dir, "video.mp4"),
      })
    ).url,
    result.url,
  );
});

test("preview failures and non-file/incomplete items fall back without reading or failing the library", async (t) => {
  const dir = await temporary(t);
  const service = new PreviewService({
    userDataPath: dir,
    binPath: path.join(dir, "missing-tools"),
  });
  t.after(() => service.close());
  assert.deepEqual(
    await service.get({ status: "downloading", filePath: dir }),
    { url: null },
  );
  assert.deepEqual(await service.get({ status: "completed", filePath: dir }), {
    url: null,
  });
  assert.deepEqual(
    await service.get({
      status: "completed",
      category: "Other",
      filePath: path.join(dir, "missing.bin"),
    }),
    { url: null },
  );
});
