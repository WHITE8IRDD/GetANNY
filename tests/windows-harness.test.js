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
