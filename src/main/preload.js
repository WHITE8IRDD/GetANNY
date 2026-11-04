const { contextBridge, ipcRenderer, webUtils } = require("electron");
const channels = [
  "app:bootstrap",
  "clipboard:read-text",
  "download:add",
  "download:add-torrent",
  "torrent:inspect",
  "storage:free-space",
  "download:pause",
  "download:resume",
  "download:cancel",
  "download:remove",
  "download:retry",
  "download:clear-completed",
  "download:clear-history",
  "download:get-all",
  "download:preview",
  "download:open-file",
  "download:open-folder",
  "media:get-formats",
  "media:get-playlist",
  "media:download",
  "media:download-subtitle",
  "media:download-thumbnail",
  "settings:get-all",
  "settings:set",
  "settings:reset",
  "browser:status",
  "browser:bridge-status",
  "browser:detect",
  "browser:prepare",
  "browser:open-extensions",
  "browser:open-package",
  "browser:locate",
  "browser:pairing-key",
  "browser:ack-request",
  "browser:commit-request",
  "dialog:select-folder",
  "dialog:select-torrent",
  "app:open-external",
  "app:open-data-folder",
  "app:window-state",
  "app:quit",
  "updates:get-state",
  "updates:check",
  "updates:download",
  "updates:install",
];
const events = [
  "downloads:changed",
  "download:progress",
  "download:status",
  "download:complete",
  "download:error",
  "download:added",
  "settings:changed",
  "browser:request",
  "browser:changed",
  "menu:add-download",
  "menu:settings",
  "window:state",
  "update:status",
];
contextBridge.exposeInMainWorld("getanny", {
  desktop: true,
  getDroppedFilePath(file) {
    return webUtils.getPathForFile(file);
  },
  invoke(channel, ...args) {
    if (!channels.includes(channel))
      return Promise.reject(new Error("Unsupported desktop action."));
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, callback) {
    if (!events.includes(channel))
      throw new Error("Unsupported desktop event.");
    const listener = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
});
