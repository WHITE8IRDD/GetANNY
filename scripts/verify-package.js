const fs = require("node:fs/promises");
const path = require("node:path");
module.exports = async (context) => {
  const root = context.packager.projectDir;
  const platform = context.electronPlatformName;
  const required = [
    "src/main/browser-integration/native-host.js",
    "src/main/browser-integration/DesktopExitMarker.js",
    "src/shared/themes.json",
    "node_modules/ws/index.js",
    "node_modules/ws/package.json",
    "dist-renderer/index.html",
    "dist-renderer/fonts/OFL-Cairo.txt",
    "dist-extension/chromium/manifest.json",
    "dist-extension/firefox/manifest.json",
  ];
  if (platform === "win32")
    required.push(
      "bin/yt-dlp.exe",
      "bin/ffmpeg.exe",
      "bin/ffprobe.exe",
      "bin/GetANNY.NativeHost.exe",
      "bin/FFmpeg-LICENSE.txt",
      "bin/FFmpeg-SOURCE.txt",
      "node_modules/utp-native/prebuilds/win32-x64/node.napi.node",
    );
  else if (platform === "linux")
    required.push("bin/yt-dlp", "bin/ffmpeg", "bin/ffprobe");
  else required.push("bin/yt-dlp_macos", "bin/ffmpeg", "bin/ffprobe");
  for (const file of required)
    await fs.access(path.join(root, file)).catch(() => {
      throw new Error(
        `Required packaged resource missing: ${file}. Run npm run prepare:tools and build the renderer/extensions first.`,
      );
    });
  const rendererFiles = await fs.readdir(
    path.join(root, "dist-renderer", "assets"),
  );
  if (!rendererFiles.some((file) => /^Cairo-Variable-.*\.ttf$/i.test(file)))
    throw new Error("Required packaged resource missing: bundled Cairo font");
  if (platform === "win32") {
    const { createHash } = require("node:crypto");
    const tools = require("./tools-manifest.json");
    for (const item of [
      tools.ytDlp.assets["win32-x64"],
      ...tools.ffmpeg.assets["win32-x64"],
    ]) {
      const filename = item.output || item.name;
      const hash = createHash("sha256")
        .update(await fs.readFile(path.join(root, "bin", filename)))
        .digest("hex");
      if (hash !== item.sha256)
        throw new Error(
          `Refusing Windows packaging: checksum mismatch for ${filename}.`,
        );
    }
  }
};
