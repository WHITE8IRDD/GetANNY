/* Shared extension implementation. Browser-specific config is generated at packaging. */
if (typeof importScripts === "function")
  importScripts("config.js", "download-interceptor.js");
const api = globalThis.browser || globalThis.chrome;
const action = api.action || api.browserAction;
const pending = new Map();
const detected = new Map();
let nativePort,
  socket,
  connecting,
  connectResolve,
  connectReject,
  connectTimeout,
  heartbeat;
let reconnectTimer;
let reconnectAttempts = 0;
let state = { connected: false, transport: null, error: null };
let currentTheme = null;
let browserId = globalThis.GETANNY_BROWSER || "chrome";
let pairingKey = "";
let interceptor;
const validUrl = (value) => {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
};
const hasHeader = (headers, name) =>
  Object.keys(headers || {}).some((key) => key.toLowerCase() === name);
async function withSiteCookies(url, headers = {}) {
  if (hasHeader(headers, "cookie") || !api.cookies?.getAll) return headers;
  try {
    const saved = await api.storage.local.get(["includeSiteCookies"]);
    // Site cookies are required for cloud/private files by default. The popup
    // and interceptor pass an explicit false when the user opts out.
    if (saved.includeSiteCookies === false) return headers;
    const cookies = await api.cookies.getAll({ url });
    if (!cookies.length) return headers;
    return {
      ...headers,
      Cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
    };
  } catch {
    // Private windows, restricted stores and missing permission fall back to
    // the browser copy instead of failing the handoff.
    return headers;
  }
}
const requestId = () => crypto.randomUUID();
function update(next) {
  state = { ...state, ...next };
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(30000, 2000 * 2 ** Math.min(reconnectAttempts, 4));
  reconnectAttempts++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((error) => update({ error: error.message }));
  }, delay);
}
function rejectPending(error) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer);
    const failure = new Error(
      error?.message || error || "Desktop connection lost.",
    );
    failure.ambiguous = true;
    entry.reject(failure);
  }
  pending.clear();
}
function sendRaw(message) {
  if (nativePort) nativePort.postMessage(message);
  else if (socket?.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(message));
  else throw new Error("GetANNY is not connected.");
}
function hello() {
  sendRaw({
    type: "hello",
    requestId: requestId(),
    browserId,
    extensionId: api.runtime.id,
    version: api.runtime.getManifest().version,
  });
}
function applyTheme(theme) {
  if (!theme || typeof theme !== "object" || !theme.colors) return;
  currentTheme = theme;
  Promise.resolve(api.storage.local.set({ getannyTheme: theme })).catch(
    () => {},
  );
  interceptor?.theme?.(theme);
}
function deliver(message) {
  if (message.type === "theme") {
    applyTheme(message.theme);
    return;
  }
  if (message.type === "browser-download-command") {
    interceptor
      ?.command(message)
      .then((result) =>
        sendRaw({
          type: "browser-download-result",
          requestId: message.requestId,
          transferId: message.transferId,
          ...result,
        }),
      )
      .catch((error) =>
        sendRaw({
          type: "browser-download-result",
          requestId: message.requestId,
          transferId: message.transferId,
          success: false,
          error: error.message,
        }),
      );
    return;
  }
  if (message.type === "hello-result" && message.success) {
    clearTimeout(connectTimeout);
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    update({ connected: true, transport: message.transport, error: null });
    if (message.theme) applyTheme(message.theme);
    connectResolve?.(state);
    connecting = null;
    connectResolve = null;
    connectReject = null;
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      try {
        sendRaw({ type: "ping", requestId: requestId() });
      } catch {
        disconnected("Desktop connection lost.");
      }
    }, 25000);
    interceptor?.reconnect().catch((error) => update({ error: error.message }));
  } else if (
    message.type === "transport-error" ||
    message.type === "authentication-error"
  ) {
    disconnected(message.error || "Desktop bridge unavailable.");
    return;
  }
  const entry = pending.get(message.requestId);
  if (entry) {
    clearTimeout(entry.timer);
    pending.delete(message.requestId);
    if (message.success) entry.resolve(message);
    else {
      const failure = new Error(
        message.error || "GetANNY rejected the request.",
      );
      failure.definitive = true;
      entry.reject(failure);
    }
  }
}
function disconnected(error) {
  clearInterval(heartbeat);
  update({ connected: false, transport: null, error });
  rejectPending(error);
  interceptor?.disconnected().catch(() => {});
  scheduleReconnect();
}
function connectWebSocket() {
  if (!pairingKey) {
    connectReject?.(
      new Error(
        state.error ||
          "Native host not available. Run browser setup in GetANNY, or enter its pairing key.",
      ),
    );
    clearTimeout(connectTimeout);
    connecting = null;
    connectResolve = null;
    connectReject = null;
    return;
  }
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  socket = new WebSocket("ws://127.0.0.1:29615");
  socket.onopen = () =>
    socket.send(
      JSON.stringify({
        type: "authenticate",
        token: pairingKey,
        transport: "websocket",
      }),
    );
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === "authenticated") hello();
      else deliver(message);
    } catch {
      disconnected("Invalid desktop response.");
    }
  };
  socket.onerror = () =>
    update({
      error:
        "Could not reach GetANNY. Start the desktop app and check Browser integration.",
    });
  socket.onclose = () => {
    disconnected(state.error || "Desktop connection closed.");
    connectReject?.(new Error(state.error));
    connecting = null;
    connectResolve = null;
    connectReject = null;
  };
}
async function connect() {
  if (state.connected) return state;
  if (connecting) return connecting;
  const saved = await api.storage.local.get(["browserId", "pairingKey"]);
  browserId = saved.browserId || globalThis.GETANNY_BROWSER || "chrome";
  pairingKey = saved.pairingKey || "";
  if (connecting) return connecting;
  connecting = new Promise((resolve, reject) => {
    connectResolve = resolve;
    connectReject = reject;
  });
  const result = connecting;
  connectTimeout = setTimeout(() => {
    disconnected(
      "No handshake from GetANNY. Start the app, register the host, or use a pairing key.",
    );
    connectReject?.(new Error(state.error));
    connecting = null;
    connectResolve = null;
    connectReject = null;
    nativePort?.disconnect();
    nativePort = null;
  }, 8000);
  try {
    if (nativePort) nativePort.disconnect();
    const port = api.runtime.connectNative("com.getanny.native");
    nativePort = port;
    port.onMessage.addListener(deliver);
    port.onDisconnect.addListener(() => {
      if (nativePort !== port) return;
      const error =
        api.runtime.lastError?.message || "Native host disconnected.";
      nativePort = null;
      disconnected(error);
      if (connecting) connectWebSocket();
    });
    hello();
  } catch (error) {
    nativePort = null;
    update({ error: error.message });
    connectWebSocket();
  }
  return result;
}
async function request(message) {
  let outgoing = message;
  if (
    message.type === "download" &&
    message.kind !== "media" &&
    message.includeSiteCookies !== false
  ) {
    outgoing = {
      ...message,
      headers: await withSiteCookies(message.url, message.headers),
    };
  }
  const { includeSiteCookies, ...payload } = outgoing;
  await connect();
  return new Promise((resolve, reject) => {
    const id = requestId();
    const timer = setTimeout(() => {
      pending.delete(id);
      const failure = new Error(
        "GetANNY did not acknowledge the request. Check the desktop application.",
      );
      failure.ambiguous = true;
      reject(failure);
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    try {
      sendRaw({ ...payload, requestId: id });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  });
}
function remember(tabId, media) {
  if (tabId < 0 || !validUrl(media.url)) return;
  const list = detected.get(tabId) || [];
  if (!list.some((item) => item.url === media.url)) {
    list.unshift({
      url: media.url,
      title: String(media.title || "").slice(0, 160),
      kind: media.kind === "media" ? "media" : "file",
      mimeType: media.mimeType || "",
    });
    detected.set(tabId, list.slice(0, 20));
    action
      ?.setBadgeText({ tabId, text: String(Math.min(20, list.length)) })
      .catch?.(() => {});
  }
}
api.runtime.onMessage.addListener((message, sender, respond) => {
  const ui = sender.url?.startsWith(api.runtime.getURL(""));
  (async () => {
    if (message.type === "status") {
      if (!state.connected && !nativePort)
        connect().catch((error) => update({ error: error.message }));
      return { ...state, browserId };
    }
    if (message.type === "reconnect" && ui) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (nativePort) {
        nativePort.disconnect();
        nativePort = null;
      }
      if (socket) {
        socket.onclose = null;
        socket.close();
        socket = null;
      }
      update({ connected: false });
      return connect();
    }
    if (message.type === "configure" && ui) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
      if (
        ![
          "helium",
          "chrome",
          "chromium",
          "brave",
          "firefox",
          "vivaldi",
          "opera",
          "edge",
        ].includes(message.browserId)
      )
        throw new Error("Choose a supported browser.");
      if (message.pairingKey && !/^[a-f0-9]{64}$/i.test(message.pairingKey))
        throw new Error("Copy the complete pairing key from GetANNY.");
      await api.storage.local.set({
        browserId: message.browserId,
        pairingKey: message.pairingKey.trim(),
      });
      if (nativePort) {
        nativePort.disconnect();
        nativePort = null;
      }
      update({ connected: false });
      return connect();
    }
    if (message.type === "media-detected") {
      remember(sender.tab?.id ?? -1, message.media || {});
      return { success: true };
    }
    if (message.type === "detected" && ui)
      return { items: detected.get(message.tabId) || [] };
    if (message.type === "theme") {
      if (currentTheme) return currentTheme;
      const saved = await api.storage.local.get(["getannyTheme"]);
      return saved.getannyTheme || null;
    }
    if (message.type === "download") {
      if (!validUrl(message.url))
        throw new Error(
          "Only HTTP and HTTPS downloads are supported. Blob URLs must be analyzed using the original media page.",
        );
      return request({
        type: "download",
        url: message.url,
        kind: message.kind === "media" ? "media" : "file",
        filename: message.filename,
        headers: message.headers,
        includeSiteCookies: message.includeSiteCookies,
      });
    }
    throw new Error("Unsupported extension action.");
  })().then(respond, (error) =>
    respond({ success: false, error: error.message }),
  );
  return true;
});
api.tabs.onRemoved.addListener((tabId) => detected.delete(tabId));
api.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.status === "loading") {
    detected.delete(tabId);
    action?.setBadgeText({ tabId, text: "" }).catch?.(() => {});
  }
});
api.webRequest?.onHeadersReceived.addListener(
  (details) => {
    const type =
      details.responseHeaders?.find(
        (header) => header.name.toLowerCase() === "content-type",
      )?.value || "";
    if (
      /^(video|audio)\/|application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)/i.test(
        type,
      )
    )
      remember(details.tabId, {
        url: details.url,
        mimeType: type,
        title: "Detected media stream",
        kind: /mpegurl|dash\+xml/.test(type) ? "media" : "file",
      });
  },
  { urls: ["http://*/*", "https://*/*"] },
  ["responseHeaders"],
);
api.runtime.onInstalled.addListener(() => {
  Promise.resolve(api.contextMenus.removeAll()).then(() => {
    api.contextMenus.create({
      id: "getanny-link",
      title: "Download with GetANNY",
      contexts: ["link", "video", "audio"],
    });
    api.contextMenus.create({
      id: "getanny-page",
      title: "Analyze media in GetANNY",
      contexts: ["page"],
    });
  });
});
api.contextMenus.onClicked.addListener((info, tab) => {
  const media = info.menuItemId === "getanny-page";
  const url = media ? tab.url : info.linkUrl || info.srcUrl;
  if (validUrl(url))
    request({ type: "download", url, kind: media ? "media" : "file" }).catch(
      (error) => update({ error: error.message }),
    );
});
interceptor = new globalThis.GetANNYDownloadInterceptor({
  api,
  request,
  onError: (error) => update({ error: error.message }),
});
interceptor.start();
connect().catch((error) => update({ error: error.message }));
