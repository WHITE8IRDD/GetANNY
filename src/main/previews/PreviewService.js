const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");

const MAX_RESPONSE_BYTES = 300 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_FILES = 500;

class PreviewService {
  constructor({
    userDataPath,
    binPath,
    nativeImage = null,
    getFileIcon = null,
  } = {}) {
    this.folder = path.join(userDataPath, "preview-cache");
    this.binPath = binPath;
    this.nativeImage = nativeImage;
    this.getFileIcon = getFileIcon;
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.children = new Set();
    this.generated = 0;
    this.closed = false;
  }

  async get(item) {
    if (this.closed || item.status !== "completed" || !item.filePath)
      return { url: null };
    const stat = await fs.stat(item.filePath).catch(() => null);
    if (!stat?.isFile()) return { url: null };
    const key = createHash("sha256")
      .update(`${item.filePath}\0${stat.size}\0${stat.mtimeMs}\0v1`)
      .digest("hex");
    const file = path.join(this.folder, `${key}.jpg`);
    if (this.pending.has(key)) return this.pending.get(key);
    const operation = this.enqueue(async () => {
      const cached = await this.read(file);
      if (cached) return { url: cached };
      await fs.mkdir(this.folder, { recursive: true });
      const temporary = path.join(this.folder, `${key}.${process.pid}.tmp.jpg`);
      try {
        const native =
          item.category === "Applications"
            ? (await this.applicationIcon(item.filePath)) ||
              (await this.nativePreview(item.filePath))
            : await this.nativePreview(item.filePath);
        if (native) await fs.writeFile(temporary, native);
        else if (!(await this.ffmpegPreview(item, temporary)))
          return { url: null };
        await fs.rename(temporary, file);
        this.generated++;
        if (this.generated % 25 === 0) await this.prune();
        return { url: await this.read(file) };
      } finally {
        await fs.rm(temporary, { force: true }).catch(() => {});
      }
    });
    this.pending.set(key, operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(key);
    }
  }

  enqueue(task) {
    const result = this.queue.then(() =>
      this.closed ? { url: null } : task(),
    );
    this.queue = result.catch(() => ({ url: null }));
    return result.catch(() => ({ url: null }));
  }

  async read(file) {
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile() || stat.size === 0 || stat.size > MAX_RESPONSE_BYTES)
      return null;
    const data = await fs.readFile(file);
    return `data:image/jpeg;base64,${data.toString("base64")}`;
  }

  async nativePreview(filePath) {
    if (!this.nativeImage?.createThumbnailFromPath) return null;
    try {
      const image = await this.nativeImage.createThumbnailFromPath(filePath, {
        width: 160,
        height: 100,
      });
      if (!image || image.isEmpty()) return null;
      const data = image.toJPEG(76);
      return data.length && data.length <= MAX_RESPONSE_BYTES ? data : null;
    } catch {
      return null;
    }
  }

  async applicationIcon(filePath) {
    if (!this.getFileIcon) return null;
    try {
      const image = await this.getFileIcon(filePath, { size: "large" });
      if (!image || image.isEmpty()) return null;
      const data = image
        .resize({ width: 160, height: 100, quality: "best" })
        .toJPEG(76);
      return data.length && data.length <= MAX_RESPONSE_BYTES ? data : null;
    } catch {
      return null;
    }
  }

  async ffmpegPreview(item, output) {
    if (!["Images", "Video", "Audio"].includes(item.category)) return false;
    const executable = path.join(
      this.binPath || "",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    );
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
    if (item.category === "Video") args.push("-ss", "1");
    args.push(
      "-i",
      item.filePath,
      "-map",
      "0:v:0",
      "-frames:v",
      "1",
      "-vf",
      "scale=160:100:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=160:100:(ow-iw)/2:(oh-ih)/2:color=0x171d24",
      "-q:v",
      "5",
      "-update",
      "1",
      output,
    );
    return new Promise((resolve) => {
      const child = spawn(executable, args, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      this.children.add(child);
      let stderr = "";
      const timer = setTimeout(() => child.kill(), 10000);
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-4000);
      });
      child.once("error", () => finish(false));
      child.once("close", (code) => finish(code === 0));
      const finish = (success) => {
        clearTimeout(timer);
        this.children.delete(child);
        resolve(success);
      };
    });
  }

  async prune() {
    const names = (await fs.readdir(this.folder).catch(() => [])).filter(
      (name) => /^[a-f0-9]{64}\.jpg$/.test(name),
    );
    const files = await Promise.all(
      names.map(async (name) => {
        const file = path.join(this.folder, name);
        const stat = await fs.stat(file).catch(() => null);
        return stat ? { file, size: stat.size, mtime: stat.mtimeMs } : null;
      }),
    );
    const valid = files.filter(Boolean).sort((a, b) => b.mtime - a.mtime);
    let total = valid.reduce((sum, file) => sum + file.size, 0);
    for (let index = MAX_CACHE_FILES; index < valid.length; index++) {
      await fs.rm(valid[index].file, { force: true }).catch(() => {});
      total -= valid[index].size;
    }
    for (const file of valid.slice(0, MAX_CACHE_FILES).reverse()) {
      if (total <= MAX_CACHE_BYTES) break;
      await fs.rm(file.file, { force: true }).catch(() => {});
      total -= file.size;
    }
  }

  async close() {
    this.closed = true;
    for (const child of this.children) child.kill();
    await this.queue;
  }
}

module.exports = { PreviewService };
