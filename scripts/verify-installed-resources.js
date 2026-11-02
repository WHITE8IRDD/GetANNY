const fs = require("node:fs/promises");
const path = require("node:path");
module.exports = async (context) => {
  if (context.electronPlatformName !== "win32") return;
  const resources = path.join(context.appOutDir, "resources");
  let updaterConfig;
  try {
    updaterConfig = await fs.readFile(
      path.join(resources, "app-update.yml"),
      "utf8",
    );
  } catch (error) {
    // MSI-only and portable-only builds do not produce updater metadata.
    // When NSIS is among the requested targets, electron-builder adds it and
    // the generated owner/repository must match the public release feed.
    if (error.code !== "ENOENT") throw error;
  }
  if (
    updaterConfig &&
    (!/^provider:\s*github\s*$/m.test(updaterConfig) ||
      !/^owner:\s*p4yy\s*$/m.test(updaterConfig) ||
      !/^repo:\s*GetANNY\s*$/m.test(updaterConfig))
  )
    throw new Error("Packaged updater configuration does not point to the public GetANNY release feed");
  const asar = require("@electron/asar");
  for (const file of [path.join("dist-renderer", "fonts", "OFL-Cairo.txt")]) {
    try {
      await asar.extractFile(path.join(resources, "app.asar"), file);
    } catch {
      throw new Error(`Packaged resource missing from app.asar: ${file}`);
    }
  }
  const rendererContents = await asar.extractFile(
    path.join(resources, "app.asar"),
    path.join("dist-renderer", "index.html"),
  );
  const cssFile = rendererContents
    .toString("utf8")
    .match(/assets\/index-[^"']+\.css/);
  if (!cssFile) throw new Error("Packaged renderer stylesheet is missing");
  const cssContents = await asar.extractFile(
    path.join(resources, "app.asar"),
    path.join("dist-renderer", cssFile[0].replaceAll("/", path.sep)),
  );
  const fontName = cssContents
    .toString("utf8")
    .match(/Cairo-Variable-[^"')]+\.ttf/);
  if (!fontName)
    throw new Error("Packaged Cairo font reference is missing from renderer");
  await asar.extractFile(
    path.join(resources, "app.asar"),
    path.join("dist-renderer", "assets", fontName[0]),
  );
  for (const file of [
    "bin/yt-dlp.exe",
    "bin/ffmpeg.exe",
    "bin/ffprobe.exe",
    "bin/GetANNY.NativeHost.exe",
    "bin/FFmpeg-LICENSE.txt",
    "bin/FFmpeg-SOURCE.txt",
    "native-host/native-host.js",
    "native-host/DesktopExitMarker.js",
    "native-host/node_modules/ws/index.js",
    "native-host/node_modules/ws/lib/websocket.js",
    "extension/chromium/manifest.json",
    "extension/firefox/manifest.json",
    "app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node",
    "app.asar.unpacked/node_modules/node-datachannel/build/Release/node_datachannel.node",
  ])
    await fs.access(path.join(resources, file)).catch(() => {
      throw new Error(`Packaged resource missing: ${file}`);
    });
  for (const file of [
    "yt-dlp.exe",
    "ffmpeg.exe",
    "ffprobe.exe",
    "GetANNY.NativeHost.exe",
  ]) {
    const handle = await fs.open(path.join(resources, "bin", file), "r");
    try {
      const prefix = Buffer.alloc(2);
      await handle.read(prefix, 0, 2, 0);
      if (prefix.toString() !== "MZ")
        throw new Error(`Not a real Windows executable: ${file}`);
    } finally {
      await handle.close();
    }
  }
};
