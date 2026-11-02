import { useEffect } from "react";
import { api } from "../api";
import useDownloadStore from "../stores/useDownloadStore";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
export function useIPC() {
  useEffect(() => {
    const cleanups = [
      api.on("downloads:changed", (downloads) =>
        useDownloadStore.getState().setDownloads(downloads),
      ),
      api.on("download:progress", ({ id, ...data }) =>
        useDownloadStore.getState().update(id, data),
      ),
      api.on("download:complete", (data) => {
        if (
          !["all", "active", "completed"].includes(
            useUIStore.getState().activeTab,
          )
        )
          useUIStore.getState().notify(`Downloaded ${data.filename}`);
      }),
      api.on("download:error", (data) => {
        const requiresAuthentication =
          data.code === "AUTH_REQUIRED" ||
          /^Authentication required:/.test(data.error || "");
        if (
          requiresAuthentication ||
          !["all", "active", "failed"].includes(useUIStore.getState().activeTab)
        )
          useUIStore.getState().notify(data.error, "error");
      }),
      api.on("settings:changed", (settings) =>
        useSettingsStore.getState().setSettings(settings),
      ),
      api.on("browser:request", (request) =>
        useUIStore.getState().addRequest(request),
      ),
      api.on("menu:add-download", () => useUIStore.getState().setAddModal({})),
      api.on("menu:settings", () =>
        useUIStore.getState().setActiveTab("settings"),
      ),
    ];
    return () => cleanups.forEach((cleanup) => cleanup());
  }, []);
}
