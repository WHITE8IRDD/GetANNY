import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  LuPlus,
  LuSearch,
  LuPause,
  LuPlay,
  LuRotateCcw,
  LuEllipsis,
  LuFolderOpen,
  LuArrowUpRight,
  LuTrash2,
  LuX,
  LuInfo,
  LuCopy,
  LuFileArchive,
  LuFileText,
  LuFile,
  LuMusic2,
  LuFilm,
  LuPackage,
  LuImage,
  LuArrowDownToLine,
  LuCheck,
  LuClock3,
  LuCircleAlert,
  LuMagnet,
  LuSquareCheck,
  LuMinus,
  LuClipboardPaste,
} from "react-icons/lu";
import { api, errorMessage } from "../api";
import {
  Button,
  IconButton,
  PageHeader,
  ConfirmDialog,
  Select,
} from "../components/ui";
import useDownloadStore from "../stores/useDownloadStore";
import useUIStore from "../stores/useUIStore";
import { active, bytes, duration, percent, shortHost } from "../utils/format";
import { useI18n } from "../i18n/useI18n";
import VirtualList from "../components/VirtualList";
const icons = {
  Archives: LuFileArchive,
  Documents: LuFileText,
  Audio: LuMusic2,
  Video: LuFilm,
  Applications: LuPackage,
  Images: LuImage,
};
const titleKeys = {
  all: "downloads.all.title",
  active: "downloads.active.title",
  completed: "downloads.completed.title",
  paused: "downloads.paused.title",
  failed: "downloads.failed.title",
  torrent: "downloads.torrent.title",
};
function ContextMenu({ position, actions, onClose, label }) {
  const ref = useRef();
  useEffect(() => {
    const root = ref.current;
    root.querySelector("button:not(:disabled)")?.focus();
    const close = (event) => {
      if (!root.contains(event.target)) onClose();
    };
    const key = (event) => {
      const buttons = [...root.querySelectorAll("button:not(:disabled)")],
        index = buttons.indexOf(document.activeElement);
      if (event.key === "Escape") onClose();
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        buttons[
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? buttons.length - 1
              : (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  buttons.length) %
                buttons.length
        ]?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", key);
    };
  }, [onClose]);
  return createPortal(
    <div
      role="menu"
      aria-label={label}
      className="context-menu"
      ref={ref}
      style={{
        top: Math.max(
          8,
          Math.min(position.y, innerHeight - actions.length * 38 - 20),
        ),
        left: Math.min(position.x, innerWidth - 228),
      }}
    >
      {actions.map((action, index) => (
        <button
          role="menuitem"
          disabled={action.disabled}
          className={action.danger ? "danger-text" : ""}
          key={index}
          onClick={() => {
            action.run();
            onClose();
          }}
        >
          <action.icon />
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
const previewCache = new Map();
function DownloadPreview({ item, Icon }) {
  const supported = [
    "Images",
    "Video",
    "Audio",
    "Documents",
    "Applications",
  ].includes(item.category);
  const [url, setUrl] = useState(previewCache.get(item.id) || null);
  const ref = useRef();
  useEffect(() => {
    if (
      item.status !== "completed" ||
      !supported ||
      previewCache.has(item.id)
    ) {
      if (previewCache.has(item.id)) setUrl(previewCache.get(item.id));
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const result = await api.invoke("download:preview", item.id);
        const value = result?.url || null;
        previewCache.set(item.id, value);
        if (previewCache.size > 100)
          previewCache.delete(previewCache.keys().next().value);
        if (!cancelled) setUrl(value);
      } catch {
        if (!cancelled) setUrl(null);
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        load();
      },
      { rootMargin: "120px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [item.id, item.status, supported]);
  return (
    <div
      ref={ref}
      className={`file-icon ${item.category?.toLowerCase()} ${url ? "has-preview" : ""}`}
    >
      {url ? <img src={url} alt="" loading="lazy" /> : <Icon />}
    </div>
  );
}
function DownloadRow({
  item,
  onConfirm,
  index,
  selected,
  selectionMode,
  onSelect,
}) {
  const progress = useDownloadStore((state) => state.progressById[item.id]);
  item = progress ? { ...item, ...progress } : item;
  const { t, language } = useI18n();
  const [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(null);
  const pressTimer = useRef(null),
    pressOrigin = useRef(null),
    suppressClick = useRef(false);
  const clearPress = () => {
    clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressOrigin.current = null;
  };
  const activate = (event) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // Buttons inside the row keep their own behaviour.
    if (event.target.closest("button, a, input, select, textarea")) return;
    if (event.ctrlKey || event.metaKey) {
      onSelect(index, { toggle: true });
    } else if (event.shiftKey) {
      onSelect(index, { range: true });
    } else if (selectionMode) {
      onSelect(index, { toggle: true });
    } else {
      useUIStore.getState().setDetails(item.id);
    }
  };
  const Icon =
    item.kind === "torrent" ? LuMagnet : icons[item.category] || LuFile;
  const statusText = t(`status.${item.status}`);
  const knownSize = item.totalSize > 0 || item.status === "completed";
  const pct =
    item.totalSize > 0
      ? Math.min(100, (item.downloadedSize / item.totalSize) * 100)
      : item.status === "completed"
        ? 100
        : 0;
  const act = async (action) => {
    setBusy(true);
    try {
      const result = await api.invoke(`download:${action}`, item.id);
      if (result === false)
        useUIStore.getState().notify(t("downloads.actionUnavailable"), "error");
    } catch (error) {
      useUIStore.getState().notify(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };
  const openMenu = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    setMenu({ x: box.right - 210, y: box.bottom + 5 });
  };
  const actions = [
    ...(item.status === "completed"
      ? [
          {
            label: t("downloads.action.openFile"),
            icon: LuArrowUpRight,
            disabled: !api.desktop,
            run: () => act("open-file"),
          },
        ]
      : []),
    {
      label: t("downloads.action.showInFolder"),
      icon: LuFolderOpen,
      disabled: !api.desktop,
      run: () => act("open-folder"),
    },
    {
      label: t("downloads.action.openSource"),
      icon: LuArrowUpRight,
      disabled: !api.desktop || !/^https?:\/\//i.test(item.url || ""),
      run: () =>
        api
          .invoke("app:open-external", item.url)
          .catch((error) =>
            useUIStore.getState().notify(errorMessage(error), "error"),
          ),
    },
    {
      label: t("downloads.action.copySource"),
      icon: LuCopy,
      run: () =>
        navigator.clipboard.writeText(item.url).then(
          () => useUIStore.getState().notify(t("downloads.sourceCopied")),
          () =>
            useUIStore
              .getState()
              .notify(t("downloads.clipboardDenied"), "error"),
        ),
    },
    {
      label: t("downloads.action.details"),
      icon: LuInfo,
      run: () => useUIStore.getState().setDetails(item.id),
    },
    ...(!["completed", "cancelled"].includes(item.status)
      ? [
          {
            label: t("downloads.action.cancelTransfer"),
            icon: LuX,
            run: () =>
              onConfirm({
                title: t("downloads.cancelTitle"),
                description: item.filename,
                label: t("downloads.cancelConfirm"),
                onConfirm: () => api.invoke("download:cancel", item.id),
              }),
          },
        ]
      : []),
    {
      label: t("downloads.action.removeHistory"),
      icon: LuTrash2,
      run: () =>
        onConfirm({
          title: t("downloads.removeHistoryTitle"),
          description: t("downloads.removeHistoryDescription", {
            name: item.filename,
          }),
          label: t("downloads.removeHistoryConfirm"),
          onConfirm: () => api.invoke("download:remove", { id: item.id }),
        }),
    },
    ...(item.status === "completed" && item.kind !== "torrent"
      ? [
          {
            label: t("downloads.action.deleteFile"),
            icon: LuTrash2,
            danger: true,
            run: () =>
              onConfirm({
                title: t("downloads.deleteFileTitle"),
                description: item.filePath || item.filename,
                label: t("downloads.deleteFileConfirm"),
                destructive: true,
                onConfirm: () =>
                  api.invoke("download:remove", {
                    id: item.id,
                    deleteFile: true,
                  }),
              }),
          },
        ]
      : []),
  ];
  return (
    <article
      className={`download-row status-${item.status} ${selected ? "selected" : ""} ${selectionMode ? "selecting" : ""}`}
      role="listitem"
      aria-selected={selected}
      aria-label={t("downloads.rowLabel", {
        name: item.filename,
        status: statusText,
      })}
      tabIndex={0}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(event);
        }
      }}
      onPointerDown={(event) => {
        if (event.pointerType !== "touch" || event.target.closest("button"))
          return;
        clearPress();
        pressOrigin.current = { x: event.clientX, y: event.clientY };
        pressTimer.current = setTimeout(() => {
          suppressClick.current = true;
          onSelect(index, { toggle: true });
        }, 500);
      }}
      onPointerMove={(event) => {
        const origin = pressOrigin.current;
        if (
          origin &&
          Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10
        )
          clearPress();
      }}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(event) => {
        event.preventDefault();
        if (suppressClick.current) return;
        setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        className={`row-select ${selected ? "selected" : ""}`}
        role="checkbox"
        aria-checked={!!selected}
        aria-label={t("downloads.selectOne", { name: item.filename })}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(index, { toggle: true });
        }}
      >
        <LuCheck />
      </button>
      <DownloadPreview item={item} Icon={Icon} />
      <div className="file-info">
        <button
          className="filename"
          onClick={() => useUIStore.getState().setDetails(item.id)}
          title={item.filename}
        >
          {item.filename}
        </button>
        <div className="file-source">
          {item.status === "completed" ? (
            <>
              <span>
                {item.filename.match(/\.([^.]+)$/)?.[1]?.toUpperCase() ||
                  item.kind.toUpperCase()}
              </span>
              <span>·</span>
              <span>{bytes(item.totalSize)}</span>
              <span>·</span>
              <span>
                {new Date(
                  item.completedAt || item.updatedAt || item.createdAt,
                ).toLocaleString(language, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </>
          ) : (
            <>
              {shortHost(item.url)}
              <span>·</span>
              {new Date(item.createdAt).toLocaleDateString(language, {
                month: "short",
                day: "numeric",
              })}
              {item.kind === "media" && (
                <>
                  <span>·</span>
                  {item.media?.quality}
                </>
              )}
              {item.status === "downloading" &&
                item.eta != null &&
                item.totalSize > 0 && (
                  <span className="file-eta">
                    {t("downloads.timeLeft", { time: duration(item.eta) })}
                  </span>
                )}
            </>
          )}
        </div>
        {item.status === "completed" && (
          <div
            className="completed-location"
            title={item.filePath || item.savePath}
          >
            <LuFolderOpen />
            {item.filePath || item.savePath}
          </div>
        )}
        {item.error && (
          <div className="row-error" title={item.error}>
            {item.error}
          </div>
        )}
      </div>
      <div className="transfer-progress">
        <div className="transfer-numbers">
          <span>
            {bytes(item.downloadedSize)}
            {knownSize ? (
              <span className="muted">
                {" "}
                / {item.approximateSize ? "≈ " : ""}
                {bytes(item.totalSize)}
              </span>
            ) : (
              <span className="muted"> / {t("downloads.unknown")}</span>
            )}
          </span>
          <span className="transfer-percent">
            {knownSize
              ? `${item.approximateSize ? "≈ " : ""}${percent(pct)}`
              : "—"}
          </span>
        </div>
        <div
          className={`progress-track ${!knownSize && active(item) ? "indeterminate" : ""}`}
          role="progressbar"
          aria-label={t("downloads.progressLabel", { name: item.filename })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={knownSize ? Math.round(pct) : undefined}
          aria-valuetext={
            knownSize
              ? `${item.approximateSize ? `${t("downloads.approximate")} ` : ""}${Math.round(pct)}%`
              : t("downloads.transferredUnknown", {
                  size: bytes(item.downloadedSize),
                })
          }
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="transfer-caption">
          {item.status === "downloading" ? (
            <>
              <span>
                {item.speed > 0
                  ? `${bytes(item.speed)}/s`
                  : t("downloads.waitingData")}
              </span>
              <span>
                {item.kind === "torrent"
                  ? `${t("downloads.peers", { count: item.peers || 0 })} · ${t("downloads.seeds", { count: item.seeds || 0 })} · ${t("downloads.trackers", { count: item.connectedTrackers || 0, total: item.trackerCount || 0 })}`
                  : ""}
              </span>
              {item.kind === "torrent" && item.trackerWarning && (
                <span className="torrent-tracker-warning" role="status">
                  {t("downloads.trackerWarning")}
                </span>
              )}
            </>
          ) : item.status === "processing" ? (
            <span>{item.phase || t("downloads.verifying")}</span>
          ) : item.status === "retrying" ? (
            <span>
              {t("downloads.retryWaiting", { attempt: item.attempt })}
            </span>
          ) : (
            <span>
              {item.status === "completed"
                ? t("downloads.savedToDisk")
                : item.resumable
                  ? t("downloads.resumeSupported")
                  : item.status === "queued"
                    ? t("downloads.waitingSlot")
                    : "—"}
            </span>
          )}
        </div>
      </div>
      <div className={`status-badge ${item.status}`}>
        {item.status === "completed" ? (
          <LuCheck />
        ) : item.status === "failed" ? (
          <LuCircleAlert />
        ) : item.status === "paused" ? (
          <LuPause />
        ) : active(item) ? (
          <span className="status-dot" />
        ) : (
          <LuClock3 />
        )}
        {statusText}
      </div>
      <div className="row-actions">
        {active(item) || ["queued", "retrying"].includes(item.status) ? (
          <IconButton
            label={t("downloads.pauseLabel", { name: item.filename })}
            busy={busy}
            onClick={() => act("pause")}
          >
            <LuPause />
          </IconButton>
        ) : ["paused", "failed", "cancelled"].includes(item.status) ? (
          <IconButton
            label={t(
              item.status === "paused"
                ? "downloads.resumeLabel"
                : "downloads.retryLabel",
              { name: item.filename },
            )}
            busy={busy}
            onClick={() => act(item.status === "paused" ? "resume" : "retry")}
          >
            {item.status === "paused" ? <LuPlay /> : <LuRotateCcw />}
          </IconButton>
        ) : (
          <IconButton
            label={t("downloads.openLabel", { name: item.filename })}
            disabled={!api.desktop}
            onClick={() => act("open-file")}
          >
            <LuArrowUpRight />
          </IconButton>
        )}
        <IconButton
          label={t("downloads.actionsLabel", { name: item.filename })}
          onClick={openMenu}
        >
          <LuEllipsis />
        </IconButton>
      </div>
      {menu && (
        <ContextMenu
          position={menu}
          actions={actions}
          label={t("downloads.actionsMenu")}
          onClose={() => setMenu(null)}
        />
      )}
    </article>
  );
}
const MemoDownloadRow = React.memo(DownloadRow);
export default function DownloadsPage({ filter, active: visible = true }) {
  const { t } = useI18n();
  const downloads = useDownloadStore((state) => state.downloads);
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState("All files"),
    [sort, setSort] = useState("latest"),
    [confirm, setConfirm] = useState(null),
    [bulkBusy, setBulkBusy] = useState(false),
    [selected, setSelected] = useState(() => new Set()),
    [historyMenu, setHistoryMenu] = useState(null);
  const anchor = useRef(null);
  const selectionMode = selected.size > 0;
  const title = t(titleKeys[filter] || titleKeys.all);
  const base = useMemo(
    () =>
      downloads.filter(
        (item) =>
          filter === "all" ||
          (filter === "active" &&
            (active(item) || ["queued", "retrying"].includes(item.status))) ||
          (filter === "torrent" && item.kind === "torrent") ||
          filter === item.status,
      ),
    [downloads, filter],
  );
  const rows = useMemo(
    () =>
      base
        .filter(
          (item) =>
            (!search ||
              `${item.filename} ${item.url}`
                .toLowerCase()
                .includes(search.toLowerCase())) &&
            (category === "All files" || item.category === category),
        )
        .sort((a, b) =>
          sort === "name"
            ? a.filename.localeCompare(b.filename)
            : sort === "size"
              ? b.totalSize - a.totalSize
              : b.createdAt.localeCompare(a.createdAt),
        ),
    [base, search, category, sort],
  );
  const emptyTitleKey =
    search || category !== "All files"
      ? "downloads.emptySearchTitle"
      : {
          active: "downloads.emptyActiveTitle",
          completed: "downloads.emptyCompletedTitle",
          paused: "downloads.emptyPausedTitle",
          failed: "downloads.emptyFailedTitle",
          torrent: "downloads.emptyTorrentTitle",
        }[filter] || "downloads.emptyTitle";
  const emptyDescriptionKey =
    search || category !== "All files"
      ? "downloads.emptySearchDescription"
      : {
          active: "downloads.emptyActiveDescription",
          completed: "downloads.emptyCompletedDescription",
          paused: "downloads.emptyPausedDescription",
          failed: "downloads.emptyFailedDescription",
          torrent: "downloads.emptyTorrentDescription",
        }[filter] || "downloads.emptyDescription";
  const showLibraryToolbar =
    base.length > 0 || !!search || category !== "All files";
  // Stable callbacks keep every memoized row from re-rendering whenever a
  // progress tick changes the list.
  const select = useCallback(
    (index, { toggle, range }) => {
      const item = rows[index];
      if (!item) return;
      // Shift-click without a previous anchor still selects the clicked row so
      // the gesture never becomes a no-op.
      if (range && anchor.current != null) {
        const [from, to] = [anchor.current, index].sort((a, b) => a - b);
        setSelected((previous) => {
          const next = new Set(previous);
          for (let cursor = from; cursor <= to; cursor++)
            if (rows[cursor]) next.add(rows[cursor].id);
          return next;
        });
        return;
      }
      if (toggle || range) {
        anchor.current = index;
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
      }
    },
    [rows],
  );
  const selectAll = useCallback(() => {
    setSelected((previous) => {
      const allVisible =
        rows.length > 0 && rows.every((item) => previous.has(item.id));
      const next = new Set(previous);
      for (const item of rows)
        if (allVisible) next.delete(item.id);
        else next.add(item.id);
      return next;
    });
    anchor.current = null;
  }, [rows]);
  const exitSelection = useCallback(() => {
    setSelected(new Set());
    anchor.current = null;
  }, []);
  const selectState =
    !rows.length || !selected.size
      ? "none"
      : rows.every((item) => selected.has(item.id))
        ? "all"
        : "some";
  useEffect(() => {
    // Rows can disappear after a transfer is removed; stale ids must not keep
    // the toolbar open or act on unrelated future items.
    setSelected((previous) => {
      if (!previous.size) return previous;
      const live = new Set(downloads.map((item) => item.id));
      const next = new Set([...previous].filter((id) => live.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [downloads]);
  useEffect(() => {
    if (!selectionMode) return;
    const key = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitSelection();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "a" &&
        !event.target.closest?.("input, textarea, select")
      ) {
        event.preventDefault();
        selectAll();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [selectionMode, rows.length, downloads]);
  const historical = (item) =>
    ["completed", "failed", "cancelled"].includes(item.status);
  const historyCount = (scope) =>
    scope === "selected"
      ? downloads.filter((item) => selected.has(item.id) && historical(item))
          .length
      : scope === "completed"
        ? downloads.filter((item) => item.status === "completed").length
        : scope === "failed"
          ? downloads.filter((item) => item.status === "failed").length
          : downloads.filter(historical).length;
  const clearScope = (scope) => {
    const ids =
      scope === "selected"
        ? downloads
            .filter((item) => selected.has(item.id) && historical(item))
            .map((item) => item.id)
        : [];
    const count = historyCount(scope);
    const labels = {
      selected: "downloads.history.confirmSelected",
      completed: "downloads.history.confirmCompleted",
      failed: "downloads.history.confirmFailed",
      all: "downloads.history.confirmAll",
    };
    setConfirm({
      title: t("downloads.history.title"),
      description: t("downloads.history.description"),
      note: t("downloads.history.filesNote"),
      label: count ? t(labels[scope]) : t("downloads.history.nothing"),
      destructive: scope === "all",
      onConfirm: async () => {
        if (!count) return;
        const removed = await api.invoke("download:clear-history", {
          scope,
          ids,
        });
        exitSelection();
        useUIStore
          .getState()
          .notify(t("downloads.history.removed", { count: removed }));
      },
    });
  };
  const removeSelected = () => {
    setConfirm({
      title: t("downloads.removeSelectedTitle"),
      description: t("downloads.removeSelectedDescription", {
        count: selected.size,
      }),
      label: t("downloads.removeSelectedConfirm", { count: selected.size }),
      destructive: true,
      onConfirm: async () => {
        const removed = await api.invoke("download:clear-history", {
          scope: "selected",
          ids: [...selected],
          stopUnfinished: true,
        });
        exitSelection();
        useUIStore
          .getState()
          .notify(t("downloads.history.removed", { count: removed }));
      },
    });
  };
  const historyActions = [
    ["selected", "downloads.history.selected", historyCount("selected")],
    ["completed", "downloads.history.completed", historyCount("completed")],
    ["failed", "downloads.history.failed", historyCount("failed")],
    ["all", "downloads.history.all", historyCount("all")],
  ].map(([scope, key, count]) => ({
    icon: LuTrash2,
    label: t(key, { count }),
    disabled: !count,
    danger: scope === "all",
    run: () => clearScope(scope),
  }));
  const pauseAll = async () => {
    setBulkBusy(true);
    try {
      await Promise.all(
        base
          .filter(
            (item) =>
              active(item) || ["queued", "retrying"].includes(item.status),
          )
          .map((item) => api.invoke("download:pause", item.id)),
      );
    } catch (error) {
      useUIStore.getState().notify(errorMessage(error), "error");
    } finally {
      setBulkBusy(false);
    }
  };
  // Inactive tabs stay mounted so their filters and selection survive, but
  // their rows are not reconciled on every progress tick.
  if (!visible) return <div className="page downloads-page" hidden />;
  return (
    <div className="page downloads-page">
      <PageHeader eyebrow={t("downloads.eyebrow")} title={title} />
      <div className={`library-panel ${rows.length ? "" : "is-empty"}`}>
        {showLibraryToolbar && (
          <div className="library-toolbar">
            <div className="search-input">
              <LuSearch />
              <input
                aria-label={t("downloads.searchLabel")}
                placeholder={t("downloads.searchPlaceholder")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <IconButton
                  label={t("downloads.clearSearch")}
                  onClick={() => setSearch("")}
                >
                  <LuX />
                </IconButton>
              )}
            </div>
            <div
              className="category-tabs"
              role="group"
              aria-label={t("downloads.filterType")}
            >
              {[
                ["All files", "downloads.allFiles"],
                ["Video", "downloads.category.video"],
                ["Audio", "downloads.category.audio"],
                ["Archives", "downloads.category.archives"],
                ["Documents", "downloads.category.documents"],
                ["Applications", "downloads.category.applications"],
                ["Images", "downloads.category.images"],
                ["Other", "downloads.category.other"],
              ]
                .filter(
                  ([name]) =>
                    [
                      "All files",
                      "Video",
                      "Audio",
                      "Archives",
                      "Documents",
                    ].includes(name) ||
                    base.some((item) => item.category === name),
                )
                .map(([name, key]) => (
                  <button
                    className={category === name ? "selected" : ""}
                    key={name}
                    onClick={() => setCategory(name)}
                  >
                    {t(key)}
                    {name === "All files" && <span>{base.length}</span>}
                  </button>
                ))}
            </div>
            <div className="toolbar-actions">
              <Button
                variant="ghost"
                icon={LuPause}
                busy={bulkBusy}
                disabled={
                  !base.some(
                    (item) =>
                      active(item) ||
                      ["queued", "retrying"].includes(item.status),
                  )
                }
                onClick={pauseAll}
              >
                {t("downloads.pauseAll")}
              </Button>
              <Select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
                aria-label={t("downloads.sortLabel")}
              >
                <option value="latest">{t("downloads.sort.latest")}</option>
                <option value="name">{t("downloads.sort.name")}</option>
                <option value="size">{t("downloads.sort.size")}</option>
              </Select>
              <Button
                variant="ghost"
                icon={LuTrash2}
                disabled={!historyCount("all")}
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  setHistoryMenu({
                    x: box.right - 250,
                    y: box.bottom + 6,
                  });
                }}
              >
                {t("downloads.clearHistory")}
              </Button>
            </div>
          </div>
        )}
        {selectionMode && (
          <div className="selection-bar" role="status">
            <LuSquareCheck />
            <strong>
              {t("downloads.selectedCount", { count: selected.size })}
            </strong>
            <Button variant="ghost" icon={LuTrash2} onClick={removeSelected}>
              {t("downloads.removeSelected")}
            </Button>
            <Button variant="ghost" icon={LuX} onClick={exitSelection}>
              {t("downloads.cancelSelection")}
            </Button>
          </div>
        )}
        {rows.length > 0 && (
          <div className="list-heading">
            <button
              type="button"
              className={`select-all-check ${selectState === "all" ? "selected" : ""}`}
              role="checkbox"
              aria-checked={
                selectState === "some" ? "mixed" : selectState === "all"
              }
              aria-label={t("downloads.selectAll")}
              disabled={!rows.length}
              onClick={selectAll}
            >
              {selectState === "some" ? (
                <LuMinus />
              ) : selectState === "all" ? (
                <LuCheck />
              ) : null}
            </button>
            <span className="heading-name">{t("downloads.fileName")}</span>
            <span className="heading-transfer">{t("downloads.transfer")}</span>
            <span className="heading-status">{t("downloads.status")}</span>
          </div>
        )}
        <div
          role="list"
          aria-label={title}
          className={`download-list ${rows.length > 150 ? "virtualized" : ""}`}
        >
          {rows.length ? (
            rows.length > 150 ? (
              <VirtualList
                items={rows}
                getKey={(item) => item.id}
                estimate={112}
                className="download-window"
                renderItem={(item, index) => (
                  <MemoDownloadRow
                    item={item}
                    index={index}
                    selected={selected.has(item.id)}
                    selectionMode={selectionMode}
                    onSelect={select}
                    onConfirm={setConfirm}
                  />
                )}
              />
            ) : (
              rows.map((item, index) => (
                <MemoDownloadRow
                  key={item.id}
                  item={item}
                  index={index}
                  selected={selected.has(item.id)}
                  selectionMode={selectionMode}
                  onSelect={select}
                  onConfirm={setConfirm}
                />
              ))
            )
          ) : (
            <div className="empty-state">
              <div className="empty-icon">
                {filter === "torrent" ? (
                  <LuMagnet />
                ) : filter === "completed" ? (
                  <LuCheck />
                ) : filter === "failed" ? (
                  <LuCircleAlert />
                ) : filter === "paused" ? (
                  <LuPause />
                ) : (
                  <LuArrowDownToLine />
                )}
              </div>
              <h2>{t(emptyTitleKey)}</h2>
              <p>{t(emptyDescriptionKey)}</p>
              {!search && category === "All files" && (
                <div className="empty-actions">
                  <Button
                    icon={LuPlus}
                    variant="primary"
                    onClick={() =>
                      useUIStore
                        .getState()
                        .setAddModal(
                          filter === "torrent" ? { torrent: true } : {},
                        )
                    }
                  >
                    {filter === "torrent"
                      ? t("downloads.addTorrentEmpty")
                      : filter === "all" && downloads.length === 0
                        ? t("downloads.addFirst")
                        : t("downloads.newDownload")}
                  </Button>
                </div>
              )}
              {!search && category === "All files" && (
                <Button
                  className="clipboard-empty-action"
                  variant="ghost"
                  icon={LuClipboardPaste}
                  onClick={() =>
                    window.dispatchEvent(new Event("getanny:paste-clipboard"))
                  }
                >
                  {t("downloads.pasteClipboard")}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="list-footer">
          <span>
            {t("downloads.count", {
              shown: rows.length,
              total: base.length,
            })}
          </span>
          <span>
            {rows.length
              ? t("downloads.transferred", {
                  size: bytes(
                    rows.reduce((sum, item) => sum + item.downloadedSize, 0),
                  ),
                })
              : t("downloads.localOnly")}
          </span>
        </div>
      </div>
      {filter === "torrent" && base.length > 0 && (
        <p className="page-footnote">
          <LuInfo />
          {t("downloads.torrentNote")}
        </p>
      )}
      {historyMenu && (
        <ContextMenu
          position={historyMenu}
          actions={historyActions}
          onClose={() => setHistoryMenu(null)}
        />
      )}
      {confirm && (
        <ConfirmDialog {...confirm} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}
