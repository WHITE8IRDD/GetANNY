const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const { WebSocketServer } = require("./WebSocketServer");
test("unauthenticated WebSocket ping is not proof of an extension connection", async (t) => {
  const bridge = new WebSocketServer({ port: 0, token: "a".repeat(64) });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const client = new WebSocket(`ws://127.0.0.1:${bridge.status().port}`);
  await new Promise((resolve, reject) => {
    client.once("open", resolve);
    client.once("error", reject);
  });
  t.after(async () => {
    client.terminate();
    await bridge.close();
  });
  const reply = new Promise((resolve) =>
    client.once("message", (raw) => resolve(JSON.parse(raw))),
  );
  client.send(JSON.stringify({ type: "ping" }));
  assert.equal((await reply).authenticated, false);
  assert.equal(bridge.status().clients, 0);
});

async function openClient(bridge, origin) {
  const client = new WebSocket(
    `ws://127.0.0.1:${bridge.status().port}`,
    origin ? { origin } : {},
  );
  await new Promise((resolve, reject) => {
    client.once("open", resolve);
    client.once("error", reject);
  });
  return client;
}
function exchange(client, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Bridge timeout")), 3000);
    client.once("message", (raw) => {
      clearTimeout(timer);
      resolve(JSON.parse(raw));
    });
    client.send(JSON.stringify(payload));
  });
}

test("non-loopback Host headers are refused before the WebSocket handshake", async (t) => {
  const bridge = new WebSocketServer({ port: 0, token: "a".repeat(64) });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  t.after(() => bridge.close());
  const client = new WebSocket(`ws://127.0.0.1:${bridge.status().port}`, {
    headers: { Host: "attacker.example" },
  });
  const error = await new Promise((resolve) => client.once("error", resolve));
  assert.match(error.message, /401/);
  client.terminate();
});

test("native bootstrap provisions a browser-specific direct credential", async (t) => {
  const edgeToken = "e".repeat(64);
  const bridge = new WebSocketServer({
    port: 0,
    nativeToken: "c".repeat(64),
    recoveryToken: "d".repeat(64),
    clientTokens: { edge: edgeToken },
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const client = await openClient(bridge);
  t.after(async () => {
    client.terminate();
    await bridge.close();
  });
  assert.equal(
    (
      await exchange(client, {
        type: "authenticate",
        token: "c".repeat(64),
        transport: "native",
      })
    ).protocol,
    2,
  );
  const hello = await exchange(client, {
    type: "hello",
    browserId: "edge",
    extensionId: require("./catalog").CHROMIUM_ID,
    version: "test",
  });
  assert.equal(hello.success, true);
  assert.equal(hello.transport, "native");
  assert.equal(hello.pairingToken, edgeToken);
});

test("provisioned direct credentials are bound to one browser and unsafe request headers are rejected", async (t) => {
  let downloads = 0;
  const bridge = new WebSocketServer({
    port: 0,
    nativeToken: "c".repeat(64),
    recoveryToken: "d".repeat(64),
    clientTokens: { brave: "b".repeat(64) },
    onDownloadRequest: async () => {
      downloads++;
      return { action: "queued" };
    },
  });
  await new Promise((resolve, reject) => {
    bridge.server.once("listening", resolve);
    bridge.server.once("error", reject);
  });
  const { CHROMIUM_ID } = require("./catalog");
  const client = await openClient(bridge, `chrome-extension://${CHROMIUM_ID}`);
  t.after(async () => {
    client.terminate();
    await bridge.close();
  });
  assert.equal(
    (
      await exchange(client, {
        type: "authenticate",
        token: "b".repeat(64),
        transport: "websocket",
      })
    ).success,
    true,
  );
  const wrong = await exchange(client, {
    type: "hello",
    browserId: "chrome",
    extensionId: CHROMIUM_ID,
  });
  assert.equal(wrong.success, false);
  assert.match(wrong.error, /different browser/i);
  assert.equal(
    (
      await exchange(client, {
        type: "hello",
        browserId: "brave",
        extensionId: CHROMIUM_ID,
      })
    ).success,
    true,
  );
  const rejected = await exchange(client, {
    type: "download",
    requestId: "unsafe",
    url: "https://example.test/file",
    headers: { Host: "attacker.test" },
  });
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /Host header cannot be supplied/i);
  assert.equal(downloads, 0);
});

test("a provisioned browser credential reconnects and hands off after the desktop bridge restarts", async () => {
  const token = "f".repeat(64);
  const { CHROMIUM_ID } = require("./catalog");
  const options = {
    port: 0,
    clientTokens: { chrome: token },
  };
  let bridge = new WebSocketServer(options);
  const waitForListening = (server) =>
    new Promise((resolve, reject) => {
      server.server.once("listening", resolve);
      server.server.once("error", reject);
    });
  const establish = async (server) => {
    const client = await openClient(
      server,
      `chrome-extension://${CHROMIUM_ID}`,
    );
    assert.equal(
      (
        await exchange(client, {
          type: "authenticate",
          token,
          transport: "websocket",
          protocol: 2,
        })
      ).success,
      true,
    );
    assert.equal(
      (
        await exchange(client, {
          type: "hello",
          browserId: "chrome",
          extensionId: CHROMIUM_ID,
          version: "test",
          protocol: 2,
        })
      ).connected,
      true,
    );
    return client;
  };

  await waitForListening(bridge);
  const port = bridge.status().port;
  const first = await establish(bridge);
  first.terminate();
  await bridge.close();

  let handedOff = null;
  bridge = new WebSocketServer({
    ...options,
    port,
    onDownloadRequest: async (request) => {
      handedOff = request;
      return { action: "queued", id: "after-restart" };
    },
  });
  try {
    await waitForListening(bridge);
    const second = await establish(bridge);
    const result = await exchange(second, {
      type: "download",
      requestId: "restart-request",
      url: "https://example.test/after-restart.bin",
    });
    assert.equal(result.success, true);
    assert.equal(result.id, "after-restart");
    assert.equal(handedOff.source, "chrome");
    assert.equal(bridge.status().sessions[0].credential, "provisioned");
    second.terminate();
  } finally {
    await bridge.close();
  }
});
