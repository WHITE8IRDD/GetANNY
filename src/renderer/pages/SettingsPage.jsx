import React, { useEffect, useRef, useState } from "react";
import {
  LuArrowDownToLine,
  LuFolderOpen,
  LuGlobe,
  LuSlidersHorizontal,
  LuCheck,
  LuRotateCcw,
  LuExternalLink,
  LuCircleHelp,
  LuMonitor,
  LuPalette,
  LuRefreshCw,
} from "react-icons/lu";
import { api, errorMessage } from "../api";
import {
  Button,
  ConfirmDialog,
  ErrorBanner,
  PageHeader,
  Select,
  Switch,
} from "../components/ui";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { useI18n } from "../i18n/useI18n";
import completionChime from "../assets/completion-chime.wav";
function NumberControl({ value, onChange, min, max, label, suffix, disabled }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value ?? ""));
  useEffect(() => setDraft(String(value ?? "")), [value]);
  const commit = () => {
    const number = Number(draft);
    if (
      draft.trim() &&
      Number.isInteger(number) &&
      number >= min &&
      number <= max
    ) {
      if (number !== value) onChange(number);
    } else {
      setDraft(String(value));
      useUIStore
        .getState()
        .notify(t("settings.numberRange", { label, min, max }), "error");
    }
  };
  return (
    <div className="number-control">
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step="1"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {suffix && <span>{suffix}</span>}
    </div>
  );
}
function ScheduleTime({ value, label, disabled, onChange }) {
  const minutes = Number.isInteger(value) ? value : 0;
  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return (
    <input
      type="time"
      aria-label={label}
      value={time}
      disabled={disabled}
      onChange={(event) => {
        const match = /^(\d{2}):(\d{2})$/.exec(event.target.value);
        if (match) onChange(Number(match[1]) * 60 + Number(match[2]));
      }}
    />
  );
}
function VolumeControl({ value, disabled, onCommit, label }) {
  const currentValue = Number(value ?? 50);
  const [draft, setDraft] = useState(currentValue);
  const dragging = useRef(false);
  const committed = useRef(currentValue);
  useEffect(() => {
    if (!dragging.current) setDraft(currentValue);
    committed.current = currentValue;
  }, [currentValue]);
  const commit = (nextValue = draft) => {
    dragging.current = false;
    if (nextValue !== committed.current) {
      committed.current = nextValue;
      onCommit(nextValue);
    }
  };
  return (
    <div className="volume-control">
      <input
        aria-label={label}
        aria-valuetext={`${draft}%`}
        type="range"
        min="0"
        max="100"
        step="1"
        value={draft}
        disabled={disabled}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onPointerCancel={(event) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => {
          if (
            [
              "ArrowLeft",
              "ArrowRight",
              "ArrowUp",
              "ArrowDown",
              "Home",
              "End",
              "PageUp",
              "PageDown",
            ].includes(event.key)
          ) {
            commit(Number(event.currentTarget.value));
          }
        }}
        onBlur={(event) => commit(Number(event.currentTarget.value))}
      />
      <output>{draft}%</output>
    </div>
  );
}
function SettingRow({ title, description, children, disabled = false }) {
  return (
    <div className={`setting-row ${disabled ? "unavailable" : ""}`}>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
export default function SettingsPage({ capabilities, version }) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings),
    save = useSettingsStore((state) => state.save);
  const [section, setSection] = useState("downloads"),
    [saving, setSaving] = useState(""),
    [saved, setSaved] = useState(false),
    [error, setError] = useState(""),
    [reset, setReset] = useState(false),
    [updateStatus, setUpdateStatus] = useState("idle");
  const checkUpdates = async () => {
    setUpdateStatus("checking");
    try {
      const result = await api.invoke("updates:check");
      setUpdateStatus(result?.status || "unavailable");
    } catch {
      setUpdateStatus("unavailable");
    }
  };
  const persist = async (key, value) => {
    setSaving(key);
    setSaved(false);
    setError("");
    try {
      await save(key, value);
      setSaved(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setSaving("");
    }
  };
  const toggle = (key) => (
    <Switch
      label={key}
      checked={!!settings[key]}
      onChange={(value) => persist(key, value)}
      disabled={!!saving}
    />
  );
  const number = (key, label, min, max, suffix) => (
    <NumberControl
      label={label}
      value={settings[key]}
      min={min}
      max={max}
      suffix={suffix}
      disabled={!!saving}
      onChange={(value) => persist(key, value)}
    />
  );
  return (
    <div className="page settings-page">
      <PageHeader eyebrow={t("settings.eyebrow")} title={t("settings.title")}>
        <span className="save-indicator">
          {saving ? (
            t("settings.saving")
          ) : saved ? (
            <>
              <LuCheck />
              {t("settings.saved")}
            </>
          ) : (
            t("settings.stored")
          )}
        </span>
      </PageHeader>
      <nav className="settings-tabs" aria-label={t("settings.categories")}>
        {[
          ["downloads", LuArrowDownToLine, t("settings.tab.downloads")],
          ["storage", LuFolderOpen, t("settings.tab.storage")],
          ["browser", LuGlobe, t("settings.tab.browser")],
          ["application", LuSlidersHorizontal, t("settings.tab.application")],
        ].map(([key, Icon, label]) => (
          <button
            key={key}
            aria-current={section === key ? "page" : undefined}
            className={section === key ? "selected" : ""}
            onClick={() => setSection(key)}
          >
            <Icon />
            {label}
          </button>
        ))}
      </nav>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {section === "downloads" && (
        <>
          <section className="settings-panel">
            <div className="settings-section-heading">
              <h2>{t("settings.transfer.title")}</h2>
              <p>{t("settings.transfer.description")}</p>
            </div>
            <SettingRow
              title={t("settings.autoStart.title")}
              description={t("settings.autoStart.description")}
            >
              {toggle("autoStartDownloads")}
            </SettingRow>
            <SettingRow
              title={t("settings.clipboardMonitor.title")}
              description={t("settings.clipboardMonitor.description")}
            >
              {toggle("clipboardMonitoring")}
            </SettingRow>
            <SettingRow
              title={t("settings.maxDownloads.title")}
              description={t("settings.maxDownloads.description")}
            >
              {number(
                "maxConcurrentDownloads",
                t("settings.maxDownloads.title"),
                1,
                12,
              )}
            </SettingRow>
            <SettingRow
              title={t("settings.connections.title")}
              description={t("settings.connections.description")}
            >
              <Select
                aria-label={t("settings.connections.title")}
                value={settings.maxConnectionsPerDownload}
                disabled={!!saving}
                onChange={(event) =>
                  persist(
                    "maxConnectionsPerDownload",
                    Number(event.target.value),
                  )
                }
              >
                {[1, 2, 4, 6, 8, 12, 16].map((value) => (
                  <option key={value} value={value}>
                    {value === 1
                      ? t("settings.connections.one")
                      : t("settings.connections.many", { count: value })}
                  </option>
                ))}
              </Select>
            </SettingRow>
            <SettingRow
              title={t("settings.resume.title")}
              description={t("settings.resume.description")}
            >
              {toggle("resumeOnStartup")}
            </SettingRow>
          </section>
          <section className="settings-panel">
            <div className="settings-section-heading">
              <h2>{t("settings.schedule.title")}</h2>
              <p>{t("settings.schedule.description")}</p>
            </div>
            <SettingRow
              title={t("settings.schedule.only.title")}
              description={t("settings.schedule.only.description")}
            >
              {toggle("scheduleEnabled")}
            </SettingRow>
            <SettingRow
              title={t("settings.startTime.title")}
              description={t("settings.startTime.description")}
            >
              <ScheduleTime
                label={t("settings.startTime.label")}
                value={settings.scheduleStartMinute}
                disabled={!!saving || !settings.scheduleEnabled}
                onChange={(value) => persist("scheduleStartMinute", value)}
              />
            </SettingRow>
            <SettingRow
              title={t("settings.endTime.title")}
              description={t("settings.endTime.description")}
            >
              <ScheduleTime
                label={t("settings.endTime.label")}
                value={settings.scheduleEndMinute}
                disabled={!!saving || !settings.scheduleEnabled}
                onChange={(value) => persist("scheduleEndMinute", value)}
              />
            </SettingRow>
          </section>
          <section className="settings-panel">
            <div className="settings-section-heading">
              <h2>{t("settings.bandwidth.title")}</h2>
              <p>{t("settings.bandwidth.description")}</p>
            </div>
            <SettingRow
              title={t("settings.speed.title")}
              description={t("settings.speed.description")}
            >
              <NumberControl
                label={t("settings.speed.title")}
                min={0}
                max={1048576}
                suffix="KB/s"
                value={Math.round((settings.speedLimit || 0) / 1024)}
                disabled={!!saving}
                onChange={(value) => persist("speedLimit", value * 1024)}
              />
            </SettingRow>
            <SettingRow
              title={t("settings.timeout.title")}
              description={t("settings.timeout.description")}
            >
              {number(
                "requestTimeoutSeconds",
                t("settings.timeout.title"),
                5,
                300,
                "sec",
              )}
            </SettingRow>
            <SettingRow
              title={t("settings.retries.title")}
              description={t("settings.retries.description")}
            >
              {number(
                "retryAttempts",
                t("settings.retries.title"),
                0,
                5,
                t("settings.tries"),
              )}
            </SettingRow>
            <SettingRow
              title={t("settings.retryDelay.title")}
              description={t("settings.retryDelay.description")}
            >
              {number(
                "retryDelaySeconds",
                t("settings.retryDelay.title"),
                1,
                120,
                t("settings.seconds"),
              )}
            </SettingRow>
          </section>
        </>
      )}
      {section === "storage" && (
        <section className="settings-panel">
          <div className="settings-section-heading">
            <h2>{t("settings.storage.title")}</h2>
            <p>{t("settings.storage.description")}</p>
          </div>
          <SettingRow
            title={t("settings.folder.title")}
            description={
              settings.defaultDownloadPath || t("settings.folder.choose")
            }
          >
            <Button
              icon={LuFolderOpen}
              disabled={!capabilities.dialogs}
              busy={saving === "defaultDownloadPath"}
              onClick={async () => {
                try {
                  const folder = await api.invoke("dialog:select-folder");
                  if (folder) persist("defaultDownloadPath", folder);
                } catch (error) {
                  setError(errorMessage(error));
                }
              }}
            >
              {t("settings.chooseFolder")}
            </Button>
          </SettingRow>
          {!capabilities.dialogs && (
            <div className="setting-preview-path">
              <label htmlFor="preview-path">{t("settings.sandboxPath")}</label>
              <input
                id="preview-path"
                key={settings.defaultDownloadPath}
                defaultValue={settings.defaultDownloadPath}
                onBlur={(event) => {
                  if (event.target.value !== settings.defaultDownloadPath)
                    persist("defaultDownloadPath", event.target.value);
                }}
              />
              <small>{t("settings.sandboxNote")}</small>
            </div>
          )}
          <SettingRow
            title={t("settings.organize.title")}
            description={t("settings.organize.description")}
          >
            {toggle("organizeByType")}
          </SettingRow>
          <SettingRow
            title={t("settings.data.title")}
            description={t("settings.data.description")}
          >
            <Button
              icon={LuExternalLink}
              disabled={!api.desktop}
              onClick={() =>
                api
                  .invoke("app:open-data-folder")
                  .catch((error) => setError(errorMessage(error)))
              }
            >
              {t("settings.openData")}
            </Button>
          </SettingRow>
          <div className="settings-note">
            <LuCircleHelp />
            <span>{t("settings.storageNote")}</span>
          </div>
        </section>
      )}
      {section === "browser" && (
        <section className="settings-panel">
          <div className="settings-section-heading">
            <h2>{t("settings.browser.title")}</h2>
            <p>{t("settings.browser.description")}</p>
          </div>
          <SettingRow
            title={t("settings.browserIntegration.title")}
            description={t("settings.browserIntegration.description")}
          >
            {toggle("browserIntegrationEnabled")}
          </SettingRow>
          <SettingRow
            title={t("settings.mediaIntegration.title")}
            description={t("settings.mediaIntegration.description")}
          >
            {toggle("mediaIntegration")}
          </SettingRow>
          <SettingRow
            title={t("settings.manageBrowsers.title")}
            description={t("settings.manageBrowsers.description")}
          >
            <Button
              icon={LuGlobe}
              onClick={() => useUIStore.getState().setActiveTab("browser")}
            >
              {t("settings.browserSetup")}
            </Button>
          </SettingRow>
        </section>
      )}
      {section === "application" && (
        <>
          <section className="settings-panel">
            <div className="settings-section-heading">
              <h2>{t("settings.appearance.title")}</h2>
              <p>{t("settings.appearance.description")}</p>
            </div>
            <SettingRow
              title={t("settings.theme.title")}
              description={t("settings.theme.description")}
            >
              <Button
                icon={LuPalette}
                onClick={() => useUIStore.getState().setActiveTab("themes")}
              >
                {t("settings.openThemes")}
              </Button>
            </SettingRow>
            <SettingRow
              title={t("settings.compact.title")}
              description={t("settings.compact.description")}
            >
              {toggle("compactList")}
            </SettingRow>
            <SettingRow
              title={t("settings.animations.title")}
              description={t("settings.animations.description")}
            >
              <Select
                aria-label={t("settings.animations.title")}
                value={settings.animationMode || "standard"}
                disabled={!!saving}
                onChange={(event) =>
                  persist("animationMode", event.target.value)
                }
              >
                <option value="standard">
                  {t("settings.animations.standard")}
                </option>
                <option value="reduced">
                  {t("settings.animations.reduced")}
                </option>
                <option value="disabled">
                  {t("settings.animations.disabled")}
                </option>
              </Select>
            </SettingRow>
          </section>
          <section className="settings-panel">
            <div className="settings-section-heading">
              <h2>{t("settings.startup.title")}</h2>
              <p>{t("settings.startup.description")}</p>
            </div>
            {capabilities.updates && (
              <SettingRow
                title={t("updates.settingsTitle")}
                description={t("updates.settingsDescription")}
              >
                <div className="update-check-control">
                  <Button
                    icon={LuRefreshCw}
                    busy={updateStatus === "checking"}
                    onClick={checkUpdates}
                  >
                    {t("updates.checkButton")}
                  </Button>
                  {updateStatus !== "idle" && updateStatus !== "checking" && (
                    <span className="update-check-result" role="status">
                      {updateStatus === "current"
                        ? t("updates.current")
                        : updateStatus === "available"
                          ? t("updates.availableSetting")
                          : t("updates.unavailable")}
                    </span>
                  )}
                </div>
              </SettingRow>
            )}
            <SettingRow
              title={t("settings.completionSound.title")}
              description={t("settings.completionSound.description")}
            >
              {toggle("completionSound")}
            </SettingRow>
            <SettingRow
              title={t("settings.completionSound.volume")}
              description={t("settings.completionSound.volumeDescription")}
            >
              <VolumeControl
                label={t("settings.completionSound.volume")}
                value={settings.completionSoundVolume}
                disabled={!!saving}
                onCommit={(value) => persist("completionSoundVolume", value)}
              />
            </SettingRow>
            <SettingRow
              title={t("settings.completionSound.preview")}
              description={t("settings.completionSound.previewDescription")}
            >
              <Button
                onClick={() => {
                  try {
                    const audio = new Audio(completionChime);
                    audio.volume = Math.max(
                      0,
                      Math.min(
                        1,
                        Number(settings.completionSoundVolume ?? 50) / 100,
                      ),
                    );
                    audio.play().catch(() => {});
                  } catch {
                    /* optional preview */
                  }
                }}
              >
                {t("settings.completionSound.play")}
              </Button>
            </SettingRow>
            <SettingRow
              title={t("settings.notifications.title")}
              description={t("settings.notifications.description")}
            >
              {toggle("notifications")}
            </SettingRow>
            <SettingRow
              title={t("settings.tray.title")}
              description={t("settings.tray.description")}
            >
              {toggle("closeToTray")}
            </SettingRow>
            <SettingRow
              title={t("settings.launch.title")}
              description={
                capabilities.login
                  ? t("settings.launch.description")
                  : t("settings.launch.installed")
              }
              disabled={!capabilities.login}
            >
              <Switch
                label={t("settings.launch.title")}
                checked={!!settings.launchAtLogin}
                disabled={!capabilities.login || !!saving}
                onChange={(value) => persist("launchAtLogin", value)}
              />
            </SettingRow>
            <SettingRow
              title={t("settings.minimized.title")}
              description={t("settings.minimized.description")}
            >
              {toggle("startMinimized")}
            </SettingRow>
          </section>
        </>
      )}
      <div className="settings-bottom">
        <div className="about-app">
          <div className="about-brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-wordmark" role="img" aria-label="GetANNY" />
            <span className="about-version">{version}</span>
          </div>
          <small>{t("settings.tagline")}</small>
        </div>
        <Button
          variant="ghost"
          icon={LuRotateCcw}
          onClick={() => setReset(true)}
        >
          {t("settings.reset")}
        </Button>
      </div>
      {reset && (
        <ConfirmDialog
          title={t("settings.resetTitle")}
          description={t("settings.resetDescription")}
          label={t("settings.reset")}
          onClose={() => setReset(false)}
          onConfirm={async () => {
            const values = await api.invoke("settings:reset");
            useSettingsStore.getState().setSettings(values);
            setSaved(true);
          }}
        />
      )}
    </div>
  );
}
