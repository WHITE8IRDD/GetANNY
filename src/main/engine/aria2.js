"use strict";

const http = require("node:http");
const net = require("node:net");
const dgram = require("node:dgram");
const fsSync = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ARIA2_EXE = "aria2c.exe";
const MAX_TORRENT_BYTES = 16 * 1024 * 1024;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freeTcpPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function freeUdpPort() {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", reject);
    socket.bind(0, "0.0.0.0", () => {
      const { port } = socket.address();
      socket.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

class Aria2Rpc {
  constructor(port, secret) {
    this.port = port;
    this.secret = secret;
    this.sequence = 0;
    this.agent = new http.Agent({ keepAlive: true, maxSockets: 2 });
  }

  call(method, params = []) {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: `getanny-${++this.sequence}`,
      method,
      params: [`token:${this.secret}`, ...params],
    });

    return new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: "127.0.0.1",
          port: this.port,
          path: "/jsonrpc",
          method: "POST",
          agent: this.agent,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
          },
          timeout: 15000,
        },
        (response) => {
          const chunks = [];
          let length = 0;
          response.on("data", (chunk) => {
            length += chunk.length;
            if (length > 4 * 1024 * 1024) {
              response.destroy(new Error("aria2 returned an oversized RPC response."));
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              if (result.error) {
                const error = new Error(result.error.message || "aria2 RPC error");
                error.rpcCode = result.error.code;
                reject(error);
              } else if (response.statusCode < 200 || response.statusCode >= 300) {
                reject(new Error(`aria2 RPC returned HTTP ${response.statusCode}.`));
              } else {
                resolve(result.result);
              }
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("aria2 RPC timed out.")));
      request.on("error", reject);
      request.end(body);
    });
  }

  close() {
    this.agent.destroy();
  }
}

function resolveAria2Path(override) {
  const candidates = [
    override,
    process.env.GETANNY_ARIA2_PATH,
    process.resourcesPath && path.join(process.resourcesPath, "bin", ARIA2_EXE),
    path.join(__dirname, "..", "..", "..", "resources", "bin", ARIA2_EXE),
    path.join(process.cwd(), "bin", ARIA2_EXE),
  ].filter(Boolean);

  return candidates.find((candidate) => {
    try {
      return fsSync.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || null;
}

function aria2Args({ workPath, logPath, rpcPort, secret, btPort, dhtPort, speedLimit, maxPeers }) {
  return [
    "--enable-rpc=true",
    "--rpc-listen-all=false",
    `--rpc-listen-port=${rpcPort}`,
    `--rpc-secret=${secret}`,
    "--rpc-secure=false",
    "--rpc-max-request-size=32M",
    `--dir=${workPath}`,
    "--continue=true",
    "--always-resume=true",
    "--file-allocation=none",
    "--auto-file-renaming=false",
    "--allow-overwrite=true",
    "--remove-control-file=true",
    "--enable-dht=true",
    "--enable-dht6=false",
    `--dht-listen-port=${dhtPort}`,
    "--enable-peer-exchange=true",
    "--bt-enable-lpd=true",
    "--bt-max-open-files=512",
    `--listen-port=${btPort}`,
    `--bt-max-peers=${maxPeers}`,
    "--bt-request-peer-speed-limit=1M",
    "--bt-save-metadata=true",
    "--bt-load-saved-metadata=true",
    "--bt-hash-check-seed=false",
    "--bt-tracker-connect-timeout=30",
    "--bt-tracker-timeout=60",
    "--seed-time=0",
    "--seed-ratio=0.0",
    "--summary-interval=0",
    "--show-console-readout=false",
    "--console-log-level=warn",
    `--log=${logPath}`,
    "--log-level=warn",
    "--max-overall-upload-limit=512K",
    ...(speedLimit > 0
      ? [`--max-overall-download-limit=${Math.floor(speedLimit)}`]
      : []),
  ];
}

function spawnAria2(aria2Path, args) {
  return spawn(aria2Path, args, {
    windowsHide: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
}

async function readRemoteTorrent(url, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "application/x-bittorrent, application/octet-stream;q=0.9, */*;q=0.1" },
    });
    if (!response.ok) throw new Error(`Torrent file request returned HTTP ${response.status}.`);

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_TORRENT_BYTES) {
      throw new Error("The torrent file is larger than the 16 MB limit.");
    }

    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > MAX_TORRENT_BYTES) {
        controller.abort();
        throw new Error("The torrent file is larger than the 16 MB limit.");
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, length);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The torrent file request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  ARIA2_EXE,
  MAX_TORRENT_BYTES,
  Aria2Rpc,
  aria2Args,
  delay,
  freeTcpPort,
  freeUdpPort,
  readRemoteTorrent,
  resolveAria2Path,
  spawnAria2,
};
