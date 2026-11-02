const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const ejs = require("ejs");
const { temporary } = require("./helpers");
const verify = require("../scripts/verify-package");
const customizeMsi = require("../scripts/windows/customize-msi");

test("Windows packaging fails closed when required runtime resources are absent", async (t) => {
  const root = await temporary(t);
  await assert.rejects(
    verify({ packager: { projectDir: root }, electronPlatformName: "win32" }),
    /Required packaged resource missing/,
  );
  const config = await fs.readFile("electron-builder.yml", "utf8");
  assert.match(config, /^  - src\/shared\/\*\*\/\*$/m);
});
test("Windows packages exclude local native build output and its machine paths", async () => {
  const config = await fs.readFile("electron-builder.yml", "utf8");
  for (const pattern of [
    "!node_modules/better-sqlite3/build/**/*",
    "!node_modules/bufferutil/**/*",
    "!node_modules/utf-8-validate/**/*",
  ])
    assert.ok(
      config.includes(pattern),
      `Missing package exclusion: ${pattern}`,
    );
});
test("Windows packaging rejects existing but checksum-invalid tools", async (t) => {
  const root = await temporary(t);
  for (const file of [
    "src/main/browser-integration/native-host.js",
    "src/main/browser-integration/DesktopExitMarker.js",
    "src/shared/themes.json",
    "node_modules/ws/index.js",
    "node_modules/ws/package.json",
    "dist-renderer/index.html",
    "dist-renderer/fonts/OFL-Cairo.txt",
    "dist-extension/chromium/manifest.json",
    "dist-extension/firefox/manifest.json",
    "bin/yt-dlp.exe",
    "bin/ffmpeg.exe",
    "bin/ffprobe.exe",
    "bin/GetANNY.NativeHost.exe",
    "bin/FFmpeg-LICENSE.txt",
    "bin/FFmpeg-SOURCE.txt",
  ]) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(
      path.join(root, file),
      "deliberately invalid unit-test input",
    );
  }
  await fs.mkdir(path.join(root, "dist-renderer", "assets"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "dist-renderer", "assets", "Cairo-Variable-test.ttf"),
    "fixture",
  );
  await assert.rejects(
    verify({ packager: { projectDir: root }, electronPlatformName: "win32" }),
    /checksum mismatch/,
  );
});
test("real electron-builder MSI template gets safe shortcut components, OS check and real native hooks", async (t) => {
  const root = await temporary(t),
    filename = path.join(root, "project.wxs");
  const template = (
    await fs.readFile(
      require.resolve("app-builder-lib/templates/msi/template.xml"),
      "utf8",
    )
  )
    .replace(/{{/g, "<%")
    .replace(/}}/g, "%>")
    .replace(/\${([^}]+)}/g, "<%=$1%>");
  const xml = ejs.render(template, {
    productName: "GetANNY",
    upgradeCode: "A76CA441-1688-4E23-AE86-D70D12758488",
    version: "2.0.0.1",
    manufacturer: "GetANNY",
    compressionLevel: "high",
    iconPath: "icon.ico",
    iconId: "GetANNYIcon.exe",
    installationDirectoryWixName: "GetANNY",
    isRunAfterFinish: false,
    isAssisted: true,
    isPerMachine: false,
    isCreateDesktopShortcut: true,
    isCreateStartMenuShortcut: true,
    programFilesId: "ProgramFiles64Folder",
    menuCategory: null,
    files:
      '<Component><File Id="mainExecutable" Source="GetANNY.exe"><Shortcut Id="desktopShortcut" Directory="DesktopFolder" Name="GetANNY" Advertise="yes" Icon="GetANNYIcon.exe"/></File></Component>',
    dirs: "",
  });
  await fs.writeFile(filename, xml);
  await customizeMsi(filename);
  const result = await fs.readFile(filename, "utf8");
  assert.match(result, /http:\/\/wixtoolset.org\/schemas\/v4\/wxs/);
  assert.match(
    result,
    /GETANNY_WINDOWS_BUILD &gt;= 10240|GETANNY_WINDOWS_BUILD >= 10240/,
  );
  assert.match(
    result,
    /<Component Id="OptionalDesktopShortcut"[^>]*>[\s\S]*?<Condition>GETANNY_DESKTOP_SHORTCUT=1<\/Condition>/,
  );
  assert.match(
    result,
    /<File Id="mainExecutable" Source="GetANNY.exe"><\/File>/,
  );
  assert.match(result, /--setup-browser-hosts --quiet/);
  assert.match(
    result,
    /Id="GetANNYPrepareBrowsers"[^>]*Return="ignore"/,
    "repairable browser provisioning must not roll back the MSI product",
  );
  assert.doesNotMatch(result, /Id="GetANNYPrepareBrowsers"[^>]*Return="check"/);
  assert.match(result, /--unregister-browser-hosts --quiet/);
  assert.match(
    result,
    /Dialog="InstallScopeDlg" Control="Next" Event="NewDialog" Value="InstallDirDlg"/,
  );
  assert.equal(
    (result.match(/<Shortcut Id="desktopShortcut"/g) || []).length,
    1,
  );
});
test("checked-in Chromium public key derives the allowlisted extension ID", async () => {
  const manifest = JSON.parse(
    await fs.readFile("src/extension/manifest.json", "utf8"),
  );
  const id = createHash("sha256")
    .update(Buffer.from(manifest.key, "base64"))
    .digest("hex")
    .slice(0, 32)
    .split("")
    .map((char) => String.fromCharCode(97 + parseInt(char, 16)))
    .join("");
  assert.equal(
    id,
    require("../src/main/browser-integration/catalog").CHROMIUM_ID,
  );
  assert.ok(manifest.permissions.includes("nativeMessaging"));
});

test("afterPack verifies the real SQLite N-API layout and torrent binary; missing payloads fail closed", async (t) => {
  const afterPack = require("../scripts/verify-installed-resources");
  const root = await temporary(t),
    resources = path.join(root, "resources");
  const files = [
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
  ];
  await fs.mkdir(resources, { recursive: true });
  const asarRoot = path.join(root, "asar-input");
  await fs.mkdir(path.join(asarRoot, "dist-renderer", "assets"), {
    recursive: true,
  });
  await fs.mkdir(path.join(asarRoot, "dist-renderer"), { recursive: true });
  await fs.mkdir(path.join(asarRoot, "dist-renderer", "fonts"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(asarRoot, "dist-renderer", "index.html"),
    '<link rel="stylesheet" href="assets/index-test.css">',
  );
  await fs.writeFile(
    path.join(asarRoot, "dist-renderer", "assets", "index-test.css"),
    'src:url("./Cairo-Variable-test.ttf")',
  );
  await fs.writeFile(
    path.join(asarRoot, "dist-renderer", "assets", "Cairo-Variable-test.ttf"),
    "font fixture",
  );
  await fs.writeFile(
    path.join(asarRoot, "dist-renderer", "fonts", "OFL-Cairo.txt"),
    "license fixture",
  );
  await require("@electron/asar").createPackage(
    asarRoot,
    path.join(resources, "app.asar"),
  );
  // Structural fixtures only. Real executable loading is a separate installed
  // Windows gate; a two-byte MZ fixture does not establish PE validity.
  for (const file of files) {
    const target = path.join(resources, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      file.endsWith(".exe") ? "MZunit-fixture" : "structural unit fixture",
    );
  }
  const context = { electronPlatformName: "win32", appOutDir: root };
  await afterPack(context);
  for (const file of files.slice(-3)) {
    const target = path.join(resources, file),
      body = await fs.readFile(target);
    await fs.rm(target);
    await assert.rejects(afterPack(context), /Packaged resource missing/);
    await fs.writeFile(target, body);
  }
  await fs.writeFile(
    path.join(resources, "bin/GetANNY.NativeHost.exe"),
    "invalid header",
  );
  await assert.rejects(afterPack(context), /Not a real Windows executable/);
});

test("release checksums stream file contents and exclude their own output", async (t) => {
  const { writeChecksums } = require("../scripts/checksums");
  const dir = await temporary(t);
  const content = Buffer.alloc(1024 * 1024, 42);
  await fs.writeFile(path.join(dir, "GetANNY Setup.exe"), content);
  await fs.writeFile(path.join(dir, "SHA256SUMS.txt"), "old data");
  await fs.mkdir(path.join(dir, "folder"));
  const expected = createHash("sha256").update(content).digest("hex");
  const lines = await writeChecksums(dir);
  assert.deepEqual(lines, [`${expected}  GetANNY Setup.exe`]);
  assert.equal(
    await fs.readFile(path.join(dir, "SHA256SUMS.txt"), "utf8"),
    lines[0] + "\n",
  );
});

test("portable packaging and the distribution bundle are gated by a packaged portable self-test", async () => {
  const version = require("../package.json").version;
  assert.equal(require("../package-lock.json").version, version);
  for (const file of [
    "src/extension/manifest.json",
    "src/extension/manifest-firefox.json",
  ]) {
    const manifest = JSON.parse(await fs.readFile(file, "utf8"));
    assert.equal(manifest.version, version.replace(/-rc\.(\d+)$/, ".$1"));
  }
  const config = await fs.readFile("electron-builder.yml", "utf8");
  assert.match(config, /target: portable/);
  const installTest = await fs.readFile(
    "scripts/windows/test-installers.ps1",
    "utf8",
  );
  assert.match(installTest, /Self-Test .*portable-first-launch/);
  const assembly = await fs.readFile(
    "scripts/windows/assemble-release.ps1",
    "utf8",
  );
  assert.match(assembly, /portable-first-launch/);
  assert.match(assembly, /GetANNY-v\$version-Windows/);
});

test("Windows packages carry the GitHub updater feed metadata used by the NSIS channel", async () => {
  const config = await fs.readFile("electron-builder.yml", "utf8");
  assert.match(config, /owner: p4yy\s+repo: GetANNY\s+releaseType: release/);
  assert.doesNotMatch(config, /^publish: null\s*$/m);
  assert.match(config, /getanny-github-updates/);
});
