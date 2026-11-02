import React, { useCallback, useEffect, useState } from "react";
import {
  LuArrowRight,
  LuCheck,
  LuCircleCheck,
  LuCopy,
  LuExternalLink,
  LuFolderOpen,
  LuGlobe,
  LuKeyRound,
  LuLink,
  LuRefreshCw,
  LuShieldCheck,
  LuCircleHelp,
  LuChevronRight,
  LuMonitor,
  LuPlug,
  LuSearch,
} from "react-icons/lu";
import { FaChrome, FaFirefoxBrowser, FaOpera, FaEdge } from "react-icons/fa6";
import { SiBrave, SiVivaldi } from "react-icons/si";
import { api, errorMessage } from "../api";
import {
  Button,
  Dialog,
  ErrorBanner,
  IconButton,
  PageHeader,
} from "../components/ui";
import useUIStore from "../stores/useUIStore";
import useSettingsStore from "../stores/useSettingsStore";
import { useI18n } from "../i18n/useI18n";
const browserIcons = {
  chrome: FaChrome,
  chromium: FaChrome,
  brave: SiBrave,
  firefox: FaFirefoxBrowser,
  vivaldi: SiVivaldi,
  opera: FaOpera,
  edge: FaEdge,
  helium: LuGlobe,
};
export default function BrowserPage({ active = true }) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings),
    save = useSettingsStore((state) => state.save);
  const [info, setInfo] = useState(null),
    [selected, setSelected] = useState(settings.preferredBrowser || "chrome"),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState(""),
    [prepared, setPrepared] = useState(null),
    [pairing, setPairing] = useState(""),
    [showInstallGuide, setShowInstallGuide] = useState(false);
  const refresh = useCallback(async (visible = false) => {
    if (visible) setRefreshing(true);
    try {
      setInfo(await api.invoke("browser:status"));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      if (visible) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    if (!active || document.visibilityState !== "visible") return;
    refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    const cleanup = api.on("browser:changed", () => refresh());
    return () => {
      clearInterval(timer);
      cleanup();
    };
  }, [active, refresh]);
  const browser = info?.browsers.find((item) => item.id === selected);
  const Icon = browserIcons[selected] || LuGlobe;
  const run = async (action) => {
    setBusy(true);
    setError("");
    try {
      const value = await action();
      await refresh();
      return value;
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const prepare = () =>
    run(async () => {
      const result = await api.invoke("browser:prepare", selected);
      setPrepared(result);
      await save("preferredBrowser", selected);
      useUIStore.getState().notify(t("browser.prepareNotice"));
    });
  const installInBrowser = () =>
    run(async () => {
      const result = await api.invoke("browser:prepare", selected);
      setPrepared(result);
      await save("preferredBrowser", selected);
      await api.invoke("browser:open-extensions", selected);
      useUIStore
        .getState()
        .notify(t("browser.installNextStep", { path: result.path }));
    });
  const copy = (text) =>
    navigator.clipboard.writeText(text).then(
      () => useUIStore.getState().notify(t("browser.copied")),
      () => useUIStore.getState().notify(t("browser.clipboardDenied"), "error"),
    );
  const packagePath =
    prepared?.browserId === selected
      ? prepared.path
      : browser?.prepared
        ? browser.packagePath
        : null;
  return (
    <div className="page browser-page">
      <PageHeader eyebrow={t("browser.eyebrow")} title={t("browser.title")}>
        <span
          className={`bridge-status-pill ${
            info?.websocket.error
              ? "error"
              : info?.websocket.clients > 0
                ? "connected"
                : info?.websocket.running && info?.websocket.enabled
                  ? "listening"
                  : "offline"
          }`}
          role="status"
        >
          <span className="bridge-name">{t("browser.bridge")}</span>
          <span
            className={`live-dot ${info?.websocket.clients > 0 ? "live" : ""}`}
          />
          <strong>
            {info?.websocket.error
              ? t("browser.error")
              : info?.websocket.clients > 0
                ? t("browser.verifiedMany", {
                    count: info.websocket.clients,
                  })
                : info?.websocket.running && info?.websocket.enabled
                  ? t("browser.listening")
                  : info?.websocket.enabled === false
                    ? t("browser.disabled")
                    : info
                      ? t("browser.offline")
                      : t("browser.checking")}
          </strong>
          <span className="mono">127.0.0.1:{info?.websocket.port ?? "—"}</span>
        </span>
        <Button
          icon={LuRefreshCw}
          busy={refreshing}
          onClick={() => refresh(true)}
        >
          {t("browser.refresh")}
        </Button>
      </PageHeader>
      {!settings.firstRunCompleted && (
        <section className="onboarding">
          <div className="onboarding-mark">
            <LuPlug />
          </div>
          <div>
            <span className="eyebrow">{t("browser.welcomeEyebrow")}</span>
            <h2>{t("browser.welcomeTitle")}</h2>
            <p>{t("browser.welcomeText")}</p>
            <div className="onboarding-points">
              <span>
                <LuCheck />
                {t("browser.pointBrowser")}
              </span>
              <span>
                <LuCheck />
                {t("browser.pointSecure")}
              </span>
              <span>
                <LuCheck />
                {t("browser.pointApprove")}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              save("firstRunCompleted", true).catch((error) =>
                setError(errorMessage(error)),
              )
            }
          >
            {t("browser.later")} <LuArrowRight />
          </Button>
        </section>
      )}
      {!api.desktop && (
        <div className="notice">
          <LuMonitor />
          <span>{t("browser.previewNotice")}</span>
        </div>
      )}
      {!settings.browserIntegrationEnabled && (
        <div className="notice warning">
          <LuCircleHelp />
          <span>{t("browser.disabledNotice")}</span>
          <Button
            variant="ghost"
            onClick={() => useUIStore.getState().setActiveTab("settings")}
          >
            {t("browser.openSettings")}
          </Button>
        </div>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {info?.websocket.error && (
        <ErrorBanner>{info.websocket.error}</ErrorBanner>
      )}
      <div className="browser-workspace">
        <section className="browser-picker">
          <div className="panel-heading">
            <h2>{t("browser.browsers")}</h2>
            <span>{t("browser.selectOne")}</span>
          </div>
          {info ? (
            info.browsers.map((item) => {
              const BrowserIcon = browserIcons[item.id];
              return (
                <button
                  key={item.id}
                  className={`browser-option ${selected === item.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelected(item.id);
                    setError("");
                    setPrepared(null);
                    setPairing("");
                  }}
                >
                  <span className={`browser-logo ${item.id}`}>
                    <BrowserIcon />
                  </span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>
                      {item.connected
                        ? t("browser.connectionVerified")
                        : item.installed
                          ? t("browser.browserDetected")
                          : t("browser.notDetected")}
                    </small>
                  </div>
                  {item.connected ? (
                    <LuCircleCheck className="success-text" />
                  ) : selected === item.id ? (
                    <LuChevronRight />
                  ) : null}
                </button>
              );
            })
          ) : (
            <div className="skeleton-stack" aria-label={t("browser.detecting")}>
              {[1, 2, 3, 4, 5, 6, 7].map((key) => (
                <div className="skeleton" key={key} />
              ))}
            </div>
          )}
          <p>{t("browser.detectionNote")}</p>
        </section>
        <section className="browser-setup">
          <div className="browser-setup-heading">
            <span className={`browser-logo large ${selected}`}>
              <Icon />
            </span>
            <div>
              <h2>
                {t("browser.connectTitle", {
                  name: browser?.name || t("browser.connectFallback"),
                })}
              </h2>
              <p>
                {browser?.connected
                  ? t(
                      browser.transport === "native"
                        ? "browser.verifiedNative"
                        : "browser.verifiedWebsocket",
                    )
                  : t("browser.threeSteps")}
              </p>
            </div>
          </div>
          <div
            className={`setup-step ${browser?.prepared && browser?.directProvisioned ? "done" : ""}`}
          >
            <span className="step-number">
              {browser?.prepared && browser?.directProvisioned ? (
                <LuCheck />
              ) : (
                "1"
              )}
            </span>
            <div className="step-content">
              <h3>{t("browser.step1Title")}</h3>
              <p>{t("browser.step1Text")}</p>
              <div className="step-actions">
                <Button
                  variant="primary"
                  icon={LuPlug}
                  busy={busy}
                  disabled={!api.desktop || !settings.browserIntegrationEnabled}
                  onClick={prepare}
                >
                  {browser?.prepared && browser?.directProvisioned
                    ? t("browser.refreshSetup")
                    : t("browser.setupBrowser", {
                        name: browser?.name || t("browser.title"),
                      })}
                </Button>
                <span className="step-result">
                  {browser?.directProvisioned ? (
                    <>
                      <LuCheck />
                      {t("browser.directProvisioned")}
                    </>
                  ) : (
                    t("browser.noAdmin")
                  )}
                </span>
              </div>
              {packagePath && (
                <div className="path-box extension-folder-actions">
                  <code>{packagePath}</code>
                  <IconButton
                    label={t("browser.copyFolder")}
                    onClick={() => copy(packagePath)}
                  >
                    <LuCopy />
                  </IconButton>
                  <IconButton
                    label={t("browser.openFolder")}
                    disabled={!api.desktop}
                    onClick={() =>
                      run(() => api.invoke("browser:open-package", selected))
                    }
                  >
                    <LuFolderOpen />
                  </IconButton>
                  <Button
                    icon={LuCircleHelp}
                    className="install-guide-button"
                    onClick={() => setShowInstallGuide(true)}
                  >
                    {t("browser.installGuide")}
                  </Button>
                </div>
              )}
              {prepared?.browserId === selected && prepared.nativeError && (
                <div className="notice warning">
                  <LuCircleHelp />
                  <span>
                    {t("browser.nativeFallbackWarning", {
                      error: prepared.nativeError,
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className={`setup-step ${browser?.connected ? "done" : ""}`}>
            <span className="step-number">
              {browser?.connected ? <LuCheck /> : "2"}
            </span>
            <div className="step-content">
              <h3>{t("browser.step2Title")}</h3>
              {selected === "firefox" ? (
                <p>{t("browser.firefoxText")}</p>
              ) : (
                <p>
                  {t("browser.chromiumText", {
                    page: browser?.extensionsPage || "chrome://extensions",
                  })}
                </p>
              )}
              <div className="step-actions">
                <Button
                  variant="primary"
                  icon={LuExternalLink}
                  busy={busy}
                  disabled={
                    !api.desktop ||
                    !settings.browserIntegrationEnabled ||
                    !browser?.installed
                  }
                  onClick={installInBrowser}
                >
                  {t("browser.installExtension")}
                </Button>
                {api.desktop && !browser?.installed && (
                  <Button
                    variant="ghost"
                    icon={LuSearch}
                    onClick={() =>
                      run(() => api.invoke("browser:locate", selected))
                    }
                  >
                    {t("browser.locate")}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div
            className={`setup-step last ${browser?.connected ? "done" : ""}`}
          >
            <span className="step-number">
              {browser?.connected ? <LuCheck /> : "3"}
            </span>
            <div className="step-content">
              <h3>{t("browser.step3Title")}</h3>
              <p>{t("browser.step3Text")}</p>
              <div
                className={`verification ${browser?.connected ? "verified" : ""}`}
              >
                <LuShieldCheck />
                <div>
                  <strong>
                    {browser?.connected
                      ? t("browser.connectedVerified")
                      : t("browser.waitingHandshake")}
                  </strong>
                  <small>
                    {browser?.connected
                      ? t("browser.readySend")
                      : browser?.lastSeen
                        ? t("browser.lastVerified", {
                            date: new Date(browser.lastSeen).toLocaleString(),
                          })
                        : t("browser.unknownState")}
                  </small>
                </div>
              </div>
              {browser?.connected && (
                <Button
                  icon={LuArrowRight}
                  variant="primary"
                  onClick={() =>
                    run(async () => {
                      if (!settings.firstRunCompleted)
                        await save("firstRunCompleted", true);
                      useUIStore.getState().setActiveTab("all");
                    })
                  }
                >
                  {t(
                    settings.firstRunCompleted
                      ? "browser.openDownloads"
                      : "browser.startDownloading",
                  )}
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
      <details className="pairing-panel">
        <summary>
          <LuKeyRound />
          <span>{t("browser.altTitle")}</span>
          <LuChevronRight />
        </summary>
        <div>
          <p>{t("browser.altText")}</p>
          {pairing ? (
            <div className="path-box">
              <code className="pairing-secret">{pairing}</code>
              <Button icon={LuCopy} onClick={() => copy(pairing)}>
                {t("browser.copyKey")}
              </Button>
            </div>
          ) : (
            <Button
              icon={LuKeyRound}
              onClick={() =>
                run(async () =>
                  setPairing(await api.invoke("browser:pairing-key", selected)),
                )
              }
            >
              {t("browser.revealKey")}
            </Button>
          )}
          <p className="muted">{t("browser.altNote")}</p>
        </div>
      </details>
      {showInstallGuide && (
        <Dialog
          title={t("browser.installGuide")}
          description={t("browser.installGuideDescription", {
            name: browser?.name || t("browser.connectFallback"),
          })}
          onClose={() => setShowInstallGuide(false)}
        >
          <div className="dialog-body install-guide-body">
            <ol className="install-guide-list">
              <li>
                {t("browser.installStep1", {
                  page: browser?.extensionsPage || "chrome://extensions",
                })}
              </li>
              <li>{t("browser.installStep2")}</li>
              <li>{t("browser.installStep3")}</li>
              <li>{t("browser.installStep4")}</li>
              <li>
                {t("browser.installStep5", { name: browser?.name || selected })}
              </li>
              <li>{t("browser.installStep6")}</li>
              <li>{t("browser.installStep7")}</li>
            </ol>
            <div className="install-guide-notes">
              <p>
                <strong>{t("browser.copyFolder")}</strong>{" "}
                {t("browser.copyFolderHelp")}
              </p>
              <p>
                <strong>{t("browser.openFolder")}</strong>{" "}
                {t("browser.openFolderHelp")}
              </p>
              {selected === "firefox" && (
                <p className="muted">{t("browser.firefoxTemporaryNote")}</p>
              )}
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
