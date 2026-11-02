const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  setupBrowserIntegration,
  browserIntegrationNeedsRepair,
} = require("./BrowserIntegrationSetup");
const { browsers } = require("./catalog");

test("standalone setup provisions every browser without executable detection and keeps native fallback failure non-fatal", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "getanny-setup-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const installed = [];
  const registered = [];
  const report = await setupBrowserIntegration({
    userDataPath: dir,
    extensionPath: "/unused",
    binPath: "/unused",
    appPath: "/opt/GetANNY/GetANNY.exe",
    version: "9.9.9",
    extensionInstaller: {
      install: async (browserId) => {
        installed.push(browserId);
        const identity = JSON.parse(
          await fs.readFile(path.join(dir, "browser-bridge.json"), "utf8"),
        );
        const preparedPath = path.join(dir, "extensions", browserId);
        await fs.mkdir(preparedPath, { recursive: true });
        await fs.writeFile(path.join(preparedPath, "manifest.json"), "{}");
        await fs.writeFile(
          path.join(preparedPath, "config.js"),
          `${JSON.stringify(browserId)} ${JSON.stringify(identity.clientTokens[browserId])}`,
        );
        return {
          browserId,
          prepared: true,
          directProvisioned: true,
          path: preparedPath,
        };
      },
    },
    nativeMessagingHost: {
      register: async (browserId) => {
        registered.push(browserId);
        if (browserId === "vivaldi")
          throw new Error("simulated registry block");
        return {
          registered: true,
          path: `/manifest/${browserId}`,
          hostPath: "/native/host.exe",
        };
      },
    },
  });
  const ids = browsers.map(({ id }) => id);
  assert.deepEqual(installed, ids);
  assert.deepEqual(registered, ids);
  assert.equal(report.directReady, true);
  assert.equal(report.nativeReady, false);
  assert.equal(report.passed, true);
  assert.match(
    report.results.find(({ browserId }) => browserId === "vivaldi").nativeError,
    /registry block/,
  );
  assert.equal(
    await browserIntegrationNeedsRepair({
      userDataPath: dir,
      version: "9.9.9",
      appPath: "/opt/GetANNY/GetANNY.exe",
    }),
    false,
  );
  assert.equal(
    await browserIntegrationNeedsRepair({
      userDataPath: dir,
      version: "10.0.0",
      appPath: "/opt/GetANNY/GetANNY.exe",
    }),
    true,
  );
  assert.equal(
    await browserIntegrationNeedsRepair({
      userDataPath: dir,
      version: "9.9.9",
      appPath: "/opt/GetANNY-moved/GetANNY.exe",
    }),
    true,
  );
  await fs.rm(path.join(dir, "extensions", "brave", "config.js"));
  assert.equal(
    await browserIntegrationNeedsRepair({
      userDataPath: dir,
      version: "9.9.9",
      appPath: "/opt/GetANNY/GetANNY.exe",
    }),
    true,
  );
});
