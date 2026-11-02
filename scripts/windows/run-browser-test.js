#!/usr/bin/env node
"use strict";
const fs = require("fs");
const { spawn, spawnSync } = require("child_process");

const [timeoutValue, logPath, script, ...args] = process.argv.slice(2);
const timeoutMs = Number(timeoutValue);
if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || !logPath || !script) {
  console.error(
    "Usage: run-browser-test.js <timeout-ms> <log-path> <script> [args...]",
  );
  process.exit(2);
}

const log = fs.createWriteStream(logPath, { flags: "w" });
const child = spawn(process.execPath, [script, ...args], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let timedOut = false;
let finished = false;
let hardStop;

function forward(stream, output) {
  stream.on("data", (chunk) => {
    output.write(chunk);
    log.write(chunk);
  });
}

function killTree() {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
      timeout: 15_000,
    });
  } else {
    child.kill("SIGKILL");
  }
}

function complete(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  clearTimeout(hardStop);
  log.end(() => process.exit(code));
}

forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);
child.once("error", (error) => {
  const message = `Unable to start browser test: ${error.message}\n`;
  process.stderr.write(message);
  log.write(message);
  complete(1);
});
child.once("close", (code, signal) => {
  if (timedOut) return complete(124);
  if (signal) {
    const message = `Browser test terminated by ${signal}.\n`;
    process.stderr.write(message);
    log.write(message);
  }
  complete(Number.isInteger(code) ? code : 1);
});

const timer = setTimeout(() => {
  timedOut = true;
  const message = `Browser test exceeded ${timeoutMs} ms; terminating its process tree.\n`;
  process.stderr.write(message);
  log.write(message);
  hardStop = setTimeout(() => complete(124), 20_000);
  killTree();
}, timeoutMs);
timer.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    killTree();
    complete(128);
  });
}
