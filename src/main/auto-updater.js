function compareVersions(candidate, current) {
  const parse = (value) => {
    const match =
      /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
        String(value || "").trim(),
      );
    return match
      ? {
          numbers: match.slice(1, 4).map(Number),
          prerelease: match[4] ? match[4].split(".") : null,
        }
      : null;
  };
  const next = parse(candidate);
  const installed = parse(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index++) {
    if (next.numbers[index] !== installed.numbers[index])
      return next.numbers[index] > installed.numbers[index];
  }
  if (!next.prerelease) return !!installed.prerelease;
  if (!installed.prerelease) return false;
  for (
    let index = 0;
    index < Math.max(next.prerelease.length, installed.prerelease.length);
    index++
  ) {
    const left = next.prerelease[index];
    const right = installed.prerelease[index];
    if (left === undefined) return false;
    if (right === undefined) return true;
    if (left === right) continue;
    const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNumber !== null && rightNumber !== null)
      return leftNumber > rightNumber;
    if (leftNumber !== null) return false;
    if (rightNumber !== null) return true;
    return left.localeCompare(right) > 0;
  }
  return false;
}

function configureAutoUpdater({
  mainWindow = () => null,
  currentVersion,
  fetchAsset = globalThis.fetch,
  logger = console,
  updater,
} = {}) {
  updater ||= require("electron-updater").autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  let state = { status: "idle" };
  let availabilityPromise = Promise.resolve();
  const publish = (next) => {
    state = next;
    mainWindow()?.webContents?.send("update:status", next);
  };
  updater.on("checking-for-update", () => publish({ status: "checking" }));
  updater.on("update-available", (info) => {
    availabilityPromise = (async () => {
      if (!compareVersions(info?.version, currentVersion)) {
        publish({ status: "current" });
        return;
      }
      const asset = info?.files?.find((file) => typeof file?.url === "string");
      if (
        !asset ||
        !/getanny.*\.exe$/i.test(asset.url) ||
        typeof fetchAsset !== "function"
      ) {
        publish({ status: "unavailable" });
        return;
      }
      try {
        const version = String(info.version).replace(/^v/, "");
        const url = new URL(
          asset.url,
          `https://github.com/p4yy/GetANNY/releases/download/v${version}/`,
        );
        if (url.origin !== "https://github.com") {
          publish({ status: "unavailable" });
          return;
        }
        const response = await fetchAsset(url, { method: "HEAD" });
        if (!response?.ok) {
          publish({ status: "unavailable" });
          return;
        }
        publish({ status: "available", version: info.version });
      } catch (error) {
        logger.warn(
          "Update asset verification failed:",
          error?.message || error,
        );
        publish({ status: "unavailable" });
      }
    })();
  });
  updater.on("update-not-available", () => publish({ status: "current" }));
  updater.on("download-progress", (progress) =>
    publish({ status: "downloading", percent: Math.round(progress.percent) }),
  );
  updater.on("update-downloaded", (info) =>
    publish({ status: "downloaded", version: info.version }),
  );
  updater.on("error", (error) => {
    logger.warn("Update check unavailable:", error?.message || error);
    publish({ status: "unavailable" });
  });
  let checking = false;
  return {
    getState: () => state,
    check: async () => {
      if (checking) return state;
      checking = true;
      publish({ status: "checking" });
      try {
        const result = await updater.checkForUpdates();
        const info = result?.updateInfo;
        if (
          result?.isUpdateAvailable ||
          (info && compareVersions(info.version, currentVersion))
        )
          await availabilityPromise;
        if (info && !compareVersions(info.version, currentVersion)) {
          publish({ status: "current" });
          return state;
        }
        if (result?.isUpdateAvailable === false) publish({ status: "current" });
        return state;
      } catch (error) {
        logger.warn("Update check unavailable:", error?.message || error);
        publish({ status: "unavailable" });
        return state;
      } finally {
        checking = false;
      }
    },
    download: () => updater.downloadUpdate(),
    install: () => updater.quitAndInstall(),
  };
}
module.exports = { compareVersions, configureAutoUpdater };
