const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { request, httpError, parseRange, validateRange } = require("./http");
const { RateLimiter } = require("./RateLimiter");
const {
  sanitizeFilename,
  getFilenameFromURL,
  getFilenameFromHeaders,
  withMimeExtension,
  isHtmlContentType,
  isHtmlFilename,
  isAuthenticationPage,
  isDynamicArchive,
  authenticationRequiredError,
  validateHeaders,
  validateUrl,
} = require("./utils");

async function readResponseHead(response, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= limit) break;
    }
  } catch {
    // The classification only needs the prefix; a truncated or reset body is
    // still enough to distinguish an HTML challenge from binary content.
  }
  return Buffer.concat(chunks).subarray(0, limit).toString("utf8");
}

class DownloadEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.id = options.id || randomUUID();
    this.url = validateUrl(options.url);
    this.savePath = options.savePath;
    // Partial data and resume state live in a private work folder outside the
    // destination so users never see chunks appear next to their files.
    this.tempPath = options.tempPath || null;
    this.filename = options.filename || null;
    this.filenameExplicit = options.filenameExplicit ?? !!options.filename;
    this.headers = validateHeaders(options.headers);
    this.timeout = options.timeout || 30000;
    this.requestOptions = options.requestOptions || {};
    this.reserveTarget = options.reserveTarget;
    this.connections = options.connections || 1;
    this.limiter = new RateLimiter(options.speedLimit);
    this.status = "queued";
    this.downloadedSize = 0;
    this.totalSize = 0;
    this.speed = 0;
    this.controller = new AbortController();
    this.wantedState = null;
  }

  async probe() {
    // One real range response provides redirect, filename, validators, size
    // and resume capability. A separate HEAD doubled connection initialization.
    const rangeProbe = await request(this.url, {
      headers: { ...this.headers, Range: "bytes=0-0" },
      timeout: this.timeout,
      signal: this.controller.signal,
      requestOptions: this.requestOptions,
    });
    const response = rangeProbe.response;
    const finalUrl = rangeProbe.url;
    this.headers = rangeProbe.headers;
    delete this.headers.Range;
    const headers = response.headers;
    const status = response.statusCode;
    const contentType = headers["content-type"];
    const htmlResponse = isHtmlContentType(contentType);
    const htmlHead = htmlResponse ? await readResponseHead(response) : "";
    response.destroy();
    if (![200, 204, 206, 416].includes(status)) {
      // Cloud storage commonly returns a sign-in or quota page with 401/403
      // instead of a machine-readable error. Surface the actionable message.
      if (htmlResponse && [401, 403].includes(status))
        throw authenticationRequiredError();
      throw httpError(
        status,
        "Unable to access this file. A page URL may need the media extractor instead.",
      );
    }
    const range = parseRange(headers["content-range"]);
    if (status === 206 && (!range || range.start !== 0 || range.end !== 0))
      throw new Error(
        "The server returned an invalid range capability response.",
      );
    if (status === 416 && !/^bytes \*\/0$/.test(headers["content-range"] || ""))
      throw httpError(status, "The file range could not be determined.");
    const totalSize =
      range?.total ??
      (status === 416 ? 0 : Number(headers["content-length"]) || 0);
    if (!Number.isSafeInteger(totalSize) || totalSize < 0)
      throw new Error("The server reported an unsupported file size.");
    let filename =
      this.filenameExplicit && this.filename
        ? this.filename
        : getFilenameFromHeaders(headers["content-disposition"]) ||
          getFilenameFromURL(finalUrl) ||
          "download";
    // A binary download that resolves to an HTML document is an authentication
    // or virus-warning page, not the requested file. Never save it as .zip,
    // .bin or an extensionless "identifier". Check before the Content-Type
    // fallback so text/html cannot legitimize the challenge page itself.
    if (
      status === 200 &&
      htmlResponse &&
      !isHtmlFilename(filename) &&
      (isAuthenticationPage(htmlHead) ||
        /<(?:!doctype\s+html|html|head|body|form)\b/i.test(htmlHead))
    )
      throw authenticationRequiredError();
    filename = withMimeExtension(filename, contentType);
    const acceptRanges = /(?:^|,)\s*bytes\s*(?:,|$)/i.test(
      headers["accept-ranges"] || "",
    );
    const dynamicArchive = isDynamicArchive(finalUrl, headers);
    const etag =
      headers.etag && !headers.etag.startsWith("W/") ? headers.etag : null;
    const info = {
      url: finalUrl,
      totalSize,
      // A 206 proves ranges work, but the advertised capability and dynamic
      // archive checks keep Google Drive folder ZIPs on one connection.
      resumable:
        status === 206 && totalSize > 0 && acceptRanges && !dynamicArchive,
      acceptRanges,
      dynamicArchive,
      filename: sanitizeFilename(filename),
      mimeType: headers["content-type"]?.split(";")[0] || null,
      etag,
      lastModified: headers["last-modified"] || null,
    };
    Object.assign(this, info);
    return info;
  }

  start() {
    if (!this.task) this.task = this.run();
    return this.task;
  }
  desiredSegments() {
    return 1;
  }
  workPath() {
    return this.tempPath || this.savePath;
  }
  async prepare(info) {
    await fsp.mkdir(this.savePath, { recursive: true });
    await fsp.mkdir(this.workPath(), { recursive: true });
    if (this.reserveTarget) Object.assign(this, await this.reserveTarget(info));
    this.partialPath = path.join(this.workPath(), `.getanny-${this.id}.part`);
    this.stateFile = path.join(this.workPath(), `.getanny-${this.id}.json`);
    let state;
    try {
      state = JSON.parse(await fsp.readFile(this.stateFile, "utf8"));
    } catch {
      /* first attempt */
    }
    const valid =
      (info.etag || info.lastModified) &&
      info.resumable &&
      state?.url === info.url &&
      state.totalSize === info.totalSize &&
      state.etag === info.etag &&
      state.lastModified === info.lastModified &&
      Number.isInteger(state.segments) &&
      state.segments >= 1 &&
      state.segments <= 16;
    if (!valid) await this.cleanupPartials();
    this.segmentCount = valid ? state.segments : this.desiredSegments();
    await fsp.writeFile(
      `${this.stateFile}.tmp`,
      JSON.stringify({
        version: 1,
        url: info.url,
        totalSize: info.totalSize,
        etag: info.etag,
        lastModified: info.lastModified,
        segments: this.segmentCount,
      }),
    );
    await fsp.rename(`${this.stateFile}.tmp`, this.stateFile);
  }
  async run() {
    let ticker;
    try {
      this.setStatus("connecting");
      const info = await this.probe();
      this.controller.signal.throwIfAborted();
      await this.prepare(info);
      this.controller.signal.throwIfAborted();
      this.setStatus("downloading", {
        filename: this.filename,
        savePath: this.savePath,
        totalSize: this.totalSize,
        resumable: this.resumable,
        mimeType: this.mimeType,
        connections: this.segmentCount,
      });
      this.tickBytes = 0;
      this.lastTick = performance.now();
      ticker = setInterval(() => {
        const now = performance.now();
        this.speed = (this.tickBytes * 1000) / Math.max(1, now - this.lastTick);
        this.tickBytes = 0;
        this.lastTick = now;
        this.emit("progress", this.id, this.progress());
      }, 400);
      await this.transfer();
      this.controller.signal.throwIfAborted();
      const size = (await fsp.stat(this.partialPath)).size;
      if (this.totalSize && size !== this.totalSize)
        throw new Error(
          `Incomplete file: received ${size} of ${this.totalSize} bytes.`,
        );
      const target = path.join(this.savePath, this.filename);
      await this.publish(target);
      await this.cleanupPartials({ removeWorkDir: true });
      this.downloadedSize = size;
      this.totalSize = size;
      this.speed = 0;
      this.setStatus("completed", { filePath: target });
      this.emit("progress", this.id, this.progress());
      this.emit("complete", this.id, {
        filePath: target,
        filename: this.filename,
        totalSize: size,
        downloadedSize: size,
      });
    } catch (error) {
      if (this.wantedState) {
        if (this.wantedState === "cancelled")
          await this.cleanupPartials({ removeWorkDir: true }).catch(() => {});
        if (this.wantedState === "paused") {
          // Abort/pause has settled every writer and worker. The 400 ms UI
          // sample and in-flight meter can both differ from durable partials.
          try {
            this.downloadedSize = await this.partialBytes();
          } catch (error) {
            this.speed = 0;
            this.setStatus("failed", { error: error.message });
            this.emit("error", this.id, error);
            return;
          }
        }
        this.speed = 0;
        this.tickBytes = 0;
        this.setStatus(this.wantedState, this.progress());
      } else {
        if (
          ["ECONNRESET", "ETIMEDOUT", "ERR_STREAM_PREMATURE_CLOSE"].includes(
            error.code,
          )
        )
          error.retryable = true;
        this.speed = 0;
        this.setStatus("failed", { error: error.message });
        this.emit("error", this.id, error);
      }
    } finally {
      clearInterval(ticker);
    }
  }
  async transfer() {
    let existing = await fsp.stat(this.partialPath).then(
      (s) => s.size,
      () => 0,
    );
    if (!this.resumable || existing > this.totalSize) {
      await fsp.rm(this.partialPath, { force: true });
      existing = 0;
    }
    this.downloadedSize = existing;
    if (this.totalSize && existing === this.totalSize) return;
    const headers = { ...this.headers };
    if (existing) {
      headers.Range = `bytes=${existing}-`;
      if (this.etag || this.lastModified)
        headers["If-Range"] = this.etag || this.lastModified;
    }
    const { response } = await request(this.url, {
      headers,
      timeout: this.timeout,
      signal: this.controller.signal,
      requestOptions: this.requestOptions,
    });
    if (existing && response.statusCode === 200) {
      // The entity changed or the server ignored Range. Restart safely, never append a full response.
      existing = 0;
      this.downloadedSize = 0;
      this.totalSize = Number(response.headers["content-length"]) || 0;
    } else if (existing || response.statusCode === 206) {
      validateRange(response, existing, this.totalSize - 1, this.totalSize);
    } else if (![200, 204].includes(response.statusCode)) {
      response.destroy();
      throw httpError(
        response.statusCode,
        "The download request was rejected.",
      );
    }
    if (
      response.headers["content-encoding"] &&
      response.headers["content-encoding"] !== "identity"
    ) {
      response.destroy();
      throw new Error(
        "The server returned compressed transfer bytes despite requesting identity encoding.",
      );
    }
    if (!this.totalSize)
      this.totalSize = Number(response.headers["content-length"]) || 0;
    const meter = new Transform({
      transform: (chunk, _encoding, callback) => {
        this.limiter.consume(chunk.length, this.controller.signal).then(() => {
          this.downloadedSize += chunk.length;
          this.tickBytes += chunk.length;
          if (this.totalSize && this.downloadedSize > this.totalSize)
            return callback(
              new Error(
                "The server sent more bytes than the declared file size.",
              ),
            );
          callback(null, chunk);
        }, callback);
      },
    });
    await pipeline(
      response,
      meter,
      fs.createWriteStream(this.partialPath, { flags: existing ? "a" : "w" }),
      { signal: this.controller.signal },
    );
  }
  progress() {
    return {
      filename: this.filename,
      savePath: this.savePath,
      downloadedSize: this.downloadedSize,
      totalSize: this.totalSize,
      speed: this.speed,
      eta:
        this.speed > 0 && this.totalSize >= this.downloadedSize
          ? (this.totalSize - this.downloadedSize) / this.speed
          : null,
      resumable: this.resumable,
      connections: this.segmentCount || 1,
    };
  }
  setStatus(status, data = {}) {
    this.status = status;
    this.emit("status", this.id, status, { speed: 0, ...data });
  }
  async pause() {
    return this.stop("paused");
  }
  async cancel() {
    return this.stop("cancelled");
  }
  async stop(status) {
    if (["completed", "failed", "cancelled"].includes(this.status))
      return false;
    this.wantedState = status;
    this.controller.abort(
      new Error(
        status === "paused" ? "Download paused." : "Download cancelled.",
      ),
    );
    await this.task;
    return true;
  }
  async partialBytes(file = this.partialPath) {
    if (!file) return 0;
    try {
      return (await fsp.stat(file)).size;
    } catch (error) {
      if (error.code === "ENOENT") return 0;
      throw error;
    }
  }
  async publish(target) {
    await fsp.mkdir(this.savePath, { recursive: true });
    try {
      // Same-directory hard link is atomic and never overwrites a user's file.
      await fsp.link(this.partialPath, target);
      return;
    } catch (error) {
      // Work data can sit on another volume, where hard links are impossible.
      if (!["EXDEV", "EPERM", "ENOTSUP", "EACCES"].includes(error.code))
        throw error;
    }
    // Stage inside the destination, then rename so a partial copy is never
    // presented as the finished file.
    const staged = path.join(this.savePath, `.getanny-${this.id}.publishing`);
    try {
      await fsp.copyFile(this.partialPath, staged);
      await fsp.rename(staged, target);
    } catch (error) {
      await fsp.rm(staged, { force: true }).catch(() => {});
      throw error;
    }
  }
  async cleanupPartials({ removeWorkDir = false } = {}) {
    const work = this.workPath();
    if (!work) return;
    const files = await fsp.readdir(work).catch(() => []);
    await Promise.all(
      files
        .filter(
          (name) =>
            name === `.getanny-${this.id}.part` ||
            name === `.getanny-${this.id}.json` ||
            name === `.getanny-${this.id}.json.tmp` ||
            name.startsWith(`.getanny-${this.id}.part-`),
        )
        .map((name) => fsp.rm(path.join(work, name), { force: true })),
    );
    // Preparation calls this to discard stale state; removing the work folder
    // there would delete the directory that is about to receive new state.
    if (removeWorkDir && this.tempPath)
      await fsp.rmdir(this.tempPath).catch(() => {});
  }
}
module.exports = { DownloadEngine };
