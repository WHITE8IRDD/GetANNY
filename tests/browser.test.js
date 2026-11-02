const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const WebSocket = require("ws");
const {
  BrowserDetector,
} = require("../src/main/browser-integration/BrowserDetector");
const {
  ExtensionInstaller,
} = require("../src/main/browser-integration/ExtensionInstaller");
const {
  NativeMessagingHost,
} = require("../src/main/browser-integration/NativeMessagingHost");
const {
  WebSocketServer,
} = require("../src/main/browser-integration/WebSocketServer");
const { CHROMIUM_ID } = require("../src/main/browser-integration/catalog");
const { createServices } = require("../src/main/services");
const { temporary, waitFor, fixtureServer, checksum } = require("./helpers");
async function connect(t, bridge, origin) {
  const client = new WebSocket(
    `ws://127.0.0.1:${bridge.status().port}`,
    origin ? { origin } : {},
  );
  await new Promise((r, j) => {
    client.once("open", r);
    client.once("error", j);
  });
  t.after(() => client.terminate());
  return client;
}
function message(client, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("No bridge response")),
      5000,
    );
    client.once("message", (raw) => {
      clearTimeout(timeout);
      resolve(JSON.parse(raw));
    });
    client.send(JSON.stringify(payload));
  });
}
async function bridgeFixture(t, options = {}) {
  const bridge = new WebSocketServer({
    port: 0,
    token: "a".repeat(64),
    ...options,
  });
  await new Promise((r, j) => {
    bridge.server.once("listening", r);
    bridge.server.once("error", j);
  });
  t.after(() => bridge.close());
  return bridge;
}
test("browser detection covers all seven targets plus Edge using executables, not profile files", async () => {
  const detector = new BrowserDetector({
    platform: "win32",
    env: {
      LOCALAPPDATA: "C:/Users/Test/AppData/Local",
      PROGRAMFILES: "C:/Program Files",
      "PROGRAMFILES(X86)": "C:/Program Files (x86)",
    },
    exists: async (file) =>
      file.includes("imput") && file.endsWith("chrome.exe"),
    // Keep this filesystem simulation deterministic on machines with Chrome.
    appPathLookup: async () => {
      throw new Error("not registered in the simulation");
    },
  });
  const found = await detector.detect();
  assert.equal(found.length, 8);
  assert.equal(found.find((b) => b.id === "helium").installed, true);
  assert.equal(found.find((b) => b.id === "chrome").installed, false);
  assert.ok(found.some((b) => b.id === "chromium"));
});
test("preparing extension packages never claims browser installation or activation", async (t) => {
  const dir = await temporary(t);
  const installer = new ExtensionInstaller({
    extensionPath: path.resolve("dist-extension"),
    userDataPath: dir,
  });
  for (const browser of [
    "helium",
    "chrome",
    "chromium",
    "brave",
    "firefox",
    "vivaldi",
    "opera",
  ]) {
    const result = await installer.install(browser);
    assert.equal(result.prepared, true);
    assert.equal(result.installed, null);
    assert.equal(result.enabled, null);
    const manifest = JSON.parse(
      await fs.readFile(path.join(result.path, "manifest.json"), "utf8"),
    );
    assert.ok(manifest.permissions.includes("nativeMessaging"));
    assert.equal(manifest.manifest_version, browser === "firefox" ? 2 : 3);
    assert.match(
      await fs.readFile(path.join(result.path, "config.js"), "utf8"),
      new RegExp(browser),
    );
    assert.equal((await installer.check(browser)).installed, null);
  }
});
test("desktop-prepared extensions contain only their browser-specific direct credential while release packages contain no secret", async (t) => {
  const dir = await temporary(t);
  const token = "c".repeat(64);
  const installer = new ExtensionInstaller({
    extensionPath: path.resolve("dist-extension"),
    userDataPath: dir,
    clientTokens: { brave: token },
  });
  const result = await installer.install("brave");
  assert.equal(result.directProvisioned, true);
  const config = await fs.readFile(path.join(result.path, "config.js"), "utf8");
  assert.match(config, /GETANNY_CONFIG/);
  assert.match(config, new RegExp(token));
  assert.equal((await installer.check("brave")).directProvisioned, true);
  const generic = await fs.readFile(
    path.resolve("dist-extension/chromium/config.js"),
    "utf8",
  );
  assert.doesNotMatch(generic, /[a-f0-9]{64}/i);
});

test("bridge requires authentication and an extension handshake before accepting a download", async (t) => {
  let calls = 0;
  const bridge = await bridgeFixture(t, {
    onDownloadRequest: async () => {
      calls++;
      return { id: "real-request", action: "queued" };
    },
  });
  const client = await connect(t, bridge, `chrome-extension://${CHROMIUM_ID}`);
  assert.equal(
    (await message(client, { type: "download", url: "https://test/file" }))
      .success,
    false,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await message(client, {
        type: "authenticate",
        token: "a".repeat(64),
        transport: "websocket",
      })
    ).success,
    true,
  );
  assert.equal(bridge.status().clients, 0);
  assert.equal(
    (
      await message(client, {
        type: "hello",
        browserId: "brave",
        extensionId: CHROMIUM_ID,
        version: "2.0",
      })
    ).connected,
    true,
  );
  assert.equal(bridge.status().clients, 1);
  const result = await message(client, {
    type: "download",
    requestId: "123",
    url: "https://test/file",
  });
  assert.equal(result.id, "real-request");
  assert.equal(result.requestId, "123");
  assert.equal(calls, 1);
  bridge.setEnabled(false);
  assert.equal(bridge.status().enabled, false);
});
test("untrusted website origins are refused before the WebSocket handshake", async (t) => {
  const bridge = await bridgeFixture(t);
  const client = new WebSocket(`ws://127.0.0.1:${bridge.status().port}`, {
    origin: "https://attacker.example",
  });
  const error = await new Promise((resolve) => client.once("error", resolve));
  assert.match(error.message, /401/);
  client.terminate();
});
test("incorrect pairing key cannot be used as a connected status", async (t) => {
  const bridge = await bridgeFixture(t);
  const client = await connect(t, bridge);
  const result = await message(client, {
    type: "authenticate",
    token: "b".repeat(64),
  });
  assert.equal(result.success, false);
  assert.equal(bridge.status().clients, 0);
});
test(
  "REAL framed native process → authenticated WebSocket → persistent manager → file bytes",
  { timeout: 20000 },
  async (t) => {
    const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), "getanny-native-chain-"),
    );
    const fixture = await fixtureServer(t, { size: 256 * 1024 });
    const services = await createServices({
      userDataPath: dir,
      downloadPath: path.join(dir, "downloads"),
      binPath: path.resolve("bin"),
      extensionPath: path.resolve("dist-extension"),
      port: 0,
    });
    t.after(async () => {
      await services.close();
      await fs.rm(dir, { recursive: true, force: true });
    });
    const compiledHost = process.env.GETANNY_NATIVE_LAUNCHER === "1";
    const config = path.join(
      dir,
      compiledHost ? "bridge-config.json" : "native-test-config.json",
    );
    await fs.writeFile(
      config,
      JSON.stringify({
        token: services.identity.nativeToken,
        port: services.wsServer.status().port,
        executable: process.execPath,
        script: path.resolve("src/main/browser-integration/native-host.js"),
      }),
    );
    const launcher = path.join(dir, "GetANNY.NativeHost.exe");
    if (compiledHost)
      await fs.copyFile(path.resolve("bin/GetANNY.NativeHost.exe"), launcher);
    const child = spawn(
      compiledHost ? launcher : process.execPath,
      compiledHost
        ? []
        : [
            path.resolve("src/main/browser-integration/native-host.js"),
            "--config",
            config,
          ],
      { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
    );
    let childStderr = "";
    child.stderr.on("data", (chunk) => {
      childStderr += chunk.toString();
    });
    t.after(() => child.kill());
    const messages = [];
    let input = Buffer.alloc(0);
    child.stdout.on("data", (chunk) => {
      input = Buffer.concat([input, chunk]);
      while (input.length >= 4) {
        const length = input.readUInt32LE(0);
        if (input.length < length + 4) break;
        messages.push(JSON.parse(input.subarray(4, length + 4)));
        input = input.subarray(length + 4);
      }
    });
    function send(payload, fragment = false) {
      const body = Buffer.from(JSON.stringify(payload)),
        head = Buffer.alloc(4);
      head.writeUInt32LE(body.length);
      const frame = Buffer.concat([head, body]);
      if (fragment) {
        child.stdin.write(frame.subarray(0, 2));
        child.stdin.write(frame.subarray(2, 8));
        child.stdin.write(frame.subarray(8));
      } else child.stdin.write(frame);
    }
    send(
      {
        type: "hello",
        requestId: "hello",
        browserId: "chromium",
        extensionId: CHROMIUM_ID,
        version: "2.0.0.1",
      },
      true,
    );
    await waitFor(() => {
      if (child.exitCode !== null)
        throw new Error(`Native host exited ${child.exitCode}: ${childStderr}`);
      return messages.some((m) => m.type === "hello-result" && m.success);
    }).catch((error) => {
      throw new Error(
        `${error.message}\nNative stderr: ${childStderr}; frames: ${JSON.stringify(messages)}`,
      );
    });
    assert.equal(services.wsServer.status().sessions[0].transport, "native");
    send({
      type: "download",
      requestId: "download",
      url: fixture.url + "/file.bin",
    });
    await waitFor(() =>
      messages.some((m) => m.requestId === "download" && m.success),
    );
    const result = messages.find((m) => m.requestId === "download");
    assert.equal(result.action, "queued");
    await waitFor(
      () => services.manager.requireItem(result.id).status === "completed",
    );
    const item = services.downloadsRepo.get(result.id);
    assert.equal(
      checksum(await fs.readFile(item.filePath)),
      checksum(fixture.state.data),
    );
    child.stdin.end();
    await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(child.exitCode, 0);
  },
);
test("file handoffs start automatically while media pages wait for a format choice", async (t) => {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "getanny-browser-review-"),
  );
  const services = await createServices({
    userDataPath: dir,
    downloadPath: path.join(dir, "downloads"),
    binPath: path.resolve("bin"),
    extensionPath: path.resolve("dist-extension"),
    port: 0,
  });
  t.after(async () => {
    await services.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const client = await connect(t, services.wsServer);
  await message(client, {
    type: "authenticate",
    token: services.identity.clientTokens.chrome,
  });
  await message(client, {
    type: "hello",
    browserId: "chrome",
    extensionId: CHROMIUM_ID,
  });
  const file = await message(client, {
    type: "download",
    url: "https://example.test/a",
    kind: "file",
  });
  assert.equal(file.action, "queued");
  assert.equal(file.success, true);
  assert.equal(services.manager.getAll().length, 1);
  // The handoff starts immediately; depending on scheduling it is already
  // connecting by the time the acknowledgement reaches the browser.
  assert.ok(
    ["queued", "connecting", "downloading"].includes(
      services.manager.getAll()[0].status,
    ),
    services.manager.getAll()[0].status,
  );
  assert.equal(
    (
      await message(client, {
        type: "download",
        url: "https://example.test/watch",
        kind: "media",
      })
    ).action,
    "analyze",
  );
  assert.equal(services.pendingBrowserRequests.length, 1);
  await services.settings.set("mediaIntegration", false);
  assert.equal(
    (
      await message(client, {
        type: "download",
        url: "https://example.test/watch",
        kind: "media",
      })
    ).success,
    false,
  );
  services.browserDetector.exists = async () => false;
  services.nativeMessagingHost.register = async (browserId) => ({
    registered: true,
    path: `/test/${browserId}.json`,
    hostPath: "/test/native-host",
  });
  const stages = [];
  const provisioned = await services.setupInstalledBrowsers(async (stage) =>
    stages.push(stage),
  );
  assert.equal(provisioned.length, 8);
  assert.ok(
    provisioned.every(
      (item) =>
        item.browserDetected === false &&
        item.directProvisioned === true &&
        item.registered === true,
    ),
  );
  assert.equal(stages[0], "browser-detect");
  assert.equal(stages[1], "browser-detected");
  assert.equal(stages.at(-1), "write-setup-report");
  assert.equal(stages.filter((stage) => stage === "browser-prepared").length, 8);
});

test("read-only MSI extension resources and older prepared copies remain updateable without changing installed source", async (t) => {
  const folder = await temporary(t),
    source = path.join(folder, "resources");
  await fs.cp(path.resolve("dist-extension"), source, { recursive: true });
  const sourceConfig = path.join(source, "chromium", "config.js");
  await fs.chmod(sourceConfig, 0o444);
  const installer = new ExtensionInstaller({
    extensionPath: source,
    userDataPath: path.join(folder, "user-data"),
  });
  const prepared = await installer.install("brave");
  const destination = path.join(prepared.path, "config.js");
  assert.match(await fs.readFile(destination, "utf8"), /brave/);
  assert.equal(
    (await fs.stat(sourceConfig)).mode & 0o222,
    0,
    "installed read-only source must remain untouched",
  );
  await fs.chmod(destination, 0o444);
  await installer.install("brave");
  await fs.writeFile(destination, "globalThis.GETANNY_BROWSER = 'brave';\n");
  assert.equal((await installer.check("brave")).prepared, true);
  await fs.chmod(sourceConfig, 0o600); // portable test teardown only
});

test("per-user native launcher copies lose MSI read-only flags and can be replaced on update", async (t) => {
  const folder = await temporary(t),
    bin = path.join(folder, "bin");
  await fs.mkdir(bin);
  // Structural fixture only; actual C# execution has its own mandatory CI gate.
  const source = path.join(bin, "GetANNY.NativeHost.exe");
  await fs.writeFile(source, "unit launcher version one");
  await fs.chmod(source, 0o444);
  const host = new NativeMessagingHost({
    platform: "win32",
    userDataPath: path.join(folder, "data"),
    binPath: bin,
    token: "a".repeat(64),
  });
  const launcher = await host.prepareLauncher();
  assert.notEqual((await fs.stat(launcher)).mode & 0o200, 0);
  assert.equal((await fs.stat(source)).mode & 0o222, 0);
  await fs.chmod(launcher, 0o444);
  await fs.chmod(source, 0o600);
  await fs.writeFile(source, "unit launcher version two");
  await fs.chmod(source, 0o444);
  await host.prepareLauncher();
  assert.equal(
    await fs.readFile(launcher, "utf8"),
    "unit launcher version two",
  );
  assert.notEqual((await fs.stat(launcher)).mode & 0o200, 0);
  await fs.chmod(source, 0o600);
});

test("automatic browser handoff foregrounds the application without jeopardizing ownership", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "getanny-handoff-"));
  let shown = 0;
  const services = await createServices({
    userDataPath: dir,
    downloadPath: path.join(dir, "downloads"),
    binPath: path.resolve("bin"),
    extensionPath: path.resolve("dist-extension"),
    port: 0,
    startTransfers: false,
    onBrowserRequest: () => {
      shown++;
      throw new Error("window unavailable");
    },
  });
  t.after(async () => {
    await services.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const client = await connect(t, services.wsServer);
  await message(client, {
    type: "authenticate",
    token: services.identity.clientTokens.chrome,
  });
  await message(client, {
    type: "hello",
    browserId: "chrome",
    extensionId: CHROMIUM_ID,
  });
  const request = {
    type: "download",
    url: "https://example.test/file",
    intercepted: true,
    transferId: "unique-handoff",
  };
  const accepted = await message(client, request);
  assert.equal(accepted.action, "queued");
  assert.equal(accepted.success, true);
  const duplicate = await message(client, request);
  assert.equal(duplicate.id, accepted.id);
  assert.equal(services.manager.getAll().length, 1);
  assert.equal(shown, 1);
});

test("portable builds refuse persistent native host registration and retain WebSocket pairing", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "getanny-portable-"));
  const fixture = await fixtureServer(t, { size: 256 * 1024 });
  const services = await createServices({
    userDataPath: dir,
    downloadPath: path.join(dir, "downloads"),
    binPath: path.resolve("bin"),
    extensionPath: path.resolve("dist-extension"),
    port: 0,
    isPortable: true,
  });
  t.after(async () => {
    await services.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  await assert.rejects(
    services.prepareBrowser("chrome"),
    /portable launcher.*temporary files/i,
  );
  const { checkBrowserPreparation } = require("../src/main/self-test");
  assert.equal((await checkBrowserPreparation(services, true)).length, 8);
  const client = await connect(
    t,
    services.wsServer,
    `chrome-extension://${CHROMIUM_ID}`,
  );
  const auth = await message(client, {
    type: "authenticate",
    token: services.identity.clientTokens.chromium,
    transport: "websocket",
  });
  assert.equal(auth.success, true);
  const hello = await message(client, {
    type: "hello",
    browserId: "chromium",
    extensionId: CHROMIUM_ID,
  });
  assert.equal(hello.connected, true);
  assert.equal(hello.transport, "websocket");
  const response = await message(client, {
    type: "download",
    url: fixture.url + "/portable-bridge.bin",
    filename: "portable-bridge.bin",
  });
  assert.equal(response.action, "queued");
  await waitFor(
    () => services.manager.requireItem(response.id).status === "completed",
  );
  const item = services.downloadsRepo.get(response.id);
  assert.equal(
    checksum(await fs.readFile(item.filePath)),
    checksum(fixture.state.data),
  );
});

test("duplicate intercepted handoffs never create a second download job", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "getanny-auto-handoff-"));
  const services = await createServices({
    userDataPath: dir,
    downloadPath: path.join(dir, "downloads"),
    binPath: path.resolve("bin"),
    extensionPath: path.resolve("dist-extension"),
    port: 0,
    startTransfers: false,
  });
  t.after(async () => {
    await services.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  const client = await connect(t, services.wsServer);
  await message(client, {
    type: "authenticate",
    token: services.identity.clientTokens.chrome,
  });
  await message(client, {
    type: "hello",
    browserId: "chrome",
    extensionId: CHROMIUM_ID,
  });
  const request = {
    type: "download",
    url: "https://example.test/file.zip",
    kind: "file",
    intercepted: true,
    transferId: "same-transfer",
  };
  const first = await message(client, request);
  const second = await message(client, request);
  assert.equal(first.action, "queued");
  assert.equal(second.id, first.id);
  assert.equal(services.manager.getAll().length, 1);
  // Files are never left in the review queue, so returning to the app is not
  // required to make an intercepted download start.
  assert.equal(services.pendingBrowserRequests.length, 0);
  assert.equal(
    services.manager.requireItem(first.id).browserTransferId,
    "same-transfer",
  );
});
