const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { execFileSync } = require("node:child_process");
const {
  normalizeFormats,
  normalizeThumbnails,
  normalizeSubtitles,
} = require("../src/main/media/formats");
const { MediaDetector } = require("../src/main/media/MediaDetector");
const { YtDlpWrapper } = require("../src/main/media/YtDlpWrapper");
const { MediaEngine } = require("../src/main/media/MediaEngine");
const { temporary, fixtureServer, waitFor, checksum } = require("./helpers");
const { createServices } = require("../src/main/services");
const binPath = path.resolve(__dirname, "../bin");
const ffmpeg = path.join(
  binPath,
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
const ffprobe = path.join(
  binPath,
  process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
);

test("playlist extraction returns bounded normalized entries without losing YouTube IDs", async () => {
  let command;
  const wrapper = new YtDlpWrapper({
    executable: "yt-dlp-test",
    spawnProcess: (_exe, args) => {
      command = args;
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setImmediate(() => {
        child.stdout.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              title: "Playlist",
              extractor_key: "YoutubeTab",
              entries: [
                { id: "abc123", title: "First" },
                { webpage_url: "https://youtu.be/second", title: "Second" },
              ],
            }),
          ),
        );
        child.emit("close", 0);
      });
      return child;
    },
  });
  const result = await wrapper.getPlaylist(
    "https://www.youtube.com/playlist?list=PL123",
  );
  assert.ok(command.includes("--flat-playlist"));
  assert.equal(result.title, "Playlist");
  assert.deepEqual(
    result.entries.map((entry) => entry.url),
    ["https://www.youtube.com/watch?v=abc123", "https://youtu.be/second"],
  );
});

test("format normalization hides storyboards, DRM and true duplicates; preserves codec / audio distinctions", () => {
  const formats = normalizeFormats({
    formats: [
      {
        format_id: "sb0",
        url: "https://test/sb",
        ext: "mhtml",
        vcodec: "none",
        acodec: "none",
      },
      {
        format_id: "drm",
        url: "https://test/v",
        ext: "mp4",
        vcodec: "avc1",
        has_drm: true,
      },
      {
        format_id: "137",
        url: "https://test/v",
        ext: "mp4",
        height: 1080,
        width: 1920,
        fps: 30,
        vcodec: "avc1",
        acodec: "none",
        filesize: 10000,
      },
      {
        format_id: "137duplicate",
        url: "https://test/v2",
        ext: "mp4",
        height: 1080,
        width: 1920,
        fps: 30,
        vcodec: "avc1",
        acodec: "none",
        filesize: 10000,
      },
      {
        format_id: "248",
        url: "https://test/v3",
        ext: "webm",
        height: 1080,
        width: 1920,
        fps: 60,
        vcodec: "vp9",
        acodec: "none",
        filesize_approx: 9000,
      },
      {
        format_id: "140",
        url: "https://test/a",
        ext: "m4a",
        vcodec: "none",
        acodec: "mp4a",
        abr: 128,
      },
    ],
  });
  assert.equal(formats.length, 3);
  assert.equal(formats.find((f) => f.formatId === "137").mergeAudio, true);
  assert.equal(formats.find((f) => f.formatId === "140").filesize, null);
  assert.equal(formats.find((f) => f.formatId === "248").approximateSize, true);
});
test("direct generic media with unreported codecs remains downloadable without claiming it has audio", () => {
  const [format] = normalizeFormats({
    formats: [{ format_id: "0", url: "https://test/file.mp4", ext: "mp4" }],
  });
  assert.equal(format.group, "video");
  assert.equal(format.audioUnknown, true);
  assert.equal(format.mergeAudio, false);
  assert.equal(format.hasAudio, false);
});
test("thumbnail and subtitle catalogs retain legitimate metadata and reject unsafe URLs", () => {
  const thumbnails = normalizeThumbnails({
    thumbnail: "https://img.example.test/maxres.jpg",
    thumbnails: [
      { url: "javascript:alert(1)", width: 9999 },
      {
        url: "https://img.example.test/small.webp",
        width: 320,
        height: 180,
        ext: "webp",
      },
      { url: "https://img.example.test/maxres.jpg", width: 1280, height: 720 },
    ],
  });
  assert.equal(thumbnails.length, 2);
  assert.equal(thumbnails[0].width, 1280);
  assert.equal(thumbnails[1].ext, "webp");
  const subtitles = normalizeSubtitles({
    subtitles: {
      en: [
        {
          ext: "vtt",
          url: "https://media.example.test/en.vtt",
          name: "English",
        },
        { ext: "srt", url: "file:///etc/passwd" },
      ],
    },
    automatic_captions: {
      fr: [
        {
          ext: "json3",
          url: "https://media.example.test/fr.json3",
          name: "French auto",
        },
      ],
    },
  });
  assert.deepEqual(
    subtitles.map((track) => [track.id, track.formats]),
    [
      ["manual:en", ["vtt"]],
      ["automatic:fr", ["json3"]],
    ],
  );
  assert.equal(subtitles[1].automatic, true);
});
test("media selections are validated against a recent analysis, not arbitrary renderer commands", async () => {
  const detector = new MediaDetector({
    wrapper: {
      getFormats: async () => ({
        title: "test",
        description: "Full description",
        tags: ["audio", "test"],
        formats: [{ formatId: "140", group: "audio", ext: "m4a" }],
        thumbnails: [
          {
            id: "thumbnail-0",
            url: "https://img.example.test/a.jpg",
            label: "1280 × 720",
            ext: "jpg",
            httpHeaders: { Referer: "https://example.test/" },
          },
        ],
        subtitles: [
          {
            id: "manual:en",
            language: "en",
            automatic: false,
            formats: ["vtt"],
          },
        ],
      }),
      availability: async () => ({ ytdlp: true, ffmpeg: true }),
    },
  });
  const result = await detector.getFormats("https://example.test/media");
  assert.equal(
    detector.selection({ analysisId: result.analysisId, formatId: "140" }).media
      .audioOnly,
    true,
  );
  assert.equal(result.description, "Full description");
  assert.deepEqual(result.tags, ["audio", "test"]);
  const subtitle = detector.subtitleSelection({
    analysisId: result.analysisId,
    languageId: "manual:en",
    format: "srt",
  });
  assert.deepEqual(subtitle.media.subtitle, {
    language: "en",
    automatic: false,
    format: "srt",
    sourceFormats: ["vtt"],
  });
  const thumbnail = detector.thumbnailSelection({
    analysisId: result.analysisId,
    thumbnailId: "thumbnail-0",
  });
  assert.equal(thumbnail.filename, "test [1280 × 720].jpg");
  assert.equal(thumbnail.headers.Referer, "https://example.test/");
  assert.throws(
    () =>
      detector.thumbnailSelection({
        analysisId: result.analysisId,
        thumbnailId: "missing",
      }),
    /available/,
  );
  assert.throws(
    () =>
      detector.selection({ analysisId: result.analysisId, formatId: "--exec" }),
    /available/,
  );
  assert.throws(
    () => detector.selection({ analysisId: "missing", formatId: "140" }),
    /expired/,
  );
});
test("a successful tool exit without an actual file is NOT a completed download", async (t) => {
  const dir = await temporary(t);
  const engine = new MediaEngine(
    {
      id: "no-output",
      url: "https://example.test/x",
      savePath: dir,
      media: { title: "test", formatId: "140" },
      timeout: 30000,
    },
    { download: async () => {} },
  );
  let error;
  engine.on("error", (_id, e) => {
    error = e;
  });
  await engine.start();
  assert.equal(engine.status, "failed");
  assert.match(error.message, /output file/);
});
const { mediaFixture } = require("./media-fixture");
for (const page of ["watch.html", "listen.html", "adaptive.mpd"]) {
  test(
    `REAL yt-dlp / FFmpeg: extracts and downloads ${page}${page === "adaptive.mpd" ? " with audio merging" : ""}`,
    { timeout: 45000 },
    async (t) => {
      const fixture = await mediaFixture(t);
      if (!fixture) return;
      const { wrapper, server, dir } = fixture;
      const info = await wrapper.getFormats(`${server.url}/${page}`);
      assert.ok(info.formats.length > 0, JSON.stringify(info));
      const format = info.formats.find((f) =>
        page === "listen.html"
          ? f.group === "audio"
          : page === "adaptive.mpd"
            ? f.mergeAudio
            : f.group === "video",
      );
      assert.ok(format, JSON.stringify(info.formats));
      const engine = new MediaEngine(
        {
          id: `real-${page}`,
          url: `${server.url}/${page}`,
          savePath: path.join(dir, "out"),
          media: {
            title: "Integration media",
            formatId: format.formatId,
            mergeAudio: format.mergeAudio,
          },
          timeout: 30000,
        },
        wrapper,
      );
      const progress = [];
      let failure, completed;
      engine.on("progress", (_id, p) => progress.push(p));
      engine.on("complete", (_id, d) => {
        completed = d;
      });
      engine.on("error", (_id, e) => {
        failure = e;
      });
      await engine.start();
      assert.equal(failure, undefined, failure?.message);
      assert.equal(engine.status, "completed");
      assert.ok(completed.totalSize > 0);
      assert.equal(
        completed.approximateSize,
        false,
        "actual output stat is not an estimated network total",
      );
      assert.ok(progress.some((p) => p.downloadedSize > 0));
      const streams = JSON.parse(
        execFileSync(
          ffprobe,
          ["-v", "error", "-show_streams", "-of", "json", completed.filePath],
          { encoding: "utf8" },
        ),
      ).streams;
      if (page === "listen.html")
        assert.ok(streams.every((s) => s.codec_type !== "video"));
      else {
        assert.ok(streams.some((s) => s.codec_type === "video"));
        assert.ok(streams.some((s) => s.codec_type === "audio"));
      }
    },
  );
}

test(
  "REAL metadata and independent subtitles: description, thumbnail and VTT → SRT output",
  { timeout: 45000 },
  async (t) => {
    const fixture = await mediaFixture(t);
    if (!fixture) return;
    const { wrapper, server, dir } = fixture;
    const info = await wrapper.getFormats(`${server.url}/watch.html`);
    assert.match(info.description, /Full integration description/);
    assert.ok(
      info.thumbnails.some((image) => image.url.endsWith("/poster.jpg")),
    );
    const subtitle = info.subtitles.find(
      (track) => track.language === "en" && !track.automatic,
    );
    assert.ok(subtitle, JSON.stringify(info.subtitles));
    let completed;
    const engine = new MediaEngine(
      {
        id: "real-subtitle",
        url: `${server.url}/watch.html`,
        savePath: path.join(dir, "captions"),
        media: {
          type: "subtitle",
          title: "Caption integration",
          subtitle: {
            language: "en",
            automatic: false,
            format: "srt",
            sourceFormats: subtitle.formats,
          },
        },
        timeout: 30000,
      },
      wrapper,
    );
    engine.on("complete", (_id, value) => (completed = value));
    engine.on("error", () => {});
    await engine.start();
    assert.equal(engine.status, "completed");
    assert.ok(completed?.filePath.endsWith(".srt"));
    const content = await fs.readFile(completed.filePath, "utf8");
    assert.match(content, /GetANNY caption integration/);
    assert.match(content, /00:00:00,000 --> 00:00:01,500/);
    assert.ok(completed.totalSize > 0);
  },
);
test("adaptive progress never reports the first stream as the entire download", async (t) => {
  const dir = await temporary(t);
  const output = path.join(dir, "Adaptive [progress].mp4");
  let first;
  const wrapper = {
    async download({ onProgress, onFile }) {
      onProgress({
        filename: "video.mp4",
        downloaded_bytes: 100,
        total_bytes_estimate: 100,
        status: "finished",
      });
      first = events.at(-1);
      onProgress({
        filename: "audio.m4a",
        downloaded_bytes: 20,
        total_bytes: 30,
        status: "downloading",
      });
      await fs.writeFile(output, Buffer.from("actual fixture bytes"));
      onFile(output);
    },
  };
  const engine = new MediaEngine(
      {
        id: "progress",
        url: "https://example.com/watch",
        savePath: dir,
        media: { title: "Adaptive", formatId: "v1", mergeAudio: true },
        timeout: 30000,
      },
      wrapper,
    ),
    events = [];
  engine.on("progress", (_id, event) => events.push(event));
  engine.on("error", (_id, error) => {
    throw error;
  });
  await engine.start();
  assert.equal(first.totalSize, 0);
  assert.notEqual(first.phase, "Finalizing media");
  assert.equal(events[1].totalSize, 130);
  assert.equal(events[1].downloadedSize, 120);
  assert.equal(
    events[1].approximateSize,
    true,
    "one estimated track makes the combined total an estimate",
  );
});

test("an explicitly silent video remains downloadable without requiring a nonexistent audio stream", () => {
  const [format] = normalizeFormats({
    formats: [
      {
        format_id: "silent",
        url: "https://example.test/silent.mp4",
        ext: "mp4",
        vcodec: "avc1",
        acodec: "none",
      },
    ],
  });
  assert.equal(format.hasVideo, true);
  assert.equal(format.hasAudio, false);
  assert.equal(format.audioUnknown, false);
  assert.equal(format.mergeAudio, false);
});

test(
  "REAL yt-dlp / FFmpeg: selected media segment is trimmed and keeps its timestamped filename",
  { timeout: 45000 },
  async (t) => {
    const fixture = await mediaFixture(t);
    if (!fixture) return;
    const dir = await temporary(t, "getanny-media-segment-");
    const url = `${fixture.server.url}/video.mp4`;
    const metadata = await fixture.wrapper.getFormats(url);
    const format = metadata.formats.find((item) => item.group === "video");
    assert.ok(format);
    const engine = new MediaEngine(
      {
        id: "real-segment",
        url,
        savePath: dir,
        media: {
          title: "Segment fixture",
          formatId: format.formatId,
          mergeAudio: false,
          segment: { start: 1, end: 2 },
        },
        timeout: 30000,
      },
      fixture.wrapper,
    );
    engine.on("error", () => {});
    await engine.start();
    assert.equal(engine.status, "completed");
    assert.match(engine.filename, /Segment fixture_00m01s-00m02s\.mp4$/);
    const duration = Number(
      execFileSync(
        ffprobe,
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          path.join(dir, engine.filename),
        ],
        { encoding: "utf8" },
      ).trim(),
    );
    assert.ok(
      duration >= 0.8 && duration <= 1.5,
      `Unexpected segment duration: ${duration}s`,
    );
  },
);

test(
  "REAL managed media: pause, process/database restart, ranged continuation, cancel and retry verify physical bytes",
  { timeout: 120000 },
  async (t) => {
    // Official Windows yt-dlp uses a larger Python output buffer than the
    // local Python runtime. Generate >128 KiB of genuine CBR video so an
    // incomplete, physically flushed partial exists on both platforms.
    const fixture = await mediaFixture(t, { largeVideo: true });
    if (!fixture) return;
    assert.ok(
      (await fs.stat(path.join(fixture.dir, "video.mp4"))).size > 256 * 1024,
      "large real fixture must exceed Python output buffering",
    );
    const folder = await temporary(t, "getanny-media-lifecycle-");
    const options = {
      userDataPath: path.join(folder, "data"),
      downloadPath: path.join(folder, "downloads"),
      binPath,
      extensionPath: path.resolve("dist-extension"),
      port: 0,
    };
    let services = await createServices(options);
    try {
      // Slow the initial attempt enough that a pause cannot race the final
      // buffered bytes of this short fixture; resume at a normal test rate.
      await services.settings.set("speedLimit", 32 * 1024);
      await services.settings.set("retryAttempts", 0);
      const analysis = await services.mediaDetector.getFormats(
        fixture.server.url + "/watch.html",
      );
      const format = analysis.formats.find((item) => item.group === "video");
      assert.ok(format);
      const selection = services.mediaDetector.selection({
        analysisId: analysis.analysisId,
        formatId: format.formatId,
      });
      const id = await services.manager.addMedia(selection);
      await waitFor(
        async () => {
          const item = services.manager.requireItem(id);
          if (["completed", "failed", "cancelled"].includes(item.status))
            throw new Error(
              `Media left its partial state before pause: ${JSON.stringify({ status: item.status, error: item.error, bytes: item.downloadedSize, files: await fs.readdir(options.downloadPath) })}`,
            );
          if (item.downloadedSize <= 0) return false;
          // Work data lives outside the destination; users must only see the
          // final media file.
          const work = path.join(options.userDataPath, "transfer-temp", id);
          const names = await fs.readdir(work).catch(() => []);
          assert.ok(
            !(await fs.readdir(options.downloadPath)).some((name) =>
              name.includes(`[${id}]`),
            ),
            "destination must not expose internal media fragments",
          );
          for (const name of names.filter((name) => name.endsWith(".part")))
            if ((await fs.stat(path.join(work, name))).size > 0) return true;
          return false;
        },
        40000,
        "actual media partial bytes flushed before pause",
      );
      await services.manager.pause(id);
      await waitFor(() => !services.manager.running.has(id));
      assert.equal(services.manager.requireItem(id).status, "paused");
      const work = path.join(options.userDataPath, "transfer-temp", id);
      const partials = (await fs.readdir(work)).filter((name) =>
        name.endsWith(".part"),
      );
      assert.ok(
        partials.length > 0,
        "actual continuation partial must exist in private work storage",
      );
      assert.ok(
        (await fs.stat(path.join(work, partials[0]))).size > 0,
        "partial must physically contain bytes before restart",
      );
      assert.ok(
        !(await fs.readdir(options.downloadPath)).some((name) =>
          name.includes(`[${id}]`),
        ),
        "destination stays clean while a media transfer is paused",
      );
      await services.close();
      services = await createServices(options);
      assert.equal(services.manager.requireItem(id).status, "paused");
      await services.settings.set("speedLimit", 128 * 1024);
      const resumeRequestsFrom = fixture.server.state.requests.length;
      services.manager.resume(id);
      await waitFor(
        () =>
          ["completed", "failed"].includes(
            services.manager.requireItem(id).status,
          ),
        30000,
        "media after real restart",
      );
      const resumed = services.manager.requireItem(id);
      assert.equal(resumed.status, "completed", resumed.error);
      assert.equal(
        checksum(await fs.readFile(resumed.filePath)),
        checksum(await fs.readFile(path.join(fixture.dir, "video.mp4"))),
      );
      assert.ok(
        fixture.server.state.requests
          .slice(resumeRequestsFrom)
          .some((request) => /^bytes=[1-9]\d*-/.test(request.range || "")),
        `yt-dlp actually requested remaining bytes: ${JSON.stringify(fixture.server.state.requests)}`,
      );
      const cancelled = await services.manager.addMedia(selection);
      await waitFor(
        () => services.manager.requireItem(cancelled).downloadedSize > 0,
        20000,
        "real media before cancellation",
      );
      await services.manager.cancel(cancelled);
      await waitFor(() => !services.manager.running.has(cancelled));
      assert.equal(services.manager.requireItem(cancelled).status, "cancelled");
      assert.ok(
        !(await fs.readdir(options.downloadPath)).some((name) =>
          name.includes(`[${cancelled}]`),
        ),
        "owned cancelled media and partials must be removed",
      );
      services.manager.retry(cancelled);
      await waitFor(
        () =>
          ["completed", "failed"].includes(
            services.manager.requireItem(cancelled).status,
          ),
        30000,
        "real media retry",
      );
      const retried = services.manager.requireItem(cancelled);
      assert.equal(retried.status, "completed", retried.error);
      assert.equal(
        checksum(await fs.readFile(retried.filePath)),
        checksum(await fs.readFile(path.join(fixture.dir, "video.mp4"))),
      );
    } finally {
      await services.close();
    }
  },
);

test("media partial cleanup cannot delete a different file sharing only the old eight-character prefix", async (t) => {
  const folder = await temporary(t),
    id = "12345678-1111-2222-3333-444444444444";
  const unrelated = path.join(folder, "Keep [12345678].txt"),
    owned = path.join(folder, `Media [${id}].mp4.part`);
  await fs.writeFile(unrelated, "preserve this separate file");
  await fs.writeFile(owned, "partial");
  const engine = new MediaEngine({ id, savePath: folder }, undefined);
  await engine.cleanup();
  assert.equal(
    await fs.readFile(unrelated, "utf8"),
    "preserve this separate file",
  );
  await assert.rejects(fs.access(owned), { code: "ENOENT" });
});

test("caption conversion produces valid SRT and VTT documents", () => {
  const { vttToSrt, srtToVtt } = require("../src/main/media/subtitles");
  const vtt =
    "WEBVTT\n\nNOTE generated\n\n1\n00:00:01.500 --> 00:00:03.250 line:90%\nHello <b>world</b>\n\n00:04.000 --> 00:05.000\nSecond cue\n";
  const srt = vttToSrt(vtt);
  assert.equal(
    srt,
    "1\n00:00:01,500 --> 00:00:03,250\nHello world\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond cue\n",
  );
  const back = srtToVtt(srt);
  assert.match(back, /^WEBVTT\n/);
  assert.match(back, /00:00:01\.500 --> 00:00:03\.250/);
});

test("subtitle downloads use the analyzed track URL and convert locally without yt-dlp", async (t) => {
  const http = require("node:http");
  const dir = await temporary(t, "getanny-subtitle-");
  const server = http.createServer((request, response) => {
    if (request.url === "/captions/ar.vtt") {
      response.writeHead(200, { "content-type": "text/vtt" });
      response.end("WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nمرحبا بالعالم\n");
      return;
    }
    response.writeHead(404).end("missing");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let completed;
  const engine = new MediaEngine(
    {
      id: "caption-direct",
      url: `${base}/watch`,
      savePath: path.join(dir, "out"),
      tempPath: path.join(dir, "work"),
      media: {
        type: "subtitle",
        title: "Arabic captions",
        subtitle: {
          language: "ar",
          automatic: false,
          format: "srt",
          sourceFormats: ["vtt"],
          sources: { vtt: `${base}/captions/ar.vtt` },
        },
      },
    },
    {
      downloadSubtitles: async () => {
        throw new Error("yt-dlp must not be needed for a direct caption track");
      },
    },
  );
  engine.on("complete", (id, data) => (completed = data));
  await engine.start();
  assert.ok(completed, engine.status);
  const saved = await fs.readFile(completed.filePath, "utf8");
  assert.match(saved, /^1\n00:00:02,000 --> 00:00:04,000\nمرحبا بالعالم/);
  assert.equal(completed.filename, "Arabic captions.ar.srt");
  await assert.rejects(fs.access(path.join(dir, "work")));
});
