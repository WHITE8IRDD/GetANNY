const fs = require("node:fs/promises");
const path = require("node:path");
const { validateUrl } = require("./engine/utils");

function createHandlers({ services: s, desktop }) {
  const { manager, settings, mediaDetector } = s;
  const desktopOnly = () => {
    if (!desktop)
      throw new Error(
        "This action needs the installed GetANNY desktop application.",
      );
    return desktop;
  };
  const openKnown = async (id, folder) => {
    const item = manager.requireItem(id);
    if (folder) {
      if (item.filePath && item.status === "completed") {
        await fs.access(item.filePath);
        desktopOnly().shell.showItemInFolder(item.filePath);
      } else {
        const error = await desktopOnly().shell.openPath(item.savePath);
        if (error) throw new Error(error);
      }
    } else {
      if (item.status !== "completed" || !item.filePath)
        throw new Error("Only completed downloads can be opened.");
      await fs.access(item.filePath).catch(() => {
        throw new Error("This file was moved or deleted outside GetANNY.");
      });
      if (/\.(exe|msi|bat|cmd|ps1|com|scr|js|vbs)$/i.test(item.filePath)) {
        const answer = await desktopOnly().dialog.showMessageBox(
          desktop.mainWindow(),
          {
            type: "warning",
            title: "Open downloaded program?",
            message: "Only run downloaded programs you trust.",
            detail: item.filePath,
            buttons: ["Cancel", "Open program"],
            defaultId: 0,
            cancelId: 0,
          },
        );
        if (answer.response !== 1) return { opened: false };
      }
      const error = await desktopOnly().shell.openPath(item.filePath);
      if (error) throw new Error(error);
    }
    return { opened: true };
  };
  return {
    "app:bootstrap": async () => ({
      version: require("../../package.json").version,
      platform: process.platform,
      desktop: !!desktop,
      settings: settings.getAll(),
      downloads: manager.getAll(),
      bridge: s.wsServer.status(),
      pendingRequests: [...s.pendingBrowserRequests],
      tools: await mediaDetector.ytdlp.availability(),
      capabilities: {
        login: !!desktop && ["win32", "darwin"].includes(process.platform),
        dialogs: !!desktop,
        updates: !!desktop?.updater,
      },
      update: desktop?.updater?.getState() || { status: "unavailable" },
    }),
    "download:add": (options) => manager.addDownload(options),
    "download:add-torrent": (options) => manager.addTorrent(options),
    "download:pause": (id) => manager.pause(id),
    "download:resume": (id) => manager.resume(id),
    "download:cancel": (id) => manager.cancel(id),
    "download:retry": (id) => manager.retry(id),
    "download:remove": (options) =>
      manager.remove(options.id, options.deleteFile === true),
    "download:clear-completed": () => manager.clearCompleted(),
    "download:clear-history": (options) => manager.clearHistory(options),
    "download:get-all": () => manager.getAll(),
    "download:preview": (id) => s.previews.get(manager.requireItem(id)),
    "download:open-file": (id) => openKnown(id, false),
    "download:open-folder": (id) => openKnown(id, true),
    "media:get-formats": (url) => mediaDetector.getFormats(url),
    "media:get-playlist": (url) => mediaDetector.getPlaylist(url),
    "media:download": async (options) => {
      const selection = mediaDetector.selection(options);
      const subtitle = options.subtitle
        ? mediaDetector.subtitleSelection({
            analysisId: options.analysisId,
            languageId: options.subtitle.languageId,
            format: options.subtitle.format,
          })
        : null;
      const id = await manager.addMedia({
        ...selection,
        savePath: options.savePath,
      });
      if (subtitle)
        await manager.addMedia({ ...subtitle, savePath: options.savePath });
      return id;
    },
    "media:download-subtitle": (options) =>
      manager.addMedia({
        ...mediaDetector.subtitleSelection(options),
        savePath: options.savePath,
      }),
    "media:download-thumbnail": (options) =>
      manager.addDownload({
        ...mediaDetector.thumbnailSelection(options),
        savePath: options.savePath,
      }),
    "settings:get-all": () => settings.getAll(),
    "settings:set": async ({ key, value }) => {
      await settings.set(key, value);
      return settings.getAll();
    },
    "settings:reset": () => settings.reset(),
    "browser:status": () => s.browserStatus(),
    "browser:bridge-status": () => s.wsServer.status(),
    "browser:detect": () => s.browserDetector.detect(),
    "browser:prepare": (id) => {
      desktopOnly();
      return s.prepareBrowser(id);
    },
    "browser:open-extensions": (id) => {
      desktopOnly();
      return s.browserDetector.openExtensions(id);
    },
    "browser:open-package": async (id) => {
      const result = await s.extensionInstaller.check(id);
      if (!result.prepared) throw new Error("Prepare this extension first.");
      const error = await desktopOnly().shell.openPath(result.path);
      if (error) throw new Error(error);
      return true;
    },
    "browser:locate": async (id) => {
      const d = desktopOnly();
      const result = await d.dialog.showOpenDialog(d.mainWindow(), {
        title: "Locate browser executable",
        properties: ["openFile"],
        ...(process.platform === "win32"
          ? { filters: [{ name: "Browser executable", extensions: ["exe"] }] }
          : {}),
      });
      if (!result.canceled)
        return s.browserDetector.locate(id, result.filePaths[0]);
      return null;
    },
    "browser:pairing-key": (browserId) => {
      const token = s.identity.clientTokens[browserId];
      if (!token) throw new Error("Choose a supported browser first.");
      return token;
    },
    "browser:ack-request": (id) => s.ackBrowserRequest(id),
    "browser:commit-request": ({ id, downloadId }) =>
      s.commitBrowserRequest(id, downloadId),
    "dialog:select-folder": async () => {
      const d = desktopOnly();
      const result = await d.dialog.showOpenDialog(d.mainWindow(), {
        defaultPath: settings.get("defaultDownloadPath"),
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : result.filePaths[0];
    },
    "dialog:select-torrent": async () => {
      const d = desktopOnly();
      const result = await d.dialog.showOpenDialog(d.mainWindow(), {
        properties: ["openFile"],
        filters: [{ name: "BitTorrent files", extensions: ["torrent"] }],
      });
      return result.canceled ? null : result.filePaths[0];
    },
    "app:open-external": async (url) => {
      const d = desktopOnly();
      await d.shell.openExternal(validateUrl(url));
      return true;
    },
    "app:open-data-folder": async () => {
      const error = await desktopOnly().shell.openPath(path.dirname(s.db.file));
      if (error) throw new Error(error);
      return true;
    },
    "app:window-state": () => ({
      maximized: desktop?.mainWindow()?.isMaximized() || false,
    }),
    "clipboard:read-text": () => desktopOnly().clipboard.readText(),
    "app:quit": () => {
      desktopOnly().app.quit();
      return true;
    },
    "updates:get-state": () =>
      desktopOnly().updater?.getState() || { status: "unavailable" },
    "updates:check": () => desktopOnly().updater?.check(),
    "updates:download": () => desktopOnly().updater?.download(),
    "updates:install": () => desktopOnly().updater?.install(),
  };
}
function setupIpcHandlers({ ipcMain, services, desktop }) {
  const handlers = createHandlers({ services, desktop });
  const validateSender = (event) => {
    const win = desktop.mainWindow();
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("Untrusted IPC sender.");
  };
  for (const [channel, handler] of Object.entries(handlers))
    ipcMain.handle(channel, (event, ...args) => {
      validateSender(event);
      return handler(...args);
    });
  for (const action of ["minimize", "maximize", "close"])
    ipcMain.on(`window:${action}`, (event) => {
      validateSender(event);
      const win = desktop.mainWindow();
      if (action === "minimize") win.minimize();
      else if (action === "maximize")
        win.isMaximized() ? win.unmaximize() : win.maximize();
      else win.close();
    });
}
module.exports = { createHandlers, setupIpcHandlers };
