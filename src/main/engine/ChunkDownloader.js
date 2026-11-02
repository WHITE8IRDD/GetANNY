const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const { Transform } = require("node:stream");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { DownloadEngine } = require("./DownloadEngine");
const { request, validateRange, httpError } = require("./http");

// HTTP ranges are I/O-bound. Running each stream in its own worker thread used
// a separate V8 heap and a message round-trip for every throttled buffer without
// adding CPU parallelism. Shared asynchronous streams retain backpressure and
// cancellation while keeping memory and IPC bounded.
class ChunkDownloader extends DownloadEngine {
  constructor(options = {}) {
    super(options);
    this.connections = Math.min(16, Math.max(1, options.connections || 8));
    this.segmentStreams = new Set();
  }

  desiredSegments() {
    // Range support must be advertised explicitly, and dynamic ZIP streams
    // (for example Google Drive folders) are assembled by the server without
    // stable byte offsets. Both stay on one connection.
    if (
      !this.resumable ||
      !this.acceptRanges ||
      this.dynamicArchive ||
      this.totalSize < 2 * 1024 * 1024
    )
      return 1;
    // Avoid connection setup dominating small files. Large files can still use
    // every configured connection; the default target is roughly 4 MiB/range.
    return Math.min(
      this.connections,
      Math.max(2, Math.ceil(this.totalSize / (4 * 1024 * 1024))),
    );
  }

  async transfer() {
    if (!this.resumable || this.segmentCount <= 1) return super.transfer();
    const chunkSize = Math.ceil(this.totalSize / this.segmentCount);
    const parts = Array.from({ length: this.segmentCount }, (_, index) => ({
      start: index * chunkSize,
      end: Math.min(this.totalSize - 1, (index + 1) * chunkSize - 1),
      file: `${this.partialPath}-${index}`,
    }));
    this.downloadedSize = 0;
    for (const part of parts) {
      part.existing = await fsp.stat(part.file).then(
        (stat) => stat.size,
        () => 0,
      );
      if (part.existing > part.end - part.start + 1) {
        await fsp.rm(part.file, { force: true });
        part.existing = 0;
      }
      this.downloadedSize += part.existing;
    }

    const stopAll = () => {
      for (const response of this.segmentStreams) response.destroy();
    };
    this.controller.signal.addEventListener("abort", stopAll, { once: true });
    let failure;
    const pending = parts.filter(
      (part) => part.existing < part.end - part.start + 1,
    );
    let cursor = 0;
    const pool = Array.from(
      { length: Math.min(this.connections, pending.length) },
      async () => {
        while (
          cursor < pending.length &&
          !failure &&
          !this.controller.signal.aborted
        ) {
          const part = pending[cursor++];
          try {
            await this.runSegment(part);
          } catch (error) {
            if (!failure && !this.controller.signal.aborted) {
              failure = error;
              stopAll();
            }
          }
        }
      },
    );
    await Promise.allSettled(pool);
    this.controller.signal.removeEventListener("abort", stopAll);
    this.segmentStreams.clear();
    this.controller.signal.throwIfAborted();
    if (failure) throw failure;
    for (const part of parts) {
      if ((await fsp.stat(part.file)).size !== part.end - part.start + 1)
        throw new Error("A downloaded segment is incomplete.");
    }
    const inputs = async function* () {
      for (const part of parts) {
        for await (const buffer of fs.createReadStream(part.file)) yield buffer;
      }
    };
    // Processing is not completion: the final assembled file is verified and
    // atomically published by DownloadEngine only after this pipeline settles.
    this.speed = 0;
    this.tickBytes = 0;
    this.setStatus("processing", {
      ...this.progress(),
      phase: "Assembling verified segments",
    });
    await pipeline(
      Readable.from(inputs()),
      fs.createWriteStream(this.partialPath),
      { signal: this.controller.signal },
    );
  }

  async runSegment(part) {
    const start = part.start + part.existing;
    const headers = {
      ...this.headers,
      Range: `bytes=${start}-${part.end}`,
    };
    if (this.etag || this.lastModified)
      headers["If-Range"] = this.etag || this.lastModified;
    const { response } = await request(this.url, {
      headers,
      timeout: this.timeout,
      signal: this.controller.signal,
      requestOptions: this.requestOptions,
    });
    this.segmentStreams.add(response);
    try {
      if (response.statusCode >= 400) {
        response.destroy();
        throw httpError(response.statusCode);
      }
      validateRange(response, start, part.end, this.totalSize);
      if (
        response.headers["content-encoding"] &&
        response.headers["content-encoding"] !== "identity"
      ) {
        response.destroy();
        throw new Error("Encoded range responses are not safe to assemble.");
      }
      let received = 0;
      const meter = new Transform({
        transform: (chunk, _encoding, callback) => {
          this.limiter
            .consume(chunk.length, this.controller.signal)
            .then(() => {
              try {
                this.controller.signal.throwIfAborted();
                received += chunk.length;
                if (received > part.end - start + 1)
                  throw new Error("Segment exceeds its requested byte range.");
                if (!this.wantedState) {
                  this.downloadedSize += chunk.length;
                  this.tickBytes += chunk.length;
                }
                callback(null, chunk);
              } catch (error) {
                callback(error);
              }
            }, callback);
        },
      });
      await pipeline(
        response,
        meter,
        fs.createWriteStream(part.file, {
          flags: part.existing ? "a" : "w",
        }),
        { signal: this.controller.signal },
      );
      if (received !== part.end - start + 1)
        throw new Error("Segment ended before all requested bytes arrived.");
    } finally {
      this.segmentStreams.delete(response);
    }
  }

  async partialBytes() {
    if (this.segmentCount > 1 && this.partialPath) {
      const sizes = await Promise.all(
        Array.from({ length: this.segmentCount }, (_, index) =>
          super.partialBytes(`${this.partialPath}-${index}`),
        ),
      );
      return sizes.reduce((sum, size) => sum + size, 0);
    }
    return super.partialBytes();
  }
}

module.exports = { ChunkDownloader };
