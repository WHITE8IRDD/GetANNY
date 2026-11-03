const fs = require("node:fs/promises");
const { isIP } = require("node:net");
const path = require("node:path");

const SOURCE =
  "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt";
const REFRESH_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TRACKERS = [
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://open.tracker.cl:1337/announce",
  "udp://tracker.qu.ax:6969/announce",
  "udp://tracker.theoks.net:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker-udp.gbitt.info:80/announce",
];

function validTracker(value) {
  try {
    const url = new URL(value);
    if (
      /[\r\n\0]/.test(value) ||
      !["udp:", "http:", "https:"].includes(url.protocol)
    )
      return false;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ipVersion = isIP(host);
    const ipv4 = host.split(".").map(Number);
    const privateIPv4 =
      ipVersion === 4 &&
      (ipv4[0] === 0 ||
        ipv4[0] === 10 ||
        ipv4[0] === 127 ||
        (ipv4[0] === 100 && ipv4[1] >= 64 && ipv4[1] <= 127) ||
        (ipv4[0] === 169 && ipv4[1] === 254) ||
        (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) ||
        (ipv4[0] === 192 && ipv4[1] === 168) ||
        ipv4[0] >= 224);
    const privateIPv6 =
      ipVersion === 6 &&
      (host === "::" ||
        host === "::1" ||
        /^f[cd]/i.test(host) ||
        /^fe[89ab]/i.test(host) ||
        /^ff/i.test(host) ||
        /^::ffff:/i.test(host));
    if (
      !host ||
      url.username ||
      url.password ||
      privateIPv4 ||
      privateIPv6 ||
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "::1"
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

function parseTrackerList(text) {
  if (typeof text !== "string" || text.length > 100_000)
    throw new Error("Tracker list is too large or invalid.");
  const list = [
    ...new Set(
      text
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(validTracker),
    ),
  ].slice(0, 24);
  if (!list.length)
    throw new Error("Tracker list contained no supported addresses.");
  return list;
}

class TrackerListService {
  constructor({
    cachePath,
    fetchImpl = globalThis.fetch,
    now = Date.now,
  } = {}) {
    this.cachePath = cachePath;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.trackers = [...DEFAULT_TRACKERS];
    this.updatedAt = 0;
    this.refreshPromise = null;
    this.timer = null;
  }

  getTrackers() {
    return [...this.trackers];
  }

  async loadCache() {
    if (!this.cachePath) return false;
    try {
      const saved = JSON.parse(await fs.readFile(this.cachePath, "utf8"));
      const trackers = parseTrackerList(saved.trackers?.join("\n"));
      if (!Number.isFinite(saved.updatedAt) || saved.updatedAt > this.now())
        return false;
      this.trackers = trackers;
      this.updatedAt = saved.updatedAt;
      return true;
    } catch {
      return false;
    }
  }

  refreshIfStale() {
    if (this.now() - this.updatedAt < REFRESH_MS) return Promise.resolve(false);
    return this.refresh();
  }

  refresh() {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchLatest().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async fetchLatest() {
    if (typeof this.fetchImpl !== "function")
      throw new Error("Network fetch is unavailable.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(SOURCE, {
        signal: controller.signal,
        headers: { accept: "text/plain" },
      });
      if (!response.ok)
        throw new Error(`Tracker list returned HTTP ${response.status}.`);
      const trackers = parseTrackerList(await response.text());
      const updatedAt = this.now();
      if (this.cachePath) {
        await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
        const temporary = `${this.cachePath}.tmp`;
        await fs.writeFile(
          temporary,
          JSON.stringify({ updatedAt, trackers }, null, 2),
          { mode: 0o600 },
        );
        await fs.rename(temporary, this.cachePath);
      }
      this.trackers = trackers;
      this.updatedAt = updatedAt;
      return true;
    } finally {
      clearTimeout(timer);
    }
  }

  start() {
    if (this.timer) return;
    this.refreshIfStale()
      .then(() => this.scheduleRefresh(REFRESH_MS))
      .catch(() => this.scheduleRefresh(60 * 60 * 1000));
  }

  scheduleRefresh(delay) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.start();
    }, delay);
    this.timer.unref?.();
  }

  close() {
    clearTimeout(this.timer);
    this.timer = null;
  }
}

module.exports = {
  TrackerListService,
  DEFAULT_TRACKERS,
  parseTrackerList,
  validTracker,
  SOURCE,
  REFRESH_MS,
};
