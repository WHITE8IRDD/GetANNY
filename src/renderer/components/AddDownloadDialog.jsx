import React, { useEffect, useMemo, useState } from "react";
import {
  LuArrowDownToLine,
  LuLink,
  LuFolderOpen,
  LuMagnet,
  LuArrowUpRight,
  LuX,
  LuSearch,
  LuFile,
  LuFilm,
  LuMusic2,
  LuCheck,
  LuListChecks,
} from "react-icons/lu";
import { api, errorMessage } from "../api";
import {
  Button,
  Dialog,
  Field,
  FolderField,
  ErrorBanner,
  IconButton,
} from "./ui";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { useI18n } from "../i18n/useI18n";

function TorrentFileIcon({ name }) {
  if (/\.(mp4|mkv|mov|avi|webm|m4v)$/i.test(name)) return <LuFilm />;
  if (/\.(mp3|m4a|flac|wav|aac|ogg)$/i.test(name)) return <LuMusic2 />;
  return <LuFile />;
}

export default function AddDownloadDialog({ initial = {}, onClose }) {
  const { t } = useI18n();
  const settings = useSettingsStore((state) => state.settings);
  const intercepted = Boolean(initial.browserRequestId);
  const [kind, setKind] = useState(initial.torrent ? "torrent" : "file");
  const [url, setUrl] = useState(initial.url || initial.torrentUrl || "");
  const [filename, setFilename] = useState(initial.filename || "");
  const [folder, setFolder] = useState(settings.defaultDownloadPath || "");
  const [torrentInfo, setTorrentInfo] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState(() => new Set());
  const [fileQuery, setFileQuery] = useState("");
  const [autoStart, setAutoStart] = useState(
    settings.autoStartDownloads !== false,
  );
  const [prioritizeFirstLast, setPrioritizeFirstLast] = useState(false);
  const [freeSpace, setFreeSpace] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const clearLink = () => {
    setUrl("");
    setError("");
    document.getElementById("download-url")?.focus();
  };
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (intercepted && (kind !== "file" || url.trim() !== initial.url))
        throw new Error(t("add.handoffMismatch"));
      if (kind === "file" && !/^https?:\/\//i.test(url.trim()))
        throw new Error(t("add.invalidUrl"));
      let info = torrentInfo;
      if (kind === "torrent" && !info) {
        info = await api.invoke("torrent:inspect", { torrent: url.trim() });
        if (info.files.length > 2) {
          setTorrentInfo(info);
          setSelectedFiles(new Set(info.files.map((file) => file.index)));
          setAutoStart(settings.autoStartDownloads !== false);
          return;
        }
      }
      const downloadId = await api.invoke(
        kind === "torrent" ? "download:add-torrent" : "download:add",
        kind === "torrent"
          ? {
              torrent: url.trim(),
              savePath: folder,
              selectedFiles:
                info && info.files.length > 2 ? [...selectedFiles] : undefined,
              torrentName: info?.name,
              infoHash: info?.infoHash,
              torrentTrackers: info?.trackers,
              torrentFileBase64: info?.torrentFileBase64,
              startImmediately: autoStart,
              prioritizeFirstLast,
            }
          : {
              url: url.trim(),
              filename: filename || undefined,
              headers: initial.headers,
              browserTransferId: initial.browserTransferId,
              browserSource: initial.browserSource,
              ...(folder !== settings.defaultDownloadPath
                ? { savePath: folder }
                : {}),
            },
      );
      if (initial.browserRequestId) {
        useUIStore.getState().removeRequest(initial.browserRequestId);
        try {
          const handoff = await api.invoke("browser:commit-request", {
            id: initial.browserRequestId,
            downloadId,
          });
          if (handoff.cancelled === false)
            useUIStore.getState().notify(t("add.handoffUnconfirmed"), "error");
        } catch (error) {
          useUIStore
            .getState()
            .notify(
              t("add.handoffFailed", { error: errorMessage(error) }),
              "error",
            );
        }
      }
      useUIStore
        .getState()
        .notify(
          (kind === "torrent" ? autoStart : settings.autoStartDownloads)
            ? t("add.queuedNotice")
            : t("add.pausedNotice"),
        );
      useUIStore
        .getState()
        .setActiveTab(kind === "torrent" ? "torrent" : "all");
      onClose(true);
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!torrentInfo || !api.desktop) return;
    let cancelled = false;
    api
      .invoke("storage:free-space", folder)
      .then((size) => {
        if (!cancelled) setFreeSpace(size);
      })
      .catch(() => {
        if (!cancelled) setFreeSpace(null);
      });
    return () => {
      cancelled = true;
    };
  }, [torrentInfo, folder]);
  const visibleTorrentFiles = useMemo(() => {
    if (!torrentInfo) return [];
    const query = fileQuery.trim().toLocaleLowerCase();
    return torrentInfo.files
      .filter((file) => !query || file.path.toLocaleLowerCase().includes(query))
      .sort((a, b) =>
        a.path.localeCompare(b.path, undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
  }, [torrentInfo, fileQuery]);
  const toggleFile = (index) =>
    setSelectedFiles((current) => {
      const next = new Set(current);
      next.has(index) ? next.delete(index) : next.add(index);
      return next;
    });
  const selectedBytes =
    torrentInfo?.files.reduce(
      (sum, file) => sum + (selectedFiles.has(file.index) ? file.length : 0),
      0,
    ) || 0;
  const formatSize = (value) => {
    if (!value) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const level = Math.min(
      Math.floor(Math.log(value) / Math.log(1024)),
      units.length - 1,
    );
    return `${(value / 1024 ** level).toFixed(level === 0 ? 0 : 1)} ${units[level]}`;
  };
  return (
    <Dialog
      title={torrentInfo ? t("torrentPicker.title") : t("add.title")}
      description={
        torrentInfo
          ? t("torrentPicker.description")
          : initial.source
            ? t("add.descriptionSource", { source: initial.source })
            : t("add.descriptionDefault")
      }
      onClose={() => !busy && onClose()}
      wide={!!torrentInfo}
      busy={busy}
    >
      <form onSubmit={submit}>
        <div
          className={`dialog-body ${torrentInfo ? "torrent-picker-body" : ""}`}
        >
          {!torrentInfo && (
            <>
              <div className="segmented">
                <button
                  type="button"
                  className={kind === "file" ? "selected" : ""}
                  onClick={() => {
                    setKind("file");
                    setTorrentInfo(null);
                    setError("");
                  }}
                >
                  <LuLink />
                  {t("add.fileUrl")}
                </button>
                <button
                  type="button"
                  className={kind === "torrent" ? "selected" : ""}
                  disabled={intercepted}
                  title={intercepted ? t("add.torrentLocked") : undefined}
                  onClick={() => {
                    setKind("torrent");
                    setTorrentInfo(null);
                    setAutoStart(settings.autoStartDownloads !== false);
                    setError("");
                  }}
                >
                  <LuMagnet />
                  {t("add.torrent")}
                </button>
              </div>
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <Field
                label={
                  kind === "file" ? t("add.downloadLink") : t("add.torrentLink")
                }
                id="download-url"
                hint={
                  intercepted
                    ? t("add.handoffLocked")
                    : kind === "file"
                      ? t("add.fileHint")
                      : t("add.torrentHint")
                }
              >
                <div className="input-group">
                  <LuLink />
                  <input
                    autoFocus
                    id="download-url"
                    required
                    readOnly={intercepted}
                    type={kind === "file" ? "url" : "text"}
                    value={url}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setTorrentInfo(null);
                    }}
                    placeholder={
                      kind === "file"
                        ? "https://example.com/file.zip"
                        : "magnet:?xt=urn:btih:…"
                    }
                    autoComplete="off"
                    spellCheck="false"
                  />
                  {url && !intercepted && (
                    <IconButton
                      label={t("add.clearLink")}
                      className="clear-link"
                      onClick={clearLink}
                    >
                      <LuX />
                    </IconButton>
                  )}
                  {kind === "torrent" && api.desktop && (
                    <Button
                      variant="ghost"
                      icon={LuFolderOpen}
                      onClick={async () => {
                        try {
                          const file = await api.invoke(
                            "dialog:select-torrent",
                          );
                          if (file) {
                            setUrl(file);
                            setTorrentInfo(null);
                          }
                        } catch (error) {
                          setError(errorMessage(error));
                        }
                      }}
                    >
                      {t("add.chooseFile")}
                    </Button>
                  )}
                </div>
              </Field>
              {kind === "file" && (
                <Field
                  label={t("add.fileName")}
                  id="download-name"
                  hint={t("add.fileNameHint")}
                >
                  <input
                    id="download-name"
                    value={filename}
                    onChange={(event) => setFilename(event.target.value)}
                    placeholder={t("add.automatic")}
                    maxLength={220}
                  />
                </Field>
              )}
              <FolderField value={folder} onChange={setFolder} />
            </>
          )}
          {torrentInfo && (
            <>
              <div className="torrent-picker-summary">
                <div className="torrent-picker-title">
                  <LuMagnet />
                  <div>
                    <strong>{torrentInfo.name}</strong>
                    <small>
                      {torrentInfo.files.length} files ·{" "}
                      {formatSize(torrentInfo.length)}
                    </small>
                  </div>
                </div>
                <span
                  className="torrent-picker-hash"
                  title={torrentInfo.infoHash}
                >
                  {torrentInfo.infoHash}
                </span>
              </div>
              <div className="torrent-picker-layout">
                <aside className="torrent-picker-settings">
                  <FolderField
                    value={folder}
                    onChange={setFolder}
                    label={t("common.saveTo")}
                    id="torrent-save-folder"
                  />
                  <small className="torrent-free-space">
                    {freeSpace == null
                      ? ""
                      : `${t("torrentPicker.freeSpace")}: ${formatSize(freeSpace)}`}
                  </small>
                  <label className="torrent-option">
                    <input
                      type="checkbox"
                      checked={autoStart}
                      onChange={(event) => setAutoStart(event.target.checked)}
                    />
                    {t("torrentPicker.startAutomatically")}
                  </label>
                  <label className="torrent-option">
                    <input
                      type="checkbox"
                      checked={prioritizeFirstLast}
                      onChange={(event) =>
                        setPrioritizeFirstLast(event.target.checked)
                      }
                    />
                    {t("torrentPicker.firstLastPieces")}
                  </label>
                  <div className="torrent-size-summary">
                    <span>{t("torrentPicker.selectedSize")}</span>
                    <strong>{formatSize(selectedBytes)}</strong>
                  </div>
                  {torrentInfo.comment && (
                    <p className="torrent-comment" title={torrentInfo.comment}>
                      {torrentInfo.comment}
                    </p>
                  )}
                </aside>
                <section
                  className="torrent-file-pane"
                  aria-label={t("torrentPicker.files")}
                >
                  <div className="torrent-file-toolbar">
                    <div className="torrent-file-search">
                      <LuSearch />
                      <input
                        value={fileQuery}
                        onChange={(event) => setFileQuery(event.target.value)}
                        placeholder={t("torrentPicker.filterFiles")}
                        aria-label={t("torrentPicker.filterFiles")}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      icon={LuListChecks}
                      onClick={() =>
                        setSelectedFiles(
                          new Set(torrentInfo.files.map((file) => file.index)),
                        )
                      }
                    >
                      {t("torrentPicker.selectAll")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setSelectedFiles(new Set())}
                    >
                      {t("torrentPicker.selectNone")}
                    </Button>
                  </div>
                  <div className="torrent-file-heading">
                    <span>{t("torrentPicker.fileName")}</span>
                    <span>{t("torrentPicker.size")}</span>
                  </div>
                  <div className="torrent-file-list">
                    {visibleTorrentFiles.map((file) => (
                      <label
                        className={`torrent-file-row ${selectedFiles.has(file.index) ? "selected" : ""}`}
                        key={file.index}
                      >
                        <input
                          type="checkbox"
                          checked={selectedFiles.has(file.index)}
                          onChange={() => toggleFile(file.index)}
                        />
                        <span className="torrent-file-name">
                          <TorrentFileIcon name={file.name} />
                          <span title={file.path}>{file.path}</span>
                        </span>
                        <span className="torrent-file-size">
                          {formatSize(file.length)}
                        </span>
                      </label>
                    ))}
                    {!visibleTorrentFiles.length && (
                      <p className="torrent-no-files">
                        {t("torrentPicker.noMatches")}
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
          {!torrentInfo && (
            <div className="form-note">
              <LuArrowDownToLine />
              <span>
                {t("add.connections", {
                  count: settings.maxConnectionsPerDownload || 8,
                })}{" "}
                ·{" "}
                {settings.autoStartDownloads
                  ? t("add.autoStart")
                  : t("add.paused")}
                <br />
                {t("add.existingNote")}
              </span>
            </div>
          )}
          {kind === "file" && (
            <button
              type="button"
              className="text-link"
              onClick={() => {
                useUIStore.getState().openMedia(url);
                onClose();
              }}
            >
              {t("add.mediaLink")} <LuArrowUpRight />
            </button>
          )}
        </div>
        <footer className="dialog-footer">
          {torrentInfo && (
            <span className="torrent-picked-count">
              <LuCheck />
              {t("torrentPicker.selectedCount", {
                selected: selectedFiles.size,
                total: torrentInfo.files.length,
              })}
            </span>
          )}
          <Button
            disabled={busy}
            onClick={torrentInfo ? () => setTorrentInfo(null) : onClose}
          >
            {torrentInfo ? t("torrentPicker.back") : t("add.cancel")}
          </Button>
          <Button
            type="submit"
            variant="primary"
            icon={torrentInfo ? LuMagnet : LuArrowDownToLine}
            busy={busy}
            disabled={!!torrentInfo && selectedFiles.size === 0}
          >
            {torrentInfo
              ? t("torrentPicker.downloadSelected")
              : kind === "torrent"
                ? autoStart
                  ? t("add.start")
                  : t("add.add")
                : settings.autoStartDownloads
                  ? t("add.start")
                  : t("add.add")}
          </Button>
        </footer>
      </form>
    </Dialog>
  );
}
