const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs/promises");
const { validateUrl } = require("../engine/utils");
const {
  normalizeFormats,
  normalizeThumbnails,
  normalizeSubtitles,
} = require("./formats");

class YtDlpWrapper {
  constructor({ binPath, executable, spawnProcess = spawn } = {}) {
    this.binPath = binPath || "";
    this.executableOverride = executable;
    this.spawnProcess = spawnProcess;
  }
  executable() {
    return (
      this.executableOverride ||
      path.join(
        this.binPath,
        process.platform === "win32"
          ? "yt-dlp.exe"
          : process.platform === "darwin"
            ? "yt-dlp_macos"
            : "yt-dlp",
      )
    );
  }
  async availability() {
    const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    const [ytdlp, ffmpeg] = await Promise.all([
      fs.access(this.executable()).then(
        () => true,
        () => false,
      ),
      fs.access(path.join(this.binPath, name)).then(
        () => true,
        () => false,
      ),
    ]);
    return { ytdlp, ffmpeg };
  }
  run(args, { onProgress = () => {}, onFile = () => {}, signal } = {}) {
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(this.executable(), args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        detached: process.platform !== "win32",
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      });
      let stdout = "",
        stderr = "",
        buffer = "",
        killed = false,
        killTimer;
      const abort = () => {
        killed = true;
        if (!child.pid) return;
        if (process.platform === "win32") {
          const treeKiller = spawn(
            "taskkill",
            ["/pid", String(child.pid), "/T", "/F"],
            {
              windowsHide: true,
              stdio: "ignore",
            },
          );
          treeKiller.on("error", () => child.kill());
          treeKiller.on("close", (code) => {
            if (code !== 0) child.kill();
          });
          // Do not let a failed or blocked taskkill leave the transfer running
          // until it finishes naturally. The tree kill above gets first chance
          // to stop FFmpeg children; this closes yt-dlp promptly as fallback.
          killTimer = setTimeout(() => child.kill(), 500);
        } else {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill();
          }
          killTimer = setTimeout(() => {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill();
            }
          }, 3000);
        }
        killTimer.unref?.();
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const line = (value) => {
        if (value.startsWith("GETANNY_PROGRESS:")) {
          try {
            onProgress(JSON.parse(value.slice("GETANNY_PROGRESS:".length)));
          } catch {
            /* unrelated tool output */
          }
        } else if (value.startsWith("GETANNY_FILE:")) {
          try {
            onFile(JSON.parse(value.slice("GETANNY_FILE:".length)));
          } catch {
            /* invalid output rejected by final verification */
          }
        } else stdout += value + "\n";
        if (stdout.length > 25_000_000) {
          child.kill();
          reject(
            new Error("Media metadata exceeds the supported response size."),
          );
        }
      };
      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString();
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          line(buffer.slice(0, end).trim());
          buffer = buffer.slice(end + 1);
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-12000);
      });
      child.once("error", (error) => {
        signal?.removeEventListener("abort", abort);
        reject(
          new Error(
            error.code === "ENOENT"
              ? "yt-dlp is missing. Run npm run prepare:tools or reinstall the complete application."
              : `Could not start yt-dlp: ${error.message}`,
          ),
        );
      });
      child.once("close", (code) => {
        clearTimeout(killTimer);
        signal?.removeEventListener("abort", abort);
        if (buffer.trim()) line(buffer.trim());
        if (killed || signal?.aborted)
          reject(new Error("Media operation stopped."));
        else if (code === 0) resolve(stdout.trim());
        else
          reject(
            new Error(
              stderr.trim() || `yt-dlp stopped with exit code ${code}.`,
            ),
          );
      });
    });
  }
  async getInfo(url, { signal } = {}) {
    const out = await this.run(
      [
        "--ignore-config",
        "--js-runtimes",
        `node:${process.execPath}`,
        "--dump-single-json",
        "--no-warnings",
        "--no-playlist",
        "--socket-timeout",
        "30",
        "--",
        validateUrl(url),
      ],
      { signal },
    );
    try {
      return JSON.parse(out);
    } catch {
      throw new Error("yt-dlp returned invalid media metadata.");
    }
  }
  async getFormats(url) {
    const info = await this.getInfo(url);
    return {
      title: info.title || "Untitled media",
      url: info.webpage_url || url,
      thumbnail: info.thumbnail || null,
      duration:
        Number.isFinite(Number(info.duration)) && Number(info.duration) > 0
          ? Number(info.duration)
          : null,
      live:
        info.is_live === true ||
        ["is_live", "is_upcoming"].includes(info.live_status),
      extractor: info.extractor_key || info.extractor || null,
      description: typeof info.description === "string" ? info.description : "",
      tags: Array.isArray(info.tags)
        ? info.tags.filter((tag) => typeof tag === "string" && tag.trim())
        : [],
      thumbnails: normalizeThumbnails(info),
      subtitles: normalizeSubtitles(info),
      formats: normalizeFormats(info),
    };
  }
  async getPlaylist(url) {
    const output = await this.run([
      "--ignore-config",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      "--playlist-end",
      "1000",
      "--socket-timeout",
      "30",
      "--",
      validateUrl(url),
    ]);
    let info;
    try {
      info = JSON.parse(output);
    } catch {
      throw new Error("yt-dlp returned invalid playlist metadata.");
    }
    const entries = Array.isArray(info.entries) ? info.entries : [];
    return {
      title: String(info.title || "Playlist").slice(0, 300),
      entries: entries
        .slice(0, 1000)
        .map((entry) => {
          const candidate =
            entry.webpage_url || entry.original_url || entry.url;
          let entryUrl = candidate;
          if (
            !/^https?:\/\//i.test(String(candidate || "")) &&
            entry.id &&
            /youtube/i.test(
              String(entry.extractor_key || info.extractor_key || ""),
            )
          )
            entryUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(entry.id)}`;
          try {
            entryUrl = validateUrl(entryUrl);
          } catch {
            return null;
          }
          return {
            url: entryUrl,
            title: String(entry.title || entry.id || "Untitled media").slice(
              0,
              300,
            ),
            duration: Number(entry.duration) || null,
          };
        })
        .filter(Boolean),
    };
  }
  async downloadSubtitles({
    url,
    language,
    automatic = false,
    format = "vtt",
    sourceFormats = [],
    outputTemplate,
    timeout = 30,
    signal,
  }) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/i.test(language))
      throw new Error("Choose an available subtitle language.");
    if (!["srt", "vtt"].includes(format))
      throw new Error("Subtitles can be downloaded as SRT or VTT.");
    await fs.mkdir(path.dirname(outputTemplate), { recursive: true });
    const tools = await this.availability();
    const direct = sourceFormats.includes(format);
    if (!direct && !tools.ffmpeg)
      throw new Error(
        `This caption is not directly available as ${format.toUpperCase()}. FFmpeg is required for subtitle conversion.`,
      );
    const args = [
      "--ignore-config",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--no-playlist",
      "--skip-download",
      automatic ? "--write-auto-subs" : "--write-subs",
      "--sub-langs",
      language,
      "--sub-format",
      direct ? format : "vtt/srv3/ttml/srv2/srv1/json3/best",
      "--no-overwrites",
      "--no-mtime",
      "--windows-filenames",
      "--socket-timeout",
      String(timeout),
      "--retries",
      "2",
      "-o",
      outputTemplate,
    ];
    if (!direct) args.push("--convert-subs", format);
    if (tools.ffmpeg) args.push("--ffmpeg-location", this.binPath);
    args.push("--", validateUrl(url));
    await this.run(args, { signal });
    const folder = path.dirname(outputTemplate);
    const stem = path.basename(outputTemplate).replace(/\.%\(ext\)s$/, "");
    const candidates = (await fs.readdir(folder)).filter(
      (name) =>
        name.startsWith(`${stem}.`) &&
        name.endsWith(`.${format}`) &&
        !name.includes(".part"),
    );
    const stats = await Promise.all(
      candidates.map(async (name) => ({
        name,
        stat: await fs.stat(path.join(folder, name)).catch(() => null),
      })),
    );
    const file = stats
      .filter((entry) => entry.stat?.isFile() && entry.stat.size > 0)
      .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
    if (!file)
      throw new Error(
        "yt-dlp did not produce the requested subtitle file. The caption may no longer be available.",
      );
    return path.join(folder, file.name);
  }
  async download({
    url,
    formatId,
    mergeAudio,
    outputTemplate,
    speedLimit,
    segment,
    timeout = 30,
    onProgress,
    onFile,
    signal,
  }) {
    if (!/^[\w.-]+$/.test(formatId))
      throw new Error("Choose an available media format.");
    const tools = await this.availability();
    if (mergeAudio && !tools.ffmpeg)
      throw new Error(
        "This video format needs FFmpeg to include audio. Reinstall the complete application, or choose a format that already includes sound.",
      );
    if (segment && !tools.ffmpeg)
      throw new Error(
        "FFmpeg is required to download a selected video segment. Reinstall the complete application to restore it.",
      );
    await fs.mkdir(path.dirname(outputTemplate), { recursive: true });
    const args = [
      "--ignore-config",
      "--js-runtimes",
      `node:${process.execPath}`,
      "--no-playlist",
      "--newline",
      "--no-color",
      "--progress",
      "--continue",
      "--no-overwrites",
      "--no-mtime",
      "--windows-filenames",
      "--socket-timeout",
      String(timeout),
      "--retries",
      "2",
      "--fragment-retries",
      "2",
      "--progress-template",
      "download:GETANNY_PROGRESS:%(progress)j",
      "--print",
      "after_move:GETANNY_FILE:%(filepath)j",
      "--no-simulate",
      "-o",
      outputTemplate,
      "-f",
      mergeAudio ? `${formatId}+bestaudio` : formatId,
    ];
    if (segment) {
      const start = Number(segment.start);
      const end = Number(segment.end);
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start ||
        end - start < 1
      )
        throw new Error("Choose a valid video segment of at least one second.");
      const time = (value) => {
        const whole = Math.floor(value);
        const hours = Math.floor(whole / 3600);
        const minutes = Math.floor((whole % 3600) / 60);
        const seconds = whole % 60;
        return hours
          ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
          : `${minutes}:${String(seconds).padStart(2, "0")}`;
      };
      args.push(
        "--download-sections",
        `*${time(start)}-${time(end)}`,
        "--force-keyframes-at-cuts",
      );
    }
    if (tools.ffmpeg) args.push("--ffmpeg-location", this.binPath);
    if (speedLimit > 0) args.push("--limit-rate", String(speedLimit));
    args.push("--", validateUrl(url));
    return this.run(args, { onProgress, onFile, signal });
  }
}
module.exports = { YtDlpWrapper };
