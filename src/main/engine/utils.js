const path = require("node:path");

// URL path segments and query-parameter-style names that are never filenames.
// Google Drive exposes /uc and /identifier endpoints whose response body is the
// real file; saving those names produced extensionless "identifier" files.
const GENERIC_FILENAMES = new Set([
  "identifier",
  "uc",
  "download",
  "downloads",
  "file",
  "files",
  "get",
  "fetch",
  "open",
  "view",
  "preview",
  "content",
  "docs",
  "document",
  "redirect",
  "index.html",
  "index.htm",
]);

const MIME_EXTENSIONS = {
  "application/zip": ".zip",
  "application/x-zip-compressed": ".zip",
  "application/x-rar-compressed": ".rar",
  "application/vnd.rar": ".rar",
  "application/x-7z-compressed": ".7z",
  "application/gzip": ".gz",
  "application/x-tar": ".tar",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    ".pptx",
  "application/epub+zip": ".epub",
  "application/vnd.android.package-archive": ".apk",
  "application/x-msdownload": ".exe",
  "application/vnd.microsoft.portable-executable": ".exe",
  "application/x-msi": ".msi",
  "application/octet-stream": ".bin",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-matroska": ".mkv",
  "video/x-msvideo": ".avi",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "audio/flac": ".flac",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/html": ".html",
  "application/json": ".json",
  "application/xml": ".xml",
};

const AUTH_REQUIRED_MESSAGE =
  "Authentication required: Please ensure site cookies are forwarded via the browser extension.";

function sanitizeFilename(name = "download") {
  let safe = path
    .basename(String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, "_"))
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 220);
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(safe))
    safe = `_${safe}`;
  return safe || "download";
}

function decodePercentBytes(value, charset = "utf-8") {
  try {
    return decodeURIComponent(value);
  } catch {
    // Tolerate malformed or legacy-charset percent escapes without losing the
    // rest of an otherwise useful filename.
    const bytes = [];
    for (let index = 0; index < value.length; index++) {
      const char = value[index];
      if (
        char === "%" &&
        /^[0-9a-f]{2}$/i.test(value.slice(index + 1, index + 3))
      ) {
        bytes.push(parseInt(value.slice(index + 1, index + 3), 16));
        index += 2;
      } else {
        bytes.push(char.charCodeAt(0) & 0xff);
      }
    }
    const buffer = Buffer.from(bytes);
    return /^(?:iso-8859-1|latin-?1)$/i.test(charset)
      ? buffer.toString("latin1")
      : buffer.toString("utf8");
  }
}

function parseExtendedValue(value) {
  const source = String(value || "")
    .trim()
    .replace(/^"(.*)"$/, "$1");
  const match = /^([^']*)'[^']*'(.*)$/.exec(source);
  if (match) return decodePercentBytes(match[2], match[1]);
  // Some servers omit the charset/language prefix even though the value is
  // still percent encoded. Accept it rather than falling back to "identifier".
  return decodePercentBytes(source);
}

function parseDispositionParameters(header) {
  const parameters = {};
  const source = String(header || "");
  const matcher = /;\s*([^=;\s]+)\s*=\s*(?:"((?:\\.|[^"])*)"|([^;]*))/g;
  let match;
  while ((match = matcher.exec(source))) {
    const key = match[1].toLowerCase();
    parameters[key] =
      match[2] !== undefined
        ? match[2].replace(/\\(.)/g, "$1")
        : match[3].trim();
  }
  return parameters;
}

function getFilenameFromHeaders(header) {
  if (!header) return null;
  const parameters = parseDispositionParameters(header);
  const extended = parameters["filename*"];
  if (extended) {
    try {
      const decoded = parseExtendedValue(extended);
      if (decoded) return decoded;
    } catch {
      /* fall through to the plain filename */
    }
  }
  if (parameters.filename) return parameters.filename;
  try {
    const parsed = require("content-disposition").parse(header);
    return parsed?.parameters?.filename || null;
  } catch {
    return null;
  }
}

function isGenericFilename(name) {
  const base = String(name || "")
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1)
    ?.trim()
    .toLowerCase();
  return !base || GENERIC_FILENAMES.has(base);
}

function getFilenameFromURL(value) {
  try {
    const base = decodeURIComponent(
      path.posix.basename(new URL(value).pathname),
    );
    return base && !isGenericFilename(base) ? base : null;
  } catch {
    return null;
  }
}

function mimeTypeOf(value) {
  return String(value || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function extensionForMimeType(mimeType) {
  return MIME_EXTENSIONS[mimeTypeOf(mimeType)] || null;
}

function withMimeExtension(name, mimeType) {
  const extension = extensionForMimeType(mimeType);
  if (!extension) return name;
  const current = path.extname(name).toLowerCase();
  if (current) return name;
  return `${name}${extension}`;
}

function isHtmlContentType(mimeType) {
  return /^(?:text\/html|application\/xhtml\+xml)$/.test(mimeTypeOf(mimeType));
}

function isHtmlFilename(name) {
  return /\.(?:html?|xhtml|mhtml)$/i.test(String(name || ""));
}

function isAuthenticationPage(body) {
  const text = String(body || "").slice(0, 256 * 1024);
  if (!/<\s*(?:!doctype\s+html|html|head|body|form|title)\b/i.test(text))
    return false;
  return [
    /accounts\.google\.com/i,
    /service\/login/i,
    /google\s+drive/i,
    /virus\s+scan\s+warning/i,
    /download\s+quota/i,
    /too\s+many\s+users\s+have\s+viewed\s+or\s+downloaded/i,
    /confirm\s+you(?:'|’)?re\s+not\s+a\s+robot/i,
    /sign\s*in/i,
    /log\s*in/i,
    /authorization\s+required/i,
    /authentication\s+required/i,
    /access\s+denied/i,
  ].some((pattern) => pattern.test(text));
}

function isDynamicArchive(url, headers = {}) {
  const type = mimeTypeOf(headers["content-type"]);
  if (type !== "application/zip" && type !== "application/x-zip-compressed")
    return false;
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  const googleDrive =
    /(?:^|\.)(?:drive|docs)\.google\.com$/.test(host) ||
    /(?:^|\.)drive\.usercontent\.google\.com$/.test(host);
  if (googleDrive)
    return (
      /\/drive\/(?:u\/\d+\/)?folders\//i.test(url) ||
      /[?&]export=download/i.test(url) ||
      /\/uc(?:[?#/]|$)/i.test(url) ||
      /\/zip(?:[?#/]|$)/i.test(url) ||
      !headers["content-length"] ||
      !headers["content-disposition"]
    );
  // A streaming archive without a stable length cannot be split safely.
  return !headers["content-length"] || !headers["content-disposition"];
}

function authenticationRequiredError() {
  const error = new Error(AUTH_REQUIRED_MESSAGE);
  error.code = "AUTH_REQUIRED";
  error.authenticationRequired = true;
  error.retryable = false;
  return error;
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error("Enter a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Use an HTTP or HTTPS URL.");
  if (url.username || url.password)
    throw new Error("URLs with embedded credentials are not supported.");
  return url.href;
}

function validateHeaders(headers = {}) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers))
    throw new Error("Invalid request headers.");
  const result = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(key) || /[\r\n]/.test(String(value)))
      throw new Error("Invalid request header.");
    if (
      [
        "host",
        "content-length",
        "connection",
        "range",
        "if-range",
        "accept-encoding",
      ].includes(key.toLowerCase())
    )
      continue;
    result[key] = String(value);
  }
  return result;
}

function categoryFor(name) {
  const ext = path.extname(name).toLowerCase();
  if (/^\.(mp4|mkv|webm|mov|avi|m4v)$/.test(ext)) return "Video";
  if (/^\.(mp3|m4a|aac|wav|flac|opus|ogg)$/.test(ext)) return "Audio";
  if (/^\.(zip|7z|rar|tar|gz|bz2|xz)$/.test(ext)) return "Archives";
  if (/^\.(exe|msi|dmg|appimage|deb|rpm)$/.test(ext)) return "Applications";
  if (/^\.(pdf|docx?|xlsx?|pptx?|txt|epub|csv)$/.test(ext)) return "Documents";
  if (/^\.(png|jpe?g|gif|webp|svg|avif)$/.test(ext)) return "Images";
  return "Other";
}

function formatBytes(n = 0) {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(n) / Math.log(1024)),
    units.length - 1,
  );
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

module.exports = {
  AUTH_REQUIRED_MESSAGE,
  sanitizeFilename,
  getFilenameFromHeaders,
  getFilenameFromURL,
  isGenericFilename,
  extensionForMimeType,
  withMimeExtension,
  isHtmlContentType,
  isHtmlFilename,
  isAuthenticationPage,
  isDynamicArchive,
  authenticationRequiredError,
  validateUrl,
  validateHeaders,
  categoryFor,
  formatBytes,
};
