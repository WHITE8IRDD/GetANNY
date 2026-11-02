const fs = require("node:fs/promises");
const path = require("node:path");
const { browsers } = require("./catalog");
const { getBridgeIdentity, validIdentity } = require("./BridgeIdentity");
const { ExtensionInstaller } = require("./ExtensionInstaller");
const { NativeMessagingHost } = require("./NativeMessagingHost");

/**
 * Provision browser integration without starting SQLite, the download engine,
 * Electron windows, or the loopback server. Installer custom actions used to
 * boot the complete application and then skip every browser not found at one
 * of a short list of paths. That made setup vulnerable to port/database locks
 * and allowed an empty result to be reported as success.
 */
async function setupBrowserIntegration({
  userDataPath,
  extensionPath,
  binPath,
  appPath = process.execPath,
  isPackaged = false,
  port = 29615,
  version = null,
  onProgress = async () => {},
  extensionInstaller,
  nativeMessagingHost,
} = {}) {
  const identity = await getBridgeIdentity(userDataPath);
  const installer =
    extensionInstaller ||
    new ExtensionInstaller({
      userDataPath,
      extensionPath,
      clientTokens: identity.clientTokens,
      port,
    });
  const nativeHost =
    nativeMessagingHost ||
    new NativeMessagingHost({
      userDataPath,
      appPath,
      isPackaged,
      binPath,
      token: identity.nativeToken,
      port,
    });
  const results = [];
  await onProgress("provision-start", { browsers: browsers.length });
  for (const browser of browsers) {
    const result = { browserId: browser.id };
    try {
      await onProgress("extension-prepare", { browserId: browser.id });
      Object.assign(result, await installer.install(browser.id));
    } catch (error) {
      result.error = error.message;
      results.push(result);
      await onProgress("browser-error", {
        browserId: browser.id,
        error: error.message,
      });
      continue;
    }
    try {
      await onProgress("native-register", { browserId: browser.id });
      const native = await nativeHost.register(browser.id);
      Object.assign(result, {
        registered: native.registered,
        nativeManifestPath: native.path,
        hostPath: native.hostPath,
      });
    } catch (error) {
      // Direct, authenticated WebSocket is independently usable. Record the
      // native bootstrap problem, but do not misreport the direct package as
      // broken or roll back the desktop installation.
      result.registered = false;
      result.nativeError = error.message;
      await onProgress("native-warning", {
        browserId: browser.id,
        error: error.message,
      });
    }
    results.push(result);
    await onProgress("browser-prepared", { browserId: browser.id });
  }
  const directReady = results.every(
    (result) => result.prepared && result.directProvisioned && !result.error,
  );
  const nativeReady = results.every((result) => result.registered);
  const report = {
    passed: directReady,
    directReady,
    nativeReady,
    version,
    appPath,
    date: new Date().toISOString(),
    results,
  };
  await fs.mkdir(userDataPath, { recursive: true });
  await fs.writeFile(
    path.join(userDataPath, "browser-setup-report.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600 },
  );
  if (directReady)
    await fs.writeFile(
      path.join(userDataPath, "browser-integration-state.json"),
      JSON.stringify(
        {
          version,
          appPath,
          protocol: 2,
          provisionedAt: report.date,
          nativeReady,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  await onProgress("provision-complete", { directReady, nativeReady });
  return report;
}

async function browserIntegrationNeedsRepair({
  userDataPath,
  version,
  appPath,
} = {}) {
  try {
    const state = JSON.parse(
      await fs.readFile(
        path.join(userDataPath, "browser-integration-state.json"),
        "utf8",
      ),
    );
    if (
      state.protocol !== 2 ||
      state.version !== version ||
      path.resolve(state.appPath) !== path.resolve(appPath)
    )
      return true;

    const identity = JSON.parse(
      await fs.readFile(path.join(userDataPath, "browser-bridge.json"), "utf8"),
    );
    if (!validIdentity(identity)) return true;
    for (const { id } of browsers) {
      const config = await fs.readFile(
        path.join(userDataPath, "extensions", id, "config.js"),
        "utf8",
      );
      if (
        !config.includes(JSON.stringify(id)) ||
        !config.includes(JSON.stringify(identity.clientTokens[id]))
      )
        return true;
    }

    // Avoid retrying an optional fallback on every launch when setup already
    // recorded a registry policy failure. If it was healthy, however, missing
    // launcher/config files are stale provisioning and should be repaired.
    if (state.nativeReady) {
      const nativeConfig = JSON.parse(
        await fs.readFile(
          path.join(userDataPath, "native-messaging", "bridge-config.json"),
          "utf8",
        ),
      );
      if (
        nativeConfig.token !== identity.nativeToken ||
        path.resolve(nativeConfig.executable) !== path.resolve(appPath)
      )
        return true;
      await fs.access(
        path.join(
          userDataPath,
          "native-messaging",
          process.platform === "win32"
            ? "GetANNY.NativeHost.exe"
            : "getanny-native-host",
        ),
      );
    }
    return false;
  } catch {
    return true;
  }
}

module.exports = {
  setupBrowserIntegration,
  browserIntegrationNeedsRepair,
};
