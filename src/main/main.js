const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  Menu,
  Notification,
  nativeImage,
  clipboard,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { setupIpcHandlers } = require("./ipc-handlers");
const { createTray } = require("./tray");
const {
  shouldKeepBackgroundProcess,
  shouldReleaseTrayWindow,
  shouldRevealOnActivation,
} = require("./tray-window");
const { createMenu } = require("./menu");
const { Logger } = require("./utils/logger");
const { configureAutoUpdater } = require("./auto-updater");
const { validateUrl } = require("./engine/utils");
const {
  clearDesktopExitMarker,
  desktopExitMarkerPath,
  isDesktopExitMarked,
  markDesktopExited,
} = require("./browser-integration/DesktopExitMarker");
const log = new Logger("Main");
const traySelfTest = process.argv.includes("--tray-self-test");
let win,
  services,
  tray,
  windowCreating,
  exiting = false,
  hiddenToTray = false,
  shutdownFinished = false;
if (process.platform === "win32") app.setAppUserModelId("com.getanny.app");
const selfTest = process.argv.includes("--self-test");
if (selfTest) app.disableHardwareAcceleration();
const setupOnly = process.argv.includes("--setup-browser-hosts");
const unregisterOnly = process.argv.includes("--unregister-browser-hosts");
const testDataIndex = process.argv.indexOf("--test-user-data");
if (testDataIndex >= 0 && process.argv[testDataIndex + 1])
  app.setPath("userData", path.resolve(process.argv[testDataIndex + 1]));
function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}
function showWindow() {
  hiddenToTray = false;
  if (!win || win.isDestroyed()) {
    if (services && !windowCreating) {
      windowCreating = createWindow({ forceShow: true })
        .catch((error) => log.error("Window activation:", error))
        .finally(() => {
          windowCreating = null;
        });
    }
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win || win.isDestroyed() || !win.isVisible()) {
    showWindow();
    return;
  }
  win.hide();
  if (shouldReleaseTrayWindow(services.settings.get("clipboardMonitoring")))
    win.destroy();
}

async function createWindow({ forceShow = false } = {}) {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: process.platform === "darwin",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    title: "GetANNY",
    icon: path.resolve(__dirname, "../../assets/icon.png"),
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      shell.openExternal(validateUrl(url));
    } catch (error) {
      log.warn(error.message);
    }
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      try {
        shell.openExternal(validateUrl(url));
      } catch {
        /* unsupported navigation */
      }
    }
  });
  win.webContents.on("before-input-event", (event, input) => {
    if ((input.control || input.meta) && input.type === "keyDown") {
      if (input.key.toLowerCase() === "n") {
        event.preventDefault();
        send("menu:add-download");
      }
      if (input.key === ",") {
        event.preventDefault();
        send("menu:settings");
      }
    }
  });
  win.on("maximize", () => send("window:state", { maximized: true }));
  win.on("unmaximize", () => send("window:state", { maximized: false }));
  win.on("hide", () => {
    hiddenToTray = true;
  });
  win.on("show", () => {
    hiddenToTray = false;
  });
  win.on("close", (event) => {
    if (
      !exiting &&
      services.settings.get("closeToTray") &&
      tray &&
      (!selfTest || traySelfTest)
    ) {
      event.preventDefault();
      hiddenToTray = true;
      win.hide();
      if (shouldReleaseTrayWindow(services.settings.get("clipboardMonitoring")))
        win.destroy();
    }
  });
  win.on("closed", () => {
    win = null;
  });
  if (app.isPackaged || selfTest)
    await win.loadFile(
      path.resolve(__dirname, "../../dist-renderer/index.html"),
    );
  else await win.loadURL("http://127.0.0.1:5173");
  if (
    forceShow ||
    !services.settings.get("startMinimized") ||
    selfTest ||
    process.argv.includes("--from-browser")
  )
    win.show();
  else if (tray) win.hide();
  else {
    win.show();
    win.minimize();
  }
}
async function recordOperationStage(stage, detail = {}) {
  if (!setupOnly && !unregisterOnly) return;
  const index = process.argv.indexOf("--report");
  const report = index >= 0 ? process.argv[index + 1] : null;
  if (!report) return;
  const file = path.resolve(report);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify(
      {
        passed: stage === "complete",
        operation: setupOnly ? "setup" : "unregister",
        stage,
        date: new Date().toISOString(),
        ...detail,
      },
      null,
      2,
    ),
  );
}
async function init() {
  await recordOperationStage("init");
  const userDataPath = app.getPath("userData");
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.resolve(__dirname, "../../bin");
  const extensionPath = app.isPackaged
    ? path.join(process.resourcesPath, "extension")
    : path.resolve(__dirname, "../../dist-extension");

  // Installer helpers deliberately avoid the normal service graph. They must
  // still work while GetANNY already owns its SQLite database or bridge port.
  if (unregisterOnly) {
    const {
      NativeMessagingHost,
    } = require("./browser-integration/NativeMessagingHost");
    const nativeMessagingHost = new NativeMessagingHost({
      userDataPath,
      appPath: process.execPath,
      isPackaged: app.isPackaged,
      binPath,
    });
    const result = await nativeMessagingHost.unregisterAll();
    await recordOperationStage("hosts-unregistered");
    await fs.rm(path.join(userDataPath, "extensions"), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 150,
    });
    await fs.rm(path.join(userDataPath, "browser-integration-state.json"), {
      force: true,
    });
    if (["win32", "darwin"].includes(process.platform))
      app.setLoginItemSettings({ openAtLogin: false });
    await fs.writeFile(
      path.join(userDataPath, "browser-uninstall-report.json"),
      JSON.stringify(
        {
          passed: result.removed,
          date: new Date().toISOString(),
          nativeFilesRemoved: result.removed,
          extensionFilesRemoved: true,
          errors: result.errors,
        },
        null,
        2,
      ),
    );
    await recordOperationStage("complete", { succeeded: result.removed });
    app.exit(result.removed ? 0 : 1);
    return;
  }
  if (setupOnly) {
    const {
      setupBrowserIntegration,
    } = require("./browser-integration/BrowserIntegrationSetup");
    const report = await setupBrowserIntegration({
      userDataPath,
      extensionPath,
      binPath,
      appPath: process.execPath,
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      onProgress: recordOperationStage,
    });
    await recordOperationStage("browsers-prepared", {
      browsers: report.results.length,
      directReady: report.directReady,
      nativeReady: report.nativeReady,
    });
    await recordOperationStage("complete", {
      succeeded: report.directReady,
      nativeReady: report.nativeReady,
    });
    app.exit(report.directReady ? 0 : 1);
    return;
  }

  // Repair stale installer output on the first normal launch after an update
  // or install-path change. This never installs/enables an extension or edits a
  // browser profile; it refreshes only GetANNY-owned files and HKCU host keys.
  if (
    app.isPackaged &&
    !selfTest &&
    testDataIndex < 0 &&
    !process.env.PORTABLE_EXECUTABLE_FILE
  ) {
    const {
      setupBrowserIntegration,
      browserIntegrationNeedsRepair,
    } = require("./browser-integration/BrowserIntegrationSetup");
    if (
      await browserIntegrationNeedsRepair({
        userDataPath,
        version: app.getVersion(),
        appPath: process.execPath,
      })
    )
      await setupBrowserIntegration({
        userDataPath,
        extensionPath,
        binPath,
        appPath: process.execPath,
        isPackaged: true,
        version: app.getVersion(),
      }).catch((error) =>
        log.warn("Browser integration auto-repair:", error.message),
      );
  }

  const { createServices } = require("./services");
  services = await createServices({
    userDataPath,
    downloadPath: app.getPath("downloads"),
    binPath,
    extensionPath,
    appPath: process.execPath,
    isPackaged: app.isPackaged,
    nativeImage,
    port: selfTest ? 0 : 29615,
    startTransfers: true,
    onSettingChange: async (key, value) => {
      if (key === "launchAtLogin") {
        if (!["win32", "darwin"].includes(process.platform) && value)
          throw new Error("Launch at login is supported on Windows and macOS.");
        if (["win32", "darwin"].includes(process.platform))
          app.setLoginItemSettings({
            openAtLogin: value,
            path: process.execPath,
          });
      }
    },
    onBrowserRequest: () => showWindow(),
  });
  if (
    !selfTest &&
    testDataIndex < 0 &&
    ["win32", "darwin"].includes(process.platform)
  )
    app.setLoginItemSettings({
      openAtLogin: services.settings.get("launchAtLogin"),
      path: process.execPath,
    });
  services.events.on("event", send);
  services.events.on("event", (channel, data) => {
    if (
      channel === "download:complete" &&
      services.settings.get("notifications") &&
      Notification.isSupported() &&
      !selfTest
    ) {
      const item = services.manager.requireItem(data.id);
      const notification = new Notification({
        title: "Download complete",
        body: item.filename,
        icon: path.resolve(__dirname, "../../assets/icon.png"),
      });
      notification.on("click", showWindow);
      notification.show();
    }
  });
  let updater = null;
  if (
    app.isPackaged &&
    process.platform === "win32" &&
    (await fs
      .access(path.join(process.resourcesPath, "getanny-github-updates"))
      .then(() => true)
      .catch(() => false))
  ) {
    updater = configureAutoUpdater({
      mainWindow: () => win,
      logger: log,
    });
  }
  setupIpcHandlers({
    ipcMain,
    services,
    desktop: { app, shell, dialog, clipboard, mainWindow: () => win, updater },
  });
  if (process.platform === "darwin") createMenu({ mainWindow: () => win });
  else Menu.setApplicationMenu(null);
  if (!selfTest || traySelfTest) {
    try {
      tray = createTray({
        mainWindow: () => win,
        app,
        iconPath: path.resolve(__dirname, "../../assets/tray-icon.png"),
        onShow: showWindow,
        onToggle: toggleWindow,
      });
    } catch (error) {
      log.warn("System tray unavailable:", error.message);
    }
  }
  if (
    services.settings.get("startMinimized") &&
    tray &&
    !process.argv.includes("--from-browser") &&
    !selfTest
  )
    hiddenToTray = true;
  else await createWindow();
  if (updater)
    setTimeout(
      () =>
        updater
          .check()
          .catch((error) => log.warn("Update check:", error.message)),
      5000,
    );
  if (selfTest) {
    const reportIndex = process.argv.indexOf("--report");
    const report = process.argv[reportIndex + 1];
    try {
      const result = await require("./self-test").runSelfTest({
        services,
        win,
        app,
        binPath,
        userDataPath,
      });
      if (traySelfTest) {
        const delay = (milliseconds) =>
          new Promise((resolve) => setTimeout(resolve, milliseconds));
        await services.settings.set("closeToTray", true);
        const closedAt = Date.now();
        win.close();
        const closeDeadline = Date.now() + 5000;
        while (win && Date.now() < closeDeadline) await delay(25);
        if (win) throw new Error("Window did not release to the tray.");
        if (!tray || !services.wsServer.status().running || services.closing)
          throw new Error("Tray services did not remain available.");
        const released = app.getAppMetrics();
        if (released.some((metric) => metric.type === "Tab"))
          throw new Error("Renderer process remained after the tray close.");
        const beforeIdle = process.cpuUsage();
        await delay(10000);
        const cpu = process.cpuUsage(beforeIdle);
        const metrics = app.getAppMetrics().map((metric) => ({
          type: metric.type,
          pid: metric.pid,
          workingSetBytes: metric.memory?.workingSetSize ?? null,
          privateBytes: metric.memory?.privateBytes ?? null,
          cpuPercent: metric.cpu?.percentCPUUsage ?? null,
        }));
        const workingSetBytes = metrics.reduce(
          (sum, metric) => sum + (metric.workingSetBytes || 0),
          0,
        );
        const bridge = services.wsServer.status();
        const WebSocket = require("ws");
        const client = new WebSocket(`ws://127.0.0.1:${bridge.port}`);
        const receive = (type) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Timed out waiting for ${type}.`)),
              5000,
            );
            const listener = (raw) => {
              const message = JSON.parse(raw.toString());
              if (message.type !== type) return;
              clearTimeout(timer);
              client.off("message", listener);
              resolve(message);
            };
            client.on("message", listener);
          });
        await new Promise((resolve, reject) => {
          client.once("open", resolve);
          client.once("error", reject);
        });
        const authenticated = receive("authenticated");
        client.send(
          JSON.stringify({
            type: "authenticate",
            token: services.identity.nativeToken,
            transport: "native",
          }),
        );
        await authenticated;
        const hello = receive("hello-result");
        client.send(
          JSON.stringify({
            type: "hello",
            browserId: "chromium",
            extensionId: require("./browser-integration/catalog").CHROMIUM_ID,
            version: "tray-self-test",
          }),
        );
        await hello;
        const requestId = `tray-self-test-${Date.now()}`;
        const wakeStarted = Date.now();
        const wake = receive("download-result");
        client.send(
          JSON.stringify({
            type: "download",
            requestId,
            kind: "media",
            url: "https://example.invalid/tray-self-test",
            transferId: requestId,
          }),
        );
        const wakeResult = await wake;
        const wakeDeadline = Date.now() + 10000;
        while (
          (!win || win.isDestroyed() || !win.isVisible()) &&
          Date.now() < wakeDeadline
        )
          await delay(25);
        client.close();
        if (!win || win.isDestroyed() || !win.isVisible())
          throw new Error("Browser request did not restore the app window.");
        if (wakeResult.action !== "analyze")
          throw new Error("Browser bridge did not accept the wake request.");
        await services.ackBrowserRequest(wakeResult.pendingId);
        result.trayLifecycle = {
          passed: true,
          closeToTrayMs: Date.now() - closedAt,
          browserWakeMs: Date.now() - wakeStarted,
          idleCpuMicrosOver10Seconds: cpu.user + cpu.system,
          idleMetrics: metrics,
          reportedWorkingSetMB:
            Math.round((workingSetBytes / (1024 * 1024)) * 100) / 100,
          rendererReleased: true,
          bridgeStayedAvailable: true,
          browserRequestWokeWindow: true,
          gpuUtilization: "Electron does not expose GPU utilization counters",
        };
        result.trayLifecycle.under50MB =
          result.trayLifecycle.reportedWorkingSetMB <= 50;
      }
      await fs.mkdir(path.dirname(path.resolve(report)), { recursive: true });
      await fs.writeFile(report, JSON.stringify(result, null, 2));
      await services.close();
      shutdownFinished = true;
      app.exit(result.passed ? 0 : 1);
    } catch (error) {
      await fs.writeFile(
        report,
        JSON.stringify({ passed: false, error: error.stack }),
      );
      await services.close();
      shutdownFinished = true;
      app.exit(1);
    }
  }
  log.info("Ready", {
    version: app.getVersion(),
    bridge: services.wsServer.status(),
  });
}
if (
  !setupOnly &&
  !unregisterOnly &&
  !selfTest &&
  !app.requestSingleInstanceLock()
)
  app.quit();
else {
  app.on("second-instance", showWindow);
  app
    .whenReady()
    .then(async () => {
      const markerPath = desktopExitMarkerPath(app.getPath("userData"));
      const fromBrowser = process.argv.includes("--from-browser");
      if (fromBrowser && isDesktopExitMarked(markerPath)) {
        log.info(
          "Browser launch ignored because GetANNY was explicitly closed.",
        );
        app.exit(0);
        return;
      }
      if (!fromBrowser && !setupOnly && !unregisterOnly && !selfTest)
        clearDesktopExitMarker(markerPath);
      await init();
    })
    .catch(async (error) => {
      log.error(error);
      await recordOperationStage("error", { error: error.message }).catch(
        () => {},
      );
      if (unregisterOnly)
        await fs
          .writeFile(
            path.join(app.getPath("userData"), "browser-uninstall-report.json"),
            JSON.stringify(
              {
                passed: false,
                date: new Date().toISOString(),
                error: error.message,
              },
              null,
              2,
            ),
          )
          .catch(() => {});
      if (!setupOnly && !unregisterOnly && !selfTest)
        dialog.showErrorBox("GetANNY could not start", error.message);
      app.exit(1);
    });
  app.on("before-quit", (event) => {
    exiting = true;
    if (shutdownFinished || !services) return;
    event.preventDefault();
    if (services.closing) return;
    services.closing = true;
    if (!selfTest && !setupOnly && !unregisterOnly)
      markDesktopExited(desktopExitMarkerPath(app.getPath("userData")));
    services
      .close()
      .catch((error) => log.error("Shutdown:", error))
      .finally(() => {
        shutdownFinished = true;
        tray?.destroy();
        app.exit(0);
      });
  });
  app.on("window-all-closed", () => {
    if (shouldKeepBackgroundProcess(hiddenToTray, !!tray)) return;
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!shouldRevealOnActivation(hiddenToTray)) return;
    if (win) showWindow();
    else if (services) createWindow().catch((error) => log.error(error));
  });
}
process.on("uncaughtException", (error) => log.error(error));
process.on("unhandledRejection", (error) => log.error(error));
