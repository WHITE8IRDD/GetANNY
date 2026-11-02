const WebSocket = require("ws");
const { timingSafeEqual, randomBytes, randomUUID } = require("node:crypto");
const { getBrowser, CHROMIUM_ID, FIREFOX_ID } = require("./catalog");

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const BLOCKED_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "proxy-authorization",
  "proxy-connection",
  "range",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function equalSecret(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string" ||
    Buffer.byteLength(a) !== Buffer.byteLength(b)
  )
    return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function loopbackHost(value) {
  if (typeof value !== "string" || !value) return false;
  const host = value.trim().toLowerCase();
  if (host.startsWith("[")) return host.split("]")[0] === "[::1";
  return ["127.0.0.1", "localhost"].includes(host.split(":")[0]);
}

function allowedOrigin(origin) {
  return (
    !origin ||
    origin === `chrome-extension://${CHROMIUM_ID}` ||
    /^moz-extension:\/\/[a-f0-9-]+$/i.test(origin)
  );
}

function cleanHeaders(input) {
  if (input == null) return undefined;
  if (
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    throw new Error("Download headers must be a plain object.");
  const output = {};
  let size = 0;
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = String(rawName).trim();
    const value = String(rawValue);
    const lower = name.toLowerCase();
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]{1,80}$/i.test(name))
      throw new Error("Download request contains an invalid header name.");
    if (BLOCKED_REQUEST_HEADERS.has(lower))
      throw new Error(
        `The ${name} header cannot be supplied by a browser handoff.`,
      );
    if (/[\r\n\0]/.test(value) || value.length > 16384)
      throw new Error(`The ${name} header value is invalid or too large.`);
    size += name.length + value.length;
    if (size > 32768 || Object.keys(output).length >= 64)
      throw new Error("Download request headers are too large.");
    output[name] = value;
  }
  return output;
}

function boundedString(value, maximum, label, { optional = true } = {}) {
  if (value == null && optional) return undefined;
  if (typeof value !== "string" || !value || value.length > maximum)
    throw new Error(`${label} is invalid or too large.`);
  if (value.includes("\0")) throw new Error(`${label} contains invalid data.`);
  return value;
}

class WebSocketServer {
  constructor({
    port = 29615,
    // `token` is retained for test fixtures and old callers. Production passes
    // distinct native, recovery and per-browser credentials below.
    token = randomBytes(32).toString("hex"),
    nativeToken = token,
    recoveryToken = token,
    clientTokens = {},
    enabled = true,
    onMediaDetected = () => {},
    onDownloadRequest = async () => {
      throw new Error("Download handler unavailable.");
    },
    onDownloadStatus = async () => ({ action: "missing" }),
    onHello = () => {},
    theme = null,
  } = {}) {
    Object.assign(this, {
      port,
      token,
      nativeToken,
      recoveryToken,
      clientTokens,
      enabled,
      onMediaDetected,
      onDownloadRequest,
      onDownloadStatus,
      onHello,
      theme,
    });
    this.clients = new Map();
    this.browserCommands = new Map();
    this.server = new WebSocket.Server({
      host: "127.0.0.1",
      port,
      maxPayload: 128 * 1024,
      perMessageDeflate: false,
      verifyClient: ({ origin, req }) =>
        loopbackHost(req.headers.host) && allowedOrigin(origin),
    });
    this.server.on("listening", () => {
      this.port = this.server.address().port;
    });
    this.server.on("error", (error) => {
      this.error = error;
    });
    this.server.on("connection", (socket, request) => {
      const state = {
        sessionId: randomUUID(),
        authenticated: false,
        authFailures: 0,
        lastSeen: Date.now(),
        origin: request.headers.origin || null,
        pendingRequests: new Set(),
      };
      this.clients.set(socket, state);
      const authTimeout = setTimeout(() => {
        if (!state.authenticated) socket.close(1008, "Pairing required");
      }, 10000);
      socket.on("close", () => {
        clearTimeout(authTimeout);
        this.clients.delete(socket);
      });
      socket.on("error", () => {
        clearTimeout(authTimeout);
        this.clients.delete(socket);
      });
      socket.on("message", (raw) => this.handle(socket, state, raw));
    });
    this.heartbeat = setInterval(() => {
      for (const [socket, state] of this.clients)
        if (Date.now() - state.lastSeen > 65000) socket.terminate();
    }, 15000);
    this.heartbeat.unref?.();
  }

  authenticate(state, message) {
    const supplied = message.token;
    if (typeof supplied !== "string" || !TOKEN_PATTERN.test(supplied))
      return null;
    if (
      !state.origin &&
      message.transport === "native" &&
      equalSecret(supplied, this.nativeToken)
    )
      return { transport: "native", credential: "native" };
    for (const [browserId, token] of Object.entries(this.clientTokens))
      if (equalSecret(supplied, token))
        return {
          transport: "websocket",
          credential: "provisioned",
          browserId,
        };
    if (equalSecret(supplied, this.recoveryToken))
      return { transport: "websocket", credential: "recovery" };
    return null;
  }

  async handle(socket, state, raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
      if (!message || typeof message !== "object" || Array.isArray(message))
        throw new Error("Invalid bridge message.");
      state.lastSeen = Date.now();
      if (message.type === "authenticate") {
        if (!this.enabled)
          throw new Error(
            "Browser integration is disabled in GetANNY settings.",
          );
        const authorization = this.authenticate(state, message);
        if (!authorization) {
          state.authFailures++;
          this.reply(socket, {
            type: "authentication-error",
            success: false,
            error:
              "This extension is not paired with this GetANNY installation. Refresh its package in Browser integration, or use the recovery key.",
          });
          if (state.authFailures >= 1) socket.close(1008, "Invalid pairing");
          return;
        }
        state.authenticated = true;
        state.transport = authorization.transport;
        state.credential = authorization.credential;
        state.authorizedBrowserId = authorization.browserId || null;
        this.reply(socket, {
          type: "authenticated",
          success: true,
          protocol: 2,
        });
        return;
      }
      if (message.type === "ping") {
        this.reply(socket, {
          type: "pong",
          requestId: message.requestId,
          authenticated: state.authenticated && !!state.browserId,
        });
        return;
      }
      if (!this.enabled || !state.authenticated)
        throw new Error(
          "Connect through a provisioned local bridge, registered native host, or recovery key first.",
        );
      if (message.type === "hello") {
        const browser = getBrowser(message.browserId);
        if (![CHROMIUM_ID, FIREFOX_ID].includes(message.extensionId))
          throw new Error("Unrecognized GetANNY extension identity.");
        if (browser.family === "firefox" && message.extensionId !== FIREFOX_ID)
          throw new Error("Use the Firefox extension build.");
        if (
          browser.family === "chromium" &&
          message.extensionId !== CHROMIUM_ID
        )
          throw new Error("Use the Chromium extension build.");
        if (
          state.authorizedBrowserId &&
          state.authorizedBrowserId !== message.browserId
        )
          throw new Error(
            "This prepared extension credential belongs to a different browser.",
          );
        state.browserId = message.browserId;
        state.extensionId = message.extensionId;
        state.version = String(message.version || "").slice(0, 40);
        this.onHello({ ...state });
        this.reply(socket, {
          type: "hello-result",
          requestId: message.requestId,
          success: true,
          connected: true,
          protocol: 2,
          browserId: state.browserId,
          transport: state.transport,
          theme: this.theme,
          // Native messaging is a browser-authenticated bootstrap channel. It
          // provisions the browser-specific direct credential once, after
          // which reconnects do not depend on registry discovery.
          ...(state.transport === "native" &&
          TOKEN_PATTERN.test(this.clientTokens[state.browserId] || "")
            ? { pairingToken: this.clientTokens[state.browserId] }
            : {}),
        });
      } else if (!state.browserId)
        throw new Error(
          "Extension handshake is incomplete. Reconnect the extension.",
        );
      else if (message.type === "browser-download-result") {
        const pending = this.browserCommands.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.browserCommands.delete(message.requestId);
          pending.resolve(message);
        }
      } else if (message.type === "download-status") {
        const result = await this.onDownloadStatus(
          {
            transferId: boundedString(
              message.transferId,
              100,
              "Browser transfer identity",
              { optional: false },
            ),
            source: state.browserId,
          },
          { sessionId: state.sessionId },
        );
        this.reply(socket, {
          type: "download-status-result",
          requestId: message.requestId,
          success: true,
          ...result,
        });
      } else if (message.type === "download") {
        if (state.pendingRequests.size >= 20)
          throw new Error(
            "Too many browser downloads are being handed off. Try again shortly.",
          );
        const key =
          message.requestId == null
            ? randomUUID()
            : boundedString(message.requestId, 100, "Request identity", {
                optional: false,
              });
        if (state.pendingRequests.has(key))
          throw new Error(
            "A browser request with this identity is already pending.",
          );
        state.pendingRequests.add(key);
        try {
          const result = await this.onDownloadRequest(
            {
              url: boundedString(message.url, 8192, "Download URL", {
                optional: false,
              }),
              filename: boundedString(message.filename, 512, "Filename"),
              headers: cleanHeaders(message.headers),
              mimeType: boundedString(message.mimeType, 200, "Media type"),
              kind: message.kind === "media" ? "media" : "file",
              intercepted: message.intercepted === true,
              transferId:
                typeof message.transferId === "string"
                  ? message.transferId.slice(0, 100)
                  : null,
              source: state.browserId,
            },
            { sessionId: state.sessionId },
          );
          this.reply(socket, {
            type: "download-result",
            requestId: message.requestId,
            success: true,
            ...result,
          });
        } finally {
          state.pendingRequests.delete(key);
        }
      } else if (message.type === "media-detected") {
        if (
          typeof message.url === "string" &&
          /^https?:\/\//.test(message.url) &&
          message.url.length < 8192
        )
          this.onMediaDetected({
            url: message.url,
            pageUrl:
              typeof message.pageUrl === "string" &&
              message.pageUrl.length < 8192 &&
              /^https?:\/\//.test(message.pageUrl)
                ? message.pageUrl
                : undefined,
            title: String(message.title || "").slice(0, 240),
            source: state.browserId,
            detectedAt: Date.now(),
          });
      } else throw new Error("Unsupported bridge action.");
    } catch (error) {
      this.reply(socket, {
        type: "error",
        requestId: message?.requestId,
        success: false,
        error: error.message,
      });
    }
  }
  reply(socket, data) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
  }
  downloadCommand(sessionId, action, transferId) {
    const session = [...this.clients.entries()].find(
      ([socket, state]) =>
        state.sessionId === sessionId &&
        state.browserId &&
        socket.readyState === WebSocket.OPEN,
    );
    if (!session) return Promise.resolve({ success: false, missing: true });
    const [socket] = session;
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.browserCommands.delete(requestId);
        resolve({ success: false, error: "Browser command timed out." });
      }, 8000);
      this.browserCommands.set(requestId, { resolve, timer });
      this.reply(socket, {
        type: "browser-download-command",
        requestId,
        action,
        transferId: String(transferId),
      });
    });
  }
  setTheme(theme) {
    this.theme = theme || null;
    if (!this.theme) return;
    for (const [socket, state] of this.clients)
      if (
        state.authenticated &&
        state.browserId &&
        socket.readyState === WebSocket.OPEN
      )
        this.reply(socket, { type: "theme", theme: this.theme });
  }
  status() {
    const sessions = [...this.clients.values()]
      .filter(
        (client) =>
          client.authenticated &&
          client.browserId &&
          Date.now() - client.lastSeen < 65000,
      )
      .map(({ browserId, transport, version, lastSeen, credential }) => ({
        browserId,
        transport,
        version,
        lastSeen,
        credential,
      }));
    return {
      running: !!this.server?.address(),
      enabled: this.enabled,
      port: this.port,
      protocol: 2,
      clients: sessions.length,
      sessions,
      error: this.error?.message || null,
    };
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled)
      for (const socket of this.clients.keys())
        socket.close(1008, "Browser integration disabled");
  }
  async close() {
    clearInterval(this.heartbeat);
    for (const pending of this.browserCommands.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ success: false, error: "Desktop bridge closed." });
    }
    this.browserCommands.clear();
    for (const socket of this.clients.keys()) socket.terminate();
    this.clients.clear();
    if (!this.server) return;
    await new Promise((resolve) => {
      try {
        this.server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }
}
module.exports = {
  WebSocketServer,
  equalSecret,
  loopbackHost,
  allowedOrigin,
  cleanHeaders,
};
