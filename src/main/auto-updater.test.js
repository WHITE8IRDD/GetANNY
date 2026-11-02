const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { compareVersions, configureAutoUpdater } = require("./auto-updater");

test("update version comparison rejects equal, older and malformed versions", () => {
  assert.equal(compareVersions("2.3.0", "2.3.0"), false);
  assert.equal(compareVersions("2.2.9", "2.3.0"), false);
  assert.equal(compareVersions("2.3.1", "2.3.0"), true);
  assert.equal(compareVersions("2.4.0-beta.1", "2.4.0-beta.2"), false);
  assert.equal(compareVersions("2.4.0", "2.4.0-beta.2"), true);
  assert.equal(compareVersions("not-a-version", "2.3.0"), false);
});

function fixture(t, { result, response = { ok: true }, failure } = {}) {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    if (failure) throw failure;
    if (result?.isUpdateAvailable)
      updater.emit("update-available", result.updateInfo);
    else updater.emit("update-not-available", result?.updateInfo);
    return result;
  };
  updater.downloadUpdate = async () => true;
  updater.quitAndInstall = () => true;
  const published = [];
  const client = configureAutoUpdater({
    updater,
    currentVersion: "2.3.0",
    mainWindow: () => ({
      webContents: { send: (_channel, state) => published.push(state) },
    }),
    fetchAsset: async (url, options) => {
      assert.equal(options.method, "HEAD");
      assert.match(
        String(url),
        /\/releases\/download\/v2\.3\.1\/GetANNY-Setup\.exe$/,
      );
      return response;
    },
    logger: { warn() {}, error() {} },
  });
  t.after(() => updater.removeAllListeners());
  return { client, published };
}

test("only a newer release with an available installer asset is announced", async (t) => {
  const { client, published } = fixture(t, {
    result: {
      isUpdateAvailable: true,
      updateInfo: {
        version: "2.3.1",
        files: [{ url: "GetANNY-Setup.exe" }],
      },
    },
  });
  assert.deepEqual(await client.check(), {
    status: "available",
    version: "2.3.1",
  });
  assert.equal(published.at(-1).status, "available");
});

test("missing installer assets and failed checks never report an available update", async (t) => {
  const missing = fixture(t, {
    result: {
      isUpdateAvailable: true,
      updateInfo: {
        version: "2.3.1",
        files: [{ url: "GetANNY-Setup.exe" }],
      },
    },
    response: { ok: false },
  });
  assert.deepEqual(await missing.client.check(), { status: "unavailable" });

  const failed = fixture(t, { failure: new Error("GitHub returned 404") });
  assert.deepEqual(await failed.client.check(), { status: "unavailable" });
});

test("an equal version is reported as current without probing an installer", async (t) => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    updater.emit("update-not-available", { version: "2.3.0" });
    return { isUpdateAvailable: false, updateInfo: { version: "2.3.0" } };
  };
  updater.downloadUpdate = async () => true;
  updater.quitAndInstall = () => true;
  const client = configureAutoUpdater({
    updater,
    currentVersion: "2.3.0",
    fetchAsset: async () =>
      assert.fail("same-version update must not probe an asset"),
    logger: { warn() {} },
  });
  t.after(() => updater.removeAllListeners());
  assert.deepEqual(await client.check(), { status: "current" });
});
