"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");

test("Windows harness waits for the asynchronous NSIS child and still measures MSI after EXE cleanup failure", async () => {
  const script = await fs.readFile(
    "scripts/windows/test-installers.ps1",
    "utf8",
  );
  assert.match(script, /function Wait-ProductRemoved/);
  assert.match(
    script,
    /Wait-ProductRemoved \$installedExe \$uninstaller\.FullName/,
  );
  assert.doesNotMatch(script, /Start-Sleep -Seconds 2/);
  const wait = script.indexOf("Wait-ProductRemoved $installedExe");
  const catchFailure = script.indexOf("EXE cleanup gate failed");
  const msi = script.indexOf("Installing the actual MSI package");
  const finalFailure = script.indexOf(
    'if($exeCleanupError){throw "EXE cleanup gate failed',
  );
  assert.ok(wait > -1 && wait < catchFailure);
  assert.ok(catchFailure < msi);
  assert.ok(msi < finalFailure);
});

test("real-browser harnesses use current privileged Firefox startup and bounded Vivaldi/UI cleanup", async () => {
  const firefox = await fs.readFile("scripts/windows/test-firefox.js", "utf8");
  assert.match(
    firefox,
    /new firefox\.ServiceBuilder\(geckoExe\)\.addArguments\([\s\S]*"--allow-system-access"/,
  );
  assert.doesNotMatch(firefox, /remote-allow-system-access/);
  assert.match(firefox, /session\.credential === "provisioned"/);
  assert.match(firefox, /Connected · Secure local bridge/);

  const chromium = await fs.readFile(
    "scripts/windows/test-extension.js",
    "utf8",
  );
  assert.match(chromium, /new Set\(\[externalPid, externalProcess\?\.pid\]\)/);
  assert.match(
    chromium,
    /externalBrowser\.close\(\)[\s\S]*setTimeout\(resolve, 3000\)/,
  );

  const picker = await fs.readFile(
    "scripts/windows/select-extension-folder.ps1",
    "utf8",
  );
  assert.match(picker, /try\{\$dialog\.SetFocus\(\)\}catch\{\}/);
  assert.match(picker, /Folder-dialog address field is not focused/);
});
