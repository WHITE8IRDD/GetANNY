import React, { useEffect, useMemo, useState } from "react";
import {
  LuArrowDownToLine,
  LuArrowDown,
  LuArrowUp,
  LuActivity,
  LuCircleCheck,
  LuPause,
  LuCircleAlert,
  LuFilm,
  LuMagnet,
  LuGlobe,
  LuSettings2,
  LuPalette,
  LuMinus,
  LuSquare,
  LuCopy,
  LuX,
  LuPlus,
  LuFolderOpen,
  LuChevronRight,
  LuLink,
  LuMonitor,
  LuWifiOff,
  LuLoaderCircle,
  LuRefreshCw,
} from "react-icons/lu";
import { api, errorMessage } from "./api";
import { useIPC } from "./hooks/useIPC";
import useDownloadStore from "./stores/useDownloadStore";
import useSettingsStore from "./stores/useSettingsStore";
import useUIStore from "./stores/useUIStore";
import DownloadsPage from "./pages/DownloadsPage";
import MediaPage from "./pages/MediaPage";
import BrowserPage from "./pages/BrowserPage";
import SettingsPage from "./pages/SettingsPage";
import ThemesPage from "./pages/ThemesPage";
import ThemeSwitcher from "./components/ThemeSwitcher";
import LanguageSwitcher from "./components/LanguageSwitcher";
import { useI18n } from "./i18n/useI18n";
import { applyTheme } from "./utils/theme";
import AddDownloadDialog from "./components/AddDownloadDialog";
import DownloadDetails from "./components/DownloadDetails";
import { Button, IconButton, Toasts } from "./components/ui";
import { active, bytes } from "./utils/format";
import completionChime from "./assets/completion-chime.wav";
import ErrorBoundary from "./components/ErrorBoundary";
const navigation = [
  ["all", LuArrowDownToLine, "nav.all"],
  ["active", LuActivity, "nav.active"],
  ["completed", LuCircleCheck, "nav.completed"],
  ["paused", LuPause, "nav.paused"],
  ["failed", LuCircleAlert, "nav.failed"],
];
const downloadTabs = navigation.map(([id]) => id);
const Nav = React.memo(function Nav({
  id,
  icon: Icon,
  label,
  count: amount,
  live = false,
}) {
  const tab = useUIStore((state) => state.activeTab);
  const setTab = useUIStore((state) => state.setActiveTab);
  return (
    <button
      className={`nav-item ${tab === id ? "selected" : ""} ${live && tab === id ? "has-live-transfer" : ""}`}
      aria-current={tab === id ? "page" : undefined}
      title={label}
      onClick={() => setTab(id)}
    >
      <Icon />
      <span>{label}</span>
      {amount > 0 && <b>{amount}</b>}
    </button>
  );
});
function Sidebar({ bridge, version, platform }) {
  const { t } = useI18n();
  const tab = useUIStore((state) => state.activeTab),
    setTab = useUIStore((state) => state.setActiveTab);
  const downloads = useDownloadStore((state) => state.downloads),
    progressById = useDownloadStore((state) => state.progressById),
    settings = useSettingsStore((state) => state.settings);
  const liveDownloads = useMemo(
    () =>
      downloads.map((item) => {
        const progress = progressById[item.id];
        return progress ? { ...item, ...progress } : item;
      }),
    [downloads, progressById],
  );
  const count = (key) =>
    liveDownloads.filter((item) =>
      key === "all"
        ? true
        : key === "active"
          ? active(item) || ["queued", "retrying"].includes(item.status)
          : item.status === key,
    ).length;
  const hasLiveTransfer = (key) =>
    liveDownloads.some(
      (item) =>
        active(item) &&
        (key === "all" ||
          key === "active" ||
          (key === "torrent" && item.kind === "torrent")),
    );
  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="workspace-label">{t("shell.personalWorkspace")}</div>
        <Button
          icon={LuPlus}
          variant="primary"
          className="sidebar-add"
          onClick={() => useUIStore.getState().setAddModal({})}
        >
          {t("shell.newDownload")}
          <kbd>{platform === "darwin" ? "⌘N" : "Ctrl + N"}</kbd>
        </Button>
      </div>
      <nav aria-label="Main navigation">
        <div className="nav-group-label">{t("nav.library")}</div>
        {navigation.map(([id, Icon, key]) => (
          <Nav
            key={id}
            id={id}
            icon={Icon}
            label={t(key)}
            count={count(id)}
            live={hasLiveTransfer(id)}
          />
        ))}
        <div className="nav-group-label tools-label">{t("nav.tools")}</div>
        <Nav id="media" icon={LuFilm} label={t("nav.media")} />
        <Nav
          id="torrent"
          icon={LuMagnet}
          label={t("nav.torrents")}
          count={
            liveDownloads.filter(
              (item) => item.kind === "torrent" && active(item),
            ).length
          }
          live={hasLiveTransfer("torrent")}
        />
      </nav>
      <div className="sidebar-bottom">
        <button
          className="save-location"
          onClick={async () => {
            try {
              const folder = await api.invoke("dialog:select-folder");
              if (folder)
                await useSettingsStore
                  .getState()
                  .save("defaultDownloadPath", folder);
            } catch (error) {
              useUIStore.getState().notify(errorMessage(error), "error");
            }
          }}
          title={settings.defaultDownloadPath}
        >
          <LuFolderOpen />
          <div>
            <small>{t("shell.defaultLocation")}</small>
            <span>
              {settings.defaultDownloadPath
                ?.split(/[\\/]/)
                .filter(Boolean)
                .at(-1) || "Downloads"}
            </span>
          </div>
          <LuChevronRight />
        </button>
        <Nav id="browser" icon={LuGlobe} label={t("nav.browser")} />
        <Nav id="themes" icon={LuPalette} label={t("nav.themes")} />
        <Nav id="settings" icon={LuSettings2} label={t("nav.settings")} />
        <button
          className="sidebar-connection"
          onClick={() => setTab("browser")}
        >
          <span className={`live-dot ${bridge.clients > 0 ? "live" : ""}`} />
          <span>
            {bridge.clients > 0
              ? t(
                  bridge.clients > 1
                    ? "shell.browsersConnected"
                    : "shell.browserConnected",
                  { count: bridge.clients },
                )
              : bridge.running && bridge.enabled
                ? t("shell.noBrowser")
                : t("shell.bridgeOffline")}
          </span>
          <LuChevronRight />
        </button>
        <div className="sidebar-version">
          GETANNY <span>{version}</span>
        </div>
      </div>
    </aside>
  );
}
function StatusBar({ version }) {
  const { t } = useI18n();
  const [downloads, setDownloads] = useState(
    () => useDownloadStore.getState().downloads,
  );
  useEffect(() => {
    let timer;
    const refresh = () => {
      const state = useDownloadStore.getState();
      setDownloads(
        state.downloads.map((item) => {
          const progress = state.progressById[item.id];
          return progress ? { ...item, ...progress } : item;
        }),
      );
    };
    const updateVisibility = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState === "visible") {
        refresh();
        timer = setInterval(refresh, 1000);
      }
    };
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);
  const transferring = downloads.filter(active);
  const completed = downloads.filter(
    (item) => item.status === "completed",
  ).length;
  const speed = transferring.reduce(
    (sum, item) => sum + (item.status === "downloading" ? item.speed || 0 : 0),
    0,
  );
  const uploadSpeed = transferring.reduce(
    (sum, item) => sum + (item.kind === "torrent" ? item.uploadSpeed || 0 : 0),
    0,
  );
  return (
    <footer className="statusbar">
      <div className="statusbar-start">
        <span className={`live-dot ${transferring.length ? "live" : ""}`} />
        {transferring.length
          ? t("shell.activeTransfers", { count: transferring.length })
          : t("shell.ready")}
        <span className="status-separator">/</span>
        <span>
          {t("shell.queued", {
            count: downloads.filter((item) =>
              ["queued", "retrying"].includes(item.status),
            ).length,
          })}
        </span>
      </div>
      <div className="statusbar-end">
        <button
          type="button"
          className="status-speed"
          title={t("shell.openActive")}
          aria-label={`${t("shell.openActive")}: ${bytes(speed)}/s download, ${t("shell.activeTransfers", { count: transferring.length })}`}
          onClick={() => useUIStore.getState().setActiveTab("active")}
        >
          <LuArrowDown />
          {speed > 0 ? `${bytes(speed)}/s` : "0 B/s"}
          {uploadSpeed > 0 && (
            <>
              <span className="status-separator">/</span>
              <LuArrowUp />
              {bytes(uploadSpeed)}/s
            </>
          )}
          <span className="status-speed-count">
            {t("shell.activeTransfers", { count: transferring.length })}
          </span>
        </button>
        <span className="statusbar-completed">
          <LuCircleCheck />
          {completed} {t("downloads.completedCount")}
        </span>
        <span className="statusbar-local">
          {t("shell.storedLocally")} · {version}
        </span>
      </div>
    </footer>
  );
}
// The detail sheet owns its subscription so progress ticks do not re-render
// the whole shell for a single transfer.
function DetailSheet() {
  const detailId = useUIStore((state) => state.details);
  const metadata = useDownloadStore((state) =>
    detailId ? state.downloads.find((entry) => entry.id === detailId) : null,
  );
  const progress = useDownloadStore((state) =>
    detailId ? state.progressById[detailId] : null,
  );
  const item = metadata && progress ? { ...metadata, ...progress } : metadata;
  if (!item) return null;
  return (
    <DownloadDetails
      item={item}
      onClose={() => useUIStore.getState().setDetails(null)}
    />
  );
}
export default function App() {
  useIPC();
  const { t, language, rtl } = useI18n();
  const [boot, setBoot] = useState(null),
    [error, setError] = useState(""),
    [bridge, setBridge] = useState({
      running: false,
      enabled: true,
      clients: 0,
    }),
    [maximized, setMaximized] = useState(false);
  const [update, setUpdate] = useState({ status: "idle" });
  const [dismissedUpdate, setDismissedUpdate] = useState(() => {
    try {
      return localStorage.getItem("getanny.dismissed-update") || "";
    } catch {
      return "";
    }
  });
  const tab = useUIStore((state) => state.activeTab),
    addModal = useUIStore((state) => state.addModal),
    setAddModal = useUIStore((state) => state.setAddModal),
    detailId = useUIStore((state) => state.details),
    requests = useUIStore((state) => state.browserRequests);
  const settings = useSettingsStore((state) => state.settings);
  const [dropActive, setDropActive] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState(null);
  const dragDepth = React.useRef(0);
  const lastChime = React.useRef(0);
  const [visited, setVisited] = useState(() => new Set(["all"]));
  useEffect(() => {
    setVisited((previous) =>
      previous.has(tab) ? previous : new Set(previous).add(tab),
    );
  }, [tab]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
  }, [language, rtl]);
  const load = async () => {
    setError("");
    try {
      const data = await api.invoke("app:bootstrap");
      useDownloadStore.getState().setDownloads(data.downloads);
      useSettingsStore.getState().setSettings(data.settings);
      setBridge(data.bridge);
      const initialUpdate = data.update || { status: "idle" };
      setUpdate(initialUpdate);
      setBoot(data);
      for (const request of data.pendingRequests)
        useUIStore.getState().addRequest(request);
      // Setup is only a first-launch destination. A browser that is already
      // paired means the user finished installing the extension, so remember
      // that and open the download library directly on later launches.
      const connected = data.bridge?.clients > 0;
      if (!data.settings.firstRunCompleted && !connected)
        useUIStore.getState().setActiveTab("browser");
      if (!data.settings.firstRunCompleted && connected)
        useSettingsStore
          .getState()
          .save("firstRunCompleted", true)
          .catch(() => {});
    } catch (error) {
      setError(errorMessage(error));
    }
  };
  useEffect(() => {
    load();
    const cleanup = api.on("window:state", (value) =>
      setMaximized(!!value.maximized),
    );
    const stopUpdates = api.on("update:status", (nextUpdate) => {
      setUpdate(nextUpdate);
    });
    return () => {
      cleanup();
      stopUpdates();
    };
  }, []);
  const updateAction = async (action) => {
    try {
      await api.invoke(`updates:${action}`);
    } catch (error) {
      useUIStore.getState().notify(t("updates.failed"), "error");
    }
  };
  useEffect(() => {
    if (!boot) return;
    const poll = () =>
      api
        .invoke("browser:bridge-status")
        .then(setBridge)
        .catch(() =>
          setBridge((old) => ({ ...old, running: false, clients: 0 })),
        );
    // Connection events are primary; this lightweight visible-window fallback
    // expires stale sessions without repeatedly scanning browser installations.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") poll();
    }, 30000);
    const cleanup = api.on("browser:changed", setBridge);
    return () => {
      clearInterval(timer);
      cleanup();
    };
  }, [!!boot]);
  // Completing setup from the extension side (first successful handshake) is
  // enough of a signal; the welcome panel should not return on the next launch.
  useEffect(() => {
    if (!boot || settings.firstRunCompleted || !(bridge.clients > 0)) return;
    useSettingsStore
      .getState()
      .save("firstRunCompleted", true)
      .catch(() => {});
  }, [boot, bridge.clients, settings.firstRunCompleted]);
  useEffect(() => {
    applyTheme(settings.theme || "nord");
    const system = window.matchMedia("(prefers-color-scheme: light)");
    const update = () => {
      if ((settings.theme || "nord") === "system") applyTheme("system");
    };
    system.addEventListener("change", update);
    return () => system.removeEventListener("change", update);
  }, [settings.theme]);
  useEffect(() => {
    document.documentElement.dataset.motion =
      settings.animationMode || "standard";
    document.documentElement.dataset.density = settings.compactList
      ? "compact"
      : "comfortable";
  }, [settings.animationMode, settings.compactList]);
  const routeCapture = (value) => {
    const text = String(value || "").trim();
    if (!text) return false;
    if (/^magnet:\?/i.test(text) || /\.torrent(?:$|[?#])/i.test(text)) {
      useUIStore.getState().setActiveTab("torrent");
      useUIStore.getState().setAddModal({ torrent: true, torrentUrl: text });
    } else if (
      /^https?:\/\//i.test(text) &&
      /(?:youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|soundcloud\.com|dailymotion\.com|tiktok\.com|instagram\.com|facebook\.com|twitter\.com|x\.com|bilibili\.com|reddit\.com|kick\.com)/i.test(
        text,
      )
    ) {
      useUIStore.getState().openMedia(text);
      useUIStore.getState().setActiveTab("media");
    } else if (/^https?:\/\//i.test(text)) {
      useUIStore.getState().setAddModal({ url: text });
    } else return false;
    return true;
  };
  useEffect(() => {
    let previous = "";
    let timer;
    let dismissTimer;
    let reading = false;
    if (settings.clipboardMonitoring && api.desktop) {
      timer = setInterval(async () => {
        if (reading) return;
        reading = true;
        try {
          const current = (await api.invoke("clipboard:read-text")).trim();
          if (
            current &&
            current !== previous &&
            (/^(https?:\/\/|magnet:\?)/i.test(current) ||
              /\.torrent$/i.test(current))
          ) {
            previous = current;
            setClipboardNotice(current);
            clearTimeout(dismissTimer);
            dismissTimer = setTimeout(() => setClipboardNotice(null), 5000);
          }
          previous = current;
        } catch {
          /* clipboard access is optional and must not interrupt the app */
        } finally {
          reading = false;
        }
      }, 1000);
    }
    return () => {
      clearInterval(timer);
      clearTimeout(dismissTimer);
    };
  }, [settings.clipboardMonitoring]);
  useEffect(() => {
    if (!settings.completionSound) return;
    const unsubscribe = api.on("download:complete", () => {
      const now = Date.now();
      if (now - lastChime.current < 2000) return;
      lastChime.current = now;
      try {
        const audio = new Audio(completionChime);
        audio.volume = Math.max(
          0,
          Math.min(1, Number(settings.completionSoundVolume ?? 50) / 100),
        );
        audio.play().catch(() => {});
      } catch {
        /* audio is optional */
      }
    });
    return unsubscribe;
  }, [settings.completionSound, settings.completionSoundVolume]);
  useEffect(() => {
    const handleDragEnter = (event) => {
      if (!event.dataTransfer?.types?.length) return;
      event.preventDefault();
      dragDepth.current++;
      setDropActive(true);
    };
    const handleDragOver = (event) => event.preventDefault();
    const handleDragLeave = (event) => {
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDropActive(false);
    };
    const handleDrop = async (event) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDropActive(false);
      const file = event.dataTransfer?.files?.[0];
      if (file && /\.torrent$/i.test(file.name)) {
        let torrentPath;
        try {
          torrentPath =
            api.getDroppedFilePath?.(file) ||
            file.path ||
            (api.desktop ? "" : file.name);
        } catch {
          torrentPath = file.path || "";
        }
        if (!torrentPath) {
          useUIStore
            .getState()
            .notify(t("shell.dropTorrentPathUnavailable"), "error");
          return;
        }
        useUIStore.getState().setActiveTab("torrent");
        useUIStore.getState().setAddModal({
          torrent: true,
          torrentUrl: torrentPath,
        });
        return;
      }
      const text =
        event.dataTransfer?.getData("text/uri-list") ||
        event.dataTransfer?.getData("text/plain") ||
        event.dataTransfer?.getData("text");
      if (!routeCapture(text))
        useUIStore.getState().notify(t("shell.dropUnsupported"), "error");
    };
    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [t]);
  useEffect(() => {
    const pasteFromClipboard = async () => {
      try {
        const value = api.desktop
          ? await api.invoke("clipboard:read-text")
          : await navigator.clipboard.readText();
        if (!routeCapture(value))
          useUIStore
            .getState()
            .notify(t("shell.clipboardUnsupported"), "error");
      } catch {
        useUIStore.getState().notify(t("downloads.clipboardDenied"), "error");
      }
    };
    window.addEventListener("getanny:paste-clipboard", pasteFromClipboard);
    return () =>
      window.removeEventListener("getanny:paste-clipboard", pasteFromClipboard);
  }, [t]);
  // File handoffs are queued automatically by the desktop bridge, so the only
  // request that still needs attention is a media page awaiting a format.
  const review = (request) => {
    useUIStore.getState().openMedia(request.url);
    useUIStore.getState().removeRequest(request.id);
    api
      .invoke("browser:ack-request", request.id)
      .catch((error) =>
        useUIStore.getState().notify(errorMessage(error), "error"),
      );
  };
  const closeAdd = (submitted = false) => {
    const requestId = addModal?.browserRequestId;
    setAddModal(null);
    if (
      !submitted &&
      requestId &&
      useUIStore
        .getState()
        .browserRequests.some((request) => request.id === requestId)
    ) {
      useUIStore.getState().removeRequest(requestId);
      api
        .invoke("browser:ack-request", requestId)
        .catch((error) =>
          useUIStore.getState().notify(errorMessage(error), "error"),
        );
    }
  };
  useEffect(() => {
    if (boot && requests[0]?.kind === "media" && !addModal && !detailId)
      review(requests[0]);
  }, [!!boot, requests[0]?.id, !!addModal, detailId]);
  return (
    <div className="app-shell">
      {dropActive && (
        <div className="drop-overlay" aria-live="polite">
          <span>{t("shell.dropToAdd")}</span>
        </div>
      )}
      <header className="titlebar">
        <div className="titlebar-left">
          <div className="app-brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-wordmark" role="img" aria-label="GetANNY" />
            <span className="brand-divider" />
            <span className="app-caption">{t("shell.downloadManager")}</span>
          </div>
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
        <div className="titlebar-right">
          {!api.desktop && (
            <span className="preview-label">
              <LuMonitor />
              {t("shell.livePreview")}
            </span>
          )}
          {api.desktop && boot?.platform !== "darwin" && (
            <div className="window-controls">
              <button
                aria-label="Minimize window"
                onClick={() => api.window.minimize()}
              >
                <LuMinus />
              </button>
              <button
                aria-label={maximized ? "Restore window" : "Maximize window"}
                onClick={() => api.window.maximize()}
              >
                {maximized ? <LuCopy /> : <LuSquare />}
              </button>
              <button
                aria-label="Close window"
                className="window-close"
                onClick={() => api.window.close()}
              >
                <LuX />
              </button>
            </div>
          )}
        </div>
      </header>
      {boot ? (
        <>
          <div className="app-body">
            <Sidebar
              bridge={bridge}
              version={boot.version}
              platform={boot.platform}
            />
            <main className="main-content" id="main-content">
              {boot.capabilities.updates &&
                ["available", "downloading", "downloaded"].includes(
                  update.status,
                ) &&
                update.version !== dismissedUpdate && (
                  <div className="update-banner" role="status">
                    <div>
                      <strong>
                        {update.status === "available"
                          ? t("updates.available", { version: update.version })
                          : update.status === "downloading"
                            ? t("updates.downloading", {
                                percent: update.percent,
                              })
                            : update.status === "downloaded"
                              ? t("updates.downloaded", {
                                  version: update.version,
                                })
                              : t("updates.checking")}
                      </strong>
                      <span>{t("updates.githubChannel")}</span>
                    </div>
                    {update.status === "available" && (
                      <Button
                        variant="primary"
                        onClick={() => updateAction("download")}
                      >
                        {t("updates.downloadButton")}
                      </Button>
                    )}
                    {update.status === "downloaded" && (
                      <Button
                        variant="primary"
                        onClick={() => updateAction("install")}
                      >
                        {t("updates.restartButton")}
                      </Button>
                    )}
                    <IconButton
                      label={t("common.closeDialog")}
                      onClick={() => {
                        const version = update.version || "";
                        setDismissedUpdate(version);
                        try {
                          localStorage.setItem(
                            "getanny.dismissed-update",
                            version,
                          );
                        } catch {
                          // The notification still stays dismissed for this session.
                        }
                      }}
                    >
                      <LuX />
                    </IconButton>
                  </div>
                )}
              {!api.desktop && (
                <div className="preview-strip">
                  <LuMonitor />
                  {t("shell.sandbox")}
                </div>
              )}
              {requests.length > 0 && (
                <div className="browser-request">
                  <LuLink />
                  <div>
                    <strong>
                      {t("shell.mediaReceived", {
                        source: requests[0].source,
                      })}
                    </strong>
                    <span>{requests[0].url}</span>
                  </div>
                  <Button variant="primary" onClick={() => review(requests[0])}>
                    {t("shell.analyzePage")}
                  </Button>
                  <IconButton
                    label={t("shell.dismissRequest")}
                    onClick={() => {
                      const request = requests[0];
                      useUIStore.getState().removeRequest(request.id);
                      api
                        .invoke("browser:ack-request", request.id)
                        .catch(() => {});
                    }}
                  >
                    <LuX />
                  </IconButton>
                </div>
              )}
              {downloadTabs.map(
                (id) =>
                  (visited.has(id) || tab === id) && (
                    <div
                      className="page-slot"
                      hidden={tab !== id}
                      key={id}
                      aria-hidden={tab !== id}
                    >
                      <ErrorBoundary>
                        <DownloadsPage
                          filter={id}
                          active={tab === id}
                          platform={boot.platform}
                        />
                      </ErrorBoundary>
                    </div>
                  ),
              )}
              {(visited.has("torrent") || tab === "torrent") && (
                <div
                  className="page-slot"
                  hidden={tab !== "torrent"}
                  aria-hidden={tab !== "torrent"}
                >
                  <ErrorBoundary>
                    <DownloadsPage
                      filter="torrent"
                      active={tab === "torrent"}
                      platform={boot.platform}
                    />
                  </ErrorBoundary>
                </div>
              )}
              {(visited.has("media") || tab === "media") && (
                <div className="page-slot" hidden={tab !== "media"}>
                  <ErrorBoundary>
                    <MediaPage tools={boot.tools} />
                  </ErrorBoundary>
                </div>
              )}
              {(visited.has("browser") || tab === "browser") && (
                <div className="page-slot" hidden={tab !== "browser"}>
                  <ErrorBoundary>
                    <BrowserPage active={tab === "browser"} />
                  </ErrorBoundary>
                </div>
              )}
              {(visited.has("themes") || tab === "themes") && (
                <div className="page-slot" hidden={tab !== "themes"}>
                  <ErrorBoundary>
                    <ThemesPage />
                  </ErrorBoundary>
                </div>
              )}
              {(visited.has("settings") || tab === "settings") && (
                <div className="page-slot" hidden={tab !== "settings"}>
                  <ErrorBoundary>
                    <SettingsPage
                      capabilities={boot.capabilities}
                      version={boot.version}
                    />
                  </ErrorBoundary>
                </div>
              )}
            </main>
          </div>
          <StatusBar version={boot.version} />
        </>
      ) : (
        <div className="startup-screen">
          <div className="startup-brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-wordmark" role="img" aria-label="GetANNY" />
          </div>
          <h1 className="visually-hidden">GetANNY</h1>
          {error ? (
            <>
              <p className="error-text">{error}</p>
              <Button icon={LuRefreshCw} onClick={load}>
                {t("shell.tryAgain")}
              </Button>
            </>
          ) : (
            <>
              <LuLoaderCircle className="spin" />
              <p>{t("shell.opening")}</p>
            </>
          )}
        </div>
      )}
      {addModal && <AddDownloadDialog initial={addModal} onClose={closeAdd} />}
      <DetailSheet />
      {clipboardNotice && (
        <button
          className="clipboard-toast"
          onClick={() => {
            routeCapture(clipboardNotice);
            setClipboardNotice(null);
          }}
        >
          {t("shell.clipboardDetected")}
        </button>
      )}
      <Toasts />
    </div>
  );
}
