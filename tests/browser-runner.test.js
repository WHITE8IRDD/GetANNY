"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { temporary } = require("./helpers");

const runner = path.resolve("scripts/windows/run-browser-test.js");

function run(args) {
  return spawnSync(process.execPath, [runner, ...args], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("browser-matrix runner preserves output and the child exit code", async (t) => {
  const dir = await temporary(t, "getanny-browser-runner-");
  const script = path.join(dir, "failure.js");
  const log = path.join(dir, "failure.log");
  await fs.writeFile(
    script,
    'process.stdout.write("visible stdout\\n"); process.stderr.write("visible stderr\\n"); process.exitCode = 7;\n',
  );
  const result = run(["5000", log, script]);
  assert.equal(result.status, 7, result.stderr);
  assert.match(result.stdout, /visible stdout/);
  assert.match(result.stderr, /visible stderr/);
  const persisted = await fs.readFile(log, "utf8");
  assert.match(persisted, /visible stdout/);
  assert.match(persisted, /visible stderr/);
});

test("browser-matrix runner bounds a hung child instead of exhausting the Windows job", async (t) => {
  const dir = await temporary(t, "getanny-browser-runner-");
  const script = path.join(dir, "hang.js");
  const log = path.join(dir, "hang.log");
  await fs.writeFile(
    script,
    'process.stdout.write("child started\\n"); setInterval(() => {}, 1000);\n',
  );
  const started = Date.now();
  const result = run(["1000", log, script]);
  assert.equal(result.status, 124, result.stderr);
  assert.ok(Date.now() - started < 8_000);
  assert.match(result.stderr, /exceeded 1000 ms/);
  const persisted = await fs.readFile(log, "utf8");
  assert.match(persisted, /child started/);
  assert.match(persisted, /terminating its process tree/);
});
