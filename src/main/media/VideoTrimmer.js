const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");

function run(executable, args, signal, onProgress) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      error = "",
      buffer = "";
    const abort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on("data", (data) => {
      if (!onProgress) {
        output = (output + data).slice(-2000000);
        return;
      }
      buffer += data.toString();
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line.startsWith("out_time_us=")) {
          const seconds = Number(line.slice(12)) / 1000000;
          if (Number.isFinite(seconds)) onProgress(seconds);
        }
      }
    });
    child.stderr.on("data", (data) => {
      error = (error + data).slice(-12000);
    });
    const cleanup = () => signal?.removeEventListener("abort", abort);
    child.once("error", (e) => {
      cleanup();
      reject(e);
    });
    child.once("close", (code) => {
      cleanup();
      if (signal?.aborted) reject(new Error("Media operation stopped."));
      else if (code !== 0)
        reject(new Error(`Video processing failed (${code}): ${error}`));
      else resolve(output);
    });
  });
}

async function trimVideo({ source, segment, binPath, signal, onProgress }) {
  const start = Number(segment.start),
    end = Number(segment.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end - start < 1
  )
    throw new Error("Choose a valid video segment of at least one second.");
  const binary = (name) =>
    path.join(binPath, name + (process.platform === "win32" ? ".exe" : ""));
  for (const name of ["ffmpeg", "ffprobe"])
    await fs.access(binary(name)).catch(() => {
      throw new Error(
        `${name} is missing. Reinstall the complete application to restore video trimming.`,
      );
    });
  const probe = async (file) =>
    JSON.parse(
      await run(
        binary("ffprobe"),
        ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
        signal,
      ),
    );
  const info = await probe(source);
  const video = info.streams.find(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic,
  );
  if (!video) throw new Error("The selected source contains no video stream.");
  const length = end - start;
  if (Number(info.format?.duration) + 0.1 < end)
    throw new Error("The selected end exceeds the source duration.");
  // MKV supports VFR and lossless audio without imposing MP4 codec restrictions.
  const target = source + ".trimmed.mkv";
  const hdr = ["smpte2084", "arib-std-b67"].includes(video.color_transfer);
  const args = [
    "-hide_banner",
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-ss",
    String(start),
    "-accurate_seek",
    "-i",
    source,
    "-t",
    String(length),
    "-map",
    `0:${video.index}`,
    "-map",
    "0:a:0?",
    "-map_metadata",
    "0",
    "-map_chapters",
    "-1",
    "-c:v",
    hdr ? "libx265" : "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "16",
    "-threads",
    "4",
    "-fps_mode",
    "passthrough",
    "-c:a",
    "flac",
    "-max_muxing_queue_size",
    "4096",
  ];
  // Unsupported pixel formats fail rather than silently discarding bit depth.
  if (video.pix_fmt) args.push("-pix_fmt", video.pix_fmt);
  if (hdr) args.push("-x265-params", "pools=4:frame-threads=2");
  for (const [key, flag] of [
    ["color_range", "-color_range"],
    ["color_space", "-colorspace"],
    ["color_transfer", "-color_trc"],
    ["color_primaries", "-color_primaries"],
  ])
    if (video[key] && !["unknown", "unspecified"].includes(video[key]))
      args.push(flag, video[key]);
  args.push("-progress", "pipe:1", "-nostats", target);
  try {
    await run(binary("ffmpeg"), args, signal, onProgress);
    const result = await probe(target);
    const outputVideo = result.streams.find((s) => s.codec_type === "video");
    if (video.pix_fmt && outputVideo?.pix_fmt !== video.pix_fmt)
      throw new Error(
        "This source pixel format cannot be preserved by the segment encoder. Output was not published.",
      );
    const duration = Number(result.format?.duration);
    const [n, d] = String(video.avg_frame_rate || "0/1")
      .split("/")
      .map(Number);
    const tolerance = Math.max(0.12, n > 0 && d > 0 ? (2 * d) / n : 0.25);
    if (
      !result.streams.some((s) => s.codec_type === "video") ||
      !Number.isFinite(duration) ||
      Math.abs(duration - length) > tolerance
    )
      throw new Error(
        "The exported duration does not match the selection. Output was not published.",
      );
    return target;
  } catch (error) {
    await fs.rm(target, { force: true }).catch(() => {});
    throw error;
  }
}
module.exports = { trimVideo };
