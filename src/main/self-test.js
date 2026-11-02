// Explicit diagnostic mode used against the INSTALLED application in Windows CI.
// No mocks, external test runners, or dev dependencies are required at runtime.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const fss = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn, execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { CHROMIUM_ID } = require("./browser-integration/catalog");
const { WebSocket } = require("ws");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function until(predicate, label, timeout = 25000) {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeout) throw new Error(`Timed out: ${label}`);
    await sleep(25);
  }
}
async function checkBrowserPreparation(s, portable) {
  const detected = await s.browserDetector.detect();
  assert.equal(detected.length, 8);
  if (portable) {
    // The portable launcher extracts to a temporary directory. Registering a
    // persistent native host would leave a broken path after it exits.
    await assert.rejects(s.prepareBrowser("chromium"), /portable launcher/i);
    const prepared = await s.extensionInstaller.install("chromium");
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.installed, null);
  } else {
    const prepared = await s.prepareBrowser("chromium");
    assert.equal(prepared.prepared, true);
    assert.equal(prepared.installed, null);
    assert.equal(
      (await s.nativeMessagingHost.check("chromium")).registered,
      true,
    );
  }
  return detected.map(({ id, installed }) => ({ id, installed }));
}
async function runSelfTest({ services: s, win, app, binPath, userDataPath }) {
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
  const checks = [];
  const check = async (name, callback) => {
    const start = Date.now();
    try {
      const detail = await callback();
      checks.push({
        name,
        passed: true,
        ms: Date.now() - start,
        detail: detail || null,
      });
    } catch (error) {
      checks.push({
        name,
        passed: false,
        ms: Date.now() - start,
        error: error.stack,
      });
    }
  };
  const folder = path.join(userDataPath, "self-test");
  await fs.mkdir(folder, { recursive: true });
  const data = Buffer.alloc(8 * 1024 * 1024);
  for (let i = 0; i < data.length; i++) data[i] = i % 251;
  const video = path.join(folder, "fixture.mp4"),
    audio = path.join(folder, "audio.m4a"),
    silent = path.join(folder, "silent.mp4");
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/missing") {
        response.writeHead(404);
        response.end("missing");
        return;
      }
      if (pathname === "/watch.html" || pathname === "/listen.html") {
        response.setHeader("Content-Type", "text/html");
        response.end(
          `<html><title>Installed GetANNY media test</title>${pathname === "/watch.html" ? '<video src="/fixture.mp4"></video>' : '<audio src="/audio.m4a"></audio>'}</html>`,
        );
        return;
      }
      if (pathname === "/adaptive.mpd") {
        response.setHeader("Content-Type", "application/dash+xml");
        response.end(
          `<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT3S" minBufferTime="PT1S"><Period duration="PT3S"><AdaptationSet mimeType="video/mp4" contentType="video"><Representation id="v1" bandwidth="300000" width="320" height="180" frameRate="15" codecs="avc1.64000c"><BaseURL>silent.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet mimeType="audio/mp4" contentType="audio"><Representation id="a1" bandwidth="128000" audioSamplingRate="44100" codecs="mp4a.40.2"><BaseURL>audio.m4a</BaseURL></Representation></AdaptationSet></Period></MPD>`,
        );
        return;
      }
      const media = ["/fixture.mp4", "/audio.m4a", "/silent.mp4"].includes(
        pathname,
      );
      const body = media
        ? await fs.readFile(path.join(folder, path.basename(pathname)))
        : data;
      response.setHeader(
        "Content-Type",
        media
          ? pathname.endsWith(".m4a")
            ? "audio/mp4"
            : "video/mp4"
          : "application/octet-stream",
      );
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("ETag", '"installed-test-v1"');
      let start = 0,
        end = body.length - 1;
      const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
      if (range) {
        start = +range[1];
        end = range[2] ? Math.min(+range[2], end) : end;
        response.statusCode = 206;
        response.setHeader(
          "Content-Range",
          `bytes ${start}-${end}/${body.length}`,
        );
      }
      response.setHeader("Content-Length", end - start + 1);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      let cursor = start,
        stopped = false,
        timer;
      response.on("close", () => {
        stopped = true;
        clearTimeout(timer);
      });
      const write = () => {
        if (stopped) return;
        if (cursor > end) {
          response.end();
          return;
        }
        const next = Math.min(end + 1, cursor + 65536);
        const ok = response.write(body.subarray(cursor, next));
        cursor = next;
        if (ok) timer = setTimeout(write, media ? 0 : 25);
        else
          response.once("drain", () => {
            timer = setTimeout(write, media ? 0 : 25);
          });
      };
      write();
    } catch (error) {
      response.destroy(error);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  await s.settings.set("defaultDownloadPath", path.join(folder, "downloads"));
  await s.settings.set("autoStartDownloads", true);
  await s.settings.set("firstRunCompleted", true);
  // Let the separate installed lifecycle harness close the REAL native window
  // gracefully after cold/shortcut launches, instead of force-killing a tray app.
  await s.settings.set("closeToTray", false);
  await s.settings.set("retryAttempts", 0);
  await s.settings.set("maxConnectionsPerDownload", 4);
  const finish = async (id) => {
    await until(
      () => ["completed", "failed"].includes(s.manager.requireItem(id).status),
      "download completion",
      45000,
    );
    const item = s.manager.requireItem(id);
    assert.equal(item.status, "completed", item.error);
    return item;
  };
  const rendererErrors = [];
  win.webContents.on("console-message", (event, level, message) => {
    if (event.level === "error" || level === 3)
      rendererErrors.push(event.message || message);
  });
  try {
    await check(
      "Installed renderer / isolated preload / real IPC",
      async () => {
        await until(
          () =>
            win.webContents.executeJavaScript(
              "!!document.querySelector('.sidebar')",
            ),
          "renderer bootstrap",
        );
        const result = await win.webContents.executeJavaScript(
          "window.getanny.invoke('app:bootstrap')",
        );
        assert.equal(result.desktop, true);
        assert.equal(result.version, app.getVersion());
        assert.ok(win.webContents.getURL().startsWith("file://"));
        return { renderer: win.webContents.getURL(), version: result.version };
      },
    );
    await check(
      "Real window buttons minimize, maximize and restore with correct renderer state",
      async () => {
        const click = (label) =>
          win.webContents.executeJavaScript(
            `document.querySelector('button[aria-label="${label}"]').click()`,
          );
        await click("Maximize window");
        await until(() => win.isMaximized(), "actual native maximize");
        await until(
          () =>
            win.webContents.executeJavaScript(
              `!!document.querySelector('button[aria-label="Restore window"]')`,
            ),
          "renderer maximized state",
        );
        await click("Restore window");
        await until(() => !win.isMaximized(), "actual native restore");
        await until(
          () =>
            win.webContents.executeJavaScript(
              `!!document.querySelector('button[aria-label="Maximize window"]')`,
            ),
          "renderer restored state",
        );
        await click("Minimize window");
        await until(() => win.isMinimized(), "actual native minimize");
        win.restore();
        win.show();
        await until(() => !win.isMinimized(), "restore after minimization");
      },
    );
    await check("HTTP segmented transfer and exact SHA-256", async () => {
      const item = await finish(
        await s.manager.addDownload({
          url: base + "/file.bin",
          filename: "installed-http.bin",
        }),
      );
      assert.equal(hash(await fs.readFile(item.filePath)), hash(data));
      return { bytes: item.totalSize, connections: item.connections };
    });
    await check("Public HTTPS with normal certificate validation", async () => {
      const item = await finish(
        await s.manager.addDownload({
          url: "https://registry.npmjs.org/react/latest",
          filename: "https-package.json",
        }),
      );
      const info = JSON.parse(await fs.readFile(item.filePath, "utf8"));
      assert.equal(info.name, "react");
      return { bytes: item.totalSize };
    });
    await check("Pause and resume preserve valid pieces", async () => {
      const id = await s.manager.addDownload({
        url: base + "/resume.bin",
        filename: "installed-resume.bin",
      });
      await until(
        () => s.manager.requireItem(id).downloadedSize > 0,
        "first bytes",
      );
      await s.manager.pause(id);
      assert.equal(s.manager.requireItem(id).status, "paused");
      await until(() => !s.manager.running.has(id), "slot released");
      s.manager.resume(id);
      const item = await finish(id);
      assert.equal(hash(await fs.readFile(item.filePath)), hash(data));
    });
    await check(
      "Cancellation removes partials and cannot complete",
      async () => {
        const id = await s.manager.addDownload({
          url: base + "/cancel.bin",
          filename: "installed-cancel.bin",
        });
        await until(
          () => s.manager.requireItem(id).downloadedSize > 0,
          "bytes before cancellation",
        );
        await s.manager.cancel(id);
        assert.equal(s.manager.requireItem(id).status, "cancelled");
        assert.ok(
          !(await fs.readdir(s.settings.get("defaultDownloadPath"))).some(
            (name) => name.includes(id),
          ),
        );
      },
    );
    await check(
      "Failed HTTP request is persisted with an informative error",
      async () => {
        const id = await s.manager.addDownload({ url: base + "/missing" });
        await until(
          () => s.manager.requireItem(id).status === "failed",
          "404 failure",
        );
        assert.match(s.downloadsRepo.get(id).error, /404/);
      },
    );
    await check(
      "Actual bundled FFmpeg / video / audio / adaptive media merging",
      async () => {
        const ffmpeg = path.join(
            binPath,
            process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
          ),
          ffprobe = path.join(
            binPath,
            process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
          );
        execFileSync(
          ffmpeg,
          [
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=15",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440",
            "-t",
            "3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            video,
          ],
          { windowsHide: true },
        );
        execFileSync(
          ffmpeg,
          ["-y", "-v", "error", "-i", video, "-an", "-c:v", "copy", silent],
          { windowsHide: true },
        );
        execFileSync(
          ffmpeg,
          ["-y", "-v", "error", "-i", video, "-vn", "-c:a", "copy", audio],
          { windowsHide: true },
        );
        const outputs = [];
        for (const page of ["watch.html", "listen.html", "adaptive.mpd"]) {
          const result = await s.mediaDetector.getFormats(base + "/" + page);
          const format = result.formats.find((format) =>
            page === "listen.html"
              ? format.group === "audio"
              : page === "adaptive.mpd"
                ? format.mergeAudio
                : format.group === "video",
          );
          assert.ok(format, `No format for ${page}`);
          const item = await finish(
            await s.manager.addMedia(
              s.mediaDetector.selection({
                analysisId: result.analysisId,
                formatId: format.formatId,
              }),
            ),
          );
          const streams = JSON.parse(
            execFileSync(
              ffprobe,
              ["-v", "error", "-show_streams", "-of", "json", item.filePath],
              { encoding: "utf8", windowsHide: true },
            ),
          ).streams;
          assert.ok(streams.some((stream) => stream.codec_type === "audio"));
          if (page !== "listen.html")
            assert.ok(streams.some((stream) => stream.codec_type === "video"));
          else
            assert.ok(!streams.some((stream) => stream.codec_type === "video"));
          outputs.push({ page, bytes: item.totalSize });
        }
        return outputs;
      },
    );
    await check(
      "Local TCP WebTorrent download and piece verification",
      async () => {
        const { default: WebTorrent } = await import("webtorrent");
        const client = new WebTorrent({
          dht: false,
          tracker: false,
          lsd: false,
          utp: false,
        });
        try {
          const seedFile = path.join(folder, "seed.txt");
          const payload = Buffer.alloc(1024 * 1024, 61);
          await fs.writeFile(seedFile, payload);
          const seeded = await new Promise((resolve, reject) => {
            client.once("error", reject);
            client.seed(seedFile, { announce: [], private: true }, resolve);
          });
          const torrentFile = path.join(folder, "local.torrent");
          await fs.writeFile(torrentFile, seeded.torrentFile);
          const id = await s.manager.addTorrent({ torrent: torrentFile });
          await until(
            () =>
              s.manager.running.get(id)?.torrent?.infoHash &&
              client.torrentPort > 0,
            "torrent creation",
          );
          s.manager.running
            .get(id)
            .torrent.addPeer(`127.0.0.1:${client.torrentPort}`);
          const item = await finish(id);
          assert.equal(hash(await fs.readFile(item.filePath)), hash(payload));
          return { bytes: item.totalSize };
        } finally {
          await new Promise((resolve) => client.destroy(resolve));
        }
      },
    );
    await check("Browser detection and real extension preparation", async () =>
      checkBrowserPreparation(s, portable),
    );
    await check(
      "Windows native executable → Electron Node → framed bridge → download",
      async () => {
        const registered = await s.nativeMessagingHost.register("chromium");
        const child = spawn(registered.hostPath, [], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        let buffer = Buffer.alloc(0),
          messages = [],
          stderr = "";
        child.stdout.on("data", (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          while (buffer.length >= 4) {
            const length = buffer.readUInt32LE(0);
            if (buffer.length < 4 + length) break;
            messages.push(JSON.parse(buffer.subarray(4, 4 + length)));
            buffer = buffer.subarray(4 + length);
          }
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        const send = (message) => {
          const body = Buffer.from(JSON.stringify(message)),
            header = Buffer.alloc(4);
          header.writeUInt32LE(body.length);
          child.stdin.write(Buffer.concat([header, body]));
        };
        try {
          send({
            type: "hello",
            requestId: "hello",
            browserId: "chromium",
            extensionId: CHROMIUM_ID,
            version: "self-test",
          });
          await until(
            () =>
              messages.some(
                (message) => message.type === "hello-result" && message.success,
              ),
            `native handshake ${stderr}`,
          );
          send({
            type: "download",
            requestId: "file",
            url: base + "/native.bin",
            filename: "native-test.bin",
          });
          await until(
            () =>
              messages.some(
                (message) => message.requestId === "file" && message.success,
              ),
            "native acknowledgement",
          );
          const response = messages.find(
            (message) => message.requestId === "file",
          );
          const item = await finish(response.id);
          assert.equal(hash(await fs.readFile(item.filePath)), hash(data));
          return {
            bytes: item.totalSize,
            transport: s.wsServer
              .status()
              .sessions.find((session) => session.browserId === "chromium")
              ?.transport,
          };
        } catch (error) {
          throw new Error(
            `${error.message}\nNative host exit: ${child.exitCode}; stderr: ${stderr}; received frames: ${JSON.stringify(messages)}`,
          );
        } finally {
          child.stdin.end();
          await sleep(150);
          if (child.exitCode === null) child.kill();
        }
      },
    );
    if (portable)
      await check("Portable paired WebSocket → download", async () => {
        const messages = [];
        const client = new WebSocket(
          `ws://127.0.0.1:${s.wsServer.status().port}`,
          {
            origin: `chrome-extension://${CHROMIUM_ID}`,
          },
        );
        client.on("message", (raw) =>
          messages.push(JSON.parse(raw.toString())),
        );
        client.on("error", () => {});
        try {
          await until(
            () => client.readyState === WebSocket.OPEN,
            "portable bridge connection",
          );
          client.send(
            JSON.stringify({
              type: "authenticate",
              token: s.identity.clientTokens.chromium,
              transport: "websocket",
            }),
          );
          await until(
            () => messages.some((message) => message.type === "authenticated"),
            "portable bridge authentication",
          );
          client.send(
            JSON.stringify({
              type: "hello",
              requestId: "portable-hello",
              browserId: "chromium",
              extensionId: CHROMIUM_ID,
            }),
          );
          await until(
            () =>
              messages.some(
                (message) =>
                  message.requestId === "portable-hello" && message.success,
              ),
            "portable bridge handshake",
          );
          client.send(
            JSON.stringify({
              type: "download",
              requestId: "portable-file",
              url: base + "/portable-bridge.bin",
              filename: "portable-bridge.bin",
            }),
          );
          await until(
            () =>
              messages.some(
                (message) =>
                  message.requestId === "portable-file" && message.success,
              ),
            "portable bridge acknowledgement",
          );
          const response = messages.find(
            (message) => message.requestId === "portable-file",
          );
          const item = await finish(response.id);
          assert.equal(hash(await fs.readFile(item.filePath)), hash(data));
          return { bytes: item.totalSize, transport: "websocket" };
        } finally {
          client.terminate();
        }
      });
    await check(
      "Persisted history, settings and actual process restart marker",
      async () => {
        const priorRun = s.settingsRepo.get("selfTestMarker") || null;
        await s.settings.set("theme", "midnight");
        s.settingsRepo.set("selfTestMarker", new Date().toISOString());
        assert.equal(s.settingsRepo.get("theme"), "midnight");
        assert.ok(s.downloadsRepo.byStatus("completed").length >= 4);
        return {
          priorRunObserved: !!priorRun,
          history: s.downloadsRepo.getAll().length,
        };
      },
    );
    await check("No renderer error messages", async () => {
      assert.deepEqual(rendererErrors, []);
    });
    await check(
      "Rendered layouts at 1320, 1024 and 760 pixel windows",
      async () => {
        const screenshots = [];
        for (const [width, height] of [
          [1320, 860],
          [1024, 768],
          [760, 600],
        ]) {
          win.setSize(width, height);
          await sleep(150);
          const overflow = await win.webContents.executeJavaScript(
            "(()=>{const e=document.querySelector('.main-content');return {client:e.clientWidth,scroll:e.scrollWidth}})()",
          );
          assert.ok(
            overflow.scroll <= overflow.client + 1,
            JSON.stringify(overflow),
          );
          const image = await win.webContents.capturePage();
          const filename = path.join(folder, `installed-${width}.png`);
          await fs.writeFile(filename, image.toPNG());
          screenshots.push(filename);
        }
        return screenshots;
      },
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await s.nativeMessagingHost.unregisterAll();
  }
  return {
    passed: checks.every((check) => check.passed),
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform,
    packaged: app.isPackaged,
    date: new Date().toISOString(),
    checks,
    rendererErrors,
    limitations: [
      "Automated Windows runner, not a pristine consumer Windows VM.",
      "Live third-party media sites, interactive installer dialogs and seven browser brands require manual validation.",
      "The framed native test is not itself evidence of installation into a real browser.",
    ],
  };
}
module.exports = { runSelfTest, checkBrowserPreparation };
