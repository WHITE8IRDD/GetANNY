const fs = require("node:fs/promises");
const path = require("node:path");
const { getBrowser } = require("./catalog");
const { validToken } = require("./BridgeIdentity");

// MSI resources can be read-only. Only normalize our per-user prepared copies;
// never change installed resources or the user's browser/profile permissions.
async function makeWritable(folder) {
  for (const entry of await fs
    .readdir(folder, { withFileTypes: true })
    .catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      await fs.chmod(file, 0o700);
      await makeWritable(file);
    } else if (entry.isFile()) await fs.chmod(file, 0o600);
  }
}

function extensionConfig(browserId, pairingToken, port = 29615) {
  getBrowser(browserId);
  if (pairingToken != null && !validToken(pairingToken))
    throw new Error("A valid browser bridge credential is required.");
  const config = {
    version: 2,
    browserId,
    port,
    ...(pairingToken ? { pairingToken } : {}),
  };
  // Keep GETANNY_BROWSER for packages from older releases while exposing one
  // immutable versioned object to the new transport implementation.
  return `globalThis.GETANNY_CONFIG = Object.freeze(${JSON.stringify(config)});\nglobalThis.GETANNY_BROWSER = ${JSON.stringify(browserId)};\n`;
}

class ExtensionInstaller {
  constructor({
    extensionPath,
    userDataPath,
    clientTokens = {},
    port = 29615,
  } = {}) {
    Object.assign(this, {
      extensionPath,
      userDataPath,
      clientTokens,
      port,
    });
  }
  async install(browserId) {
    const browser = getBrowser(browserId);
    const source = path.join(
      this.extensionPath,
      browser.family === "firefox" ? "firefox" : "chromium",
    );
    await fs.access(path.join(source, "manifest.json")).catch(() => {
      throw new Error(
        "Extension resources are missing. Run npm run build-extension or reinstall GetANNY.",
      );
    });
    const target = path.join(this.userDataPath, "extensions", browserId);
    await fs.mkdir(target, { recursive: true });
    // Preserve a stable unpacked extension directory across application updates.
    await makeWritable(target);
    await fs.cp(source, target, { recursive: true, force: true });
    await makeWritable(target);
    const token = this.clientTokens[browserId];
    await fs.writeFile(
      path.join(target, "config.js"),
      extensionConfig(browserId, token, this.port),
      { mode: 0o600 },
    );
    return {
      prepared: true,
      directProvisioned: validToken(token),
      installed: null,
      enabled: null,
      browserId,
      path: target,
      extensionsPage: browser.page,
      instructions:
        browser.family === "firefox"
          ? "For development: open about:debugging, choose This Firefox → Load Temporary Add-on and select manifest.json. This lasts until Firefox restarts. Permanent installation requires a Mozilla-signed XPI. The prepared package connects directly; no native-host registration is required."
          : `Open ${browser.page}, enable Developer mode, choose Load unpacked, and select this folder. Approve the requested permissions. The prepared package connects directly to GetANNY; then open its popup to verify the handshake.`,
    };
  }
  async check(browserId) {
    getBrowser(browserId);
    const folder = path.join(this.userDataPath, "extensions", browserId);
    const prepared = await fs.access(path.join(folder, "manifest.json")).then(
      () => true,
      () => false,
    );
    let directProvisioned = false;
    if (prepared) {
      const config = await fs
        .readFile(path.join(folder, "config.js"), "utf8")
        .catch(() => "");
      const expected = this.clientTokens[browserId];
      directProvisioned =
        validToken(expected) && config.includes(JSON.stringify(expected));
    }
    return {
      prepared,
      directProvisioned,
      installed: null,
      enabled: null,
      path: folder,
    };
  }
}
module.exports = { ExtensionInstaller, extensionConfig, makeWritable };
