import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  LuAudioLines,
  LuFilm,
  LuSearch,
  LuArrowDownToLine,
  LuCheck,
  LuLink,
  LuInfo,
  LuExternalLink,
  LuSparkles,
  LuImage,
  LuFileText,
  LuTags,
  LuCaptions,
  LuX,
} from "react-icons/lu";
import { api, errorMessage } from "../api";
import {
  Button,
  ErrorBanner,
  Field,
  FolderField,
  IconButton,
  PageHeader,
  Select,
} from "../components/ui";
import MediaMetadata from "../components/MediaMetadata";
import VideoSegmentSelector from "../components/VideoSegmentSelector";
import VirtualList from "../components/VirtualList";
import useSettingsStore from "../stores/useSettingsStore";
import useUIStore from "../stores/useUIStore";
import { bytes, duration } from "../utils/format";
import { useI18n } from "../i18n/useI18n";
export default function MediaPage({ tools }) {
  const { t } = useI18n();
  const url = useUIStore((state) => state.mediaUrl),
    setUrl = useUIStore((state) => state.setMediaUrl),
    mediaRequest = useUIStore((state) => state.mediaRequest);
  const settings = useSettingsStore((state) => state.settings);
  const [result, setResult] = useState(null),
    [selected, setSelected] = useState(null),
    [group, setGroup] = useState("video"),
    [folder, setFolder] = useState(settings.defaultDownloadPath || ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [adding, setAdding] = useState(false),
    [section, setSection] = useState("media"),
    [withSubtitles, setWithSubtitles] = useState(false),
    [subtitleLanguage, setSubtitleLanguage] = useState(""),
    [subtitleFormat, setSubtitleFormat] = useState("vtt"),
    [segment, setSegment] = useState(null);
  const [playlist, setPlaylist] = useState(null),
    [playlistSelection, setPlaylistSelection] = useState(() => new Set()),
    [playlistQuality, setPlaylistQuality] = useState("1080"),
    [playlistBusy, setPlaylistBusy] = useState(false);
  const playlistGetKey = useCallback((item) => item.url, []);
  const renderPlaylistEntry = useCallback(
    (entry, index) => (
      <label className="playlist-row">
        <input
          type="checkbox"
          checked={playlistSelection.has(index)}
          onChange={() =>
            setPlaylistSelection((old) => {
              const next = new Set(old);
              if (next.has(index)) next.delete(index);
              else next.add(index);
              return next;
            })
          }
        />
        <span>{entry.title}</span>
        <small>{entry.duration ? duration(entry.duration) : ""}</small>
      </label>
    ),
    [playlistSelection],
  );
  const generation = useRef(0),
    lastAuto = useRef(0);
  const clearLink = () => {
    // Invalidate any in-flight analysis so its result cannot repopulate the
    // input or the format list after the user cleared the link.
    generation.current++;
    lastAuto.current = 0;
    setUrl("");
    setResult(null);
    setSelected(null);
    setSegment(null);
    setError("");
    setBusy(false);
    document.getElementById("media-url")?.focus();
  };
  const analyze = async (event) => {
    event?.preventDefault();
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setResult(null);
    setSelected(null);
    setSegment(null);
    setSection("media");
    setWithSubtitles(false);
    try {
      if (!/^https?:\/\//i.test(url.trim()))
        throw new Error(t("media.invalidUrl"));
      const info = await api.invoke("media:get-formats", url.trim());
      if (current !== generation.current) return;
      setResult(info);
      setSubtitleLanguage(info.subtitles[0]?.id || "");
      const video = info.formats.filter((format) => format.group === "video");
      const preferred =
        video.find((format) => format.hasAudio) || video[0] || info.formats[0];
      setGroup(preferred?.group || "video");
      setSelected(preferred?.formatId || null);
      if (!info.formats.length) setError(t("media.noFormats"));
    } catch (error) {
      if (current === generation.current) setError(errorMessage(error));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  };
  const loadPlaylist = async () => {
    setPlaylistBusy(true);
    setError("");
    try {
      const result = await api.invoke("media:get-playlist", url.trim());
      setPlaylist(result);
      setPlaylistSelection(new Set(result.entries.map((_, index) => index)));
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };
  const queuePlaylist = async () => {
    if (!playlistSelection.size) return;
    setPlaylistBusy(true);
    setError("");
    let queued = 0;
    let skipped = 0;
    try {
      for (const index of playlistSelection) {
        const entry = playlist.entries[index];
        const info = await api.invoke("media:get-formats", entry.url);
        const videos = info.formats.filter(
          (format) => format.group === "video" && format.ext === "mp4",
        );
        const cap =
          playlistQuality === "highest" ? Infinity : Number(playlistQuality);
        const format =
          videos.find((item) => (item.height || 0) <= cap) || videos.at(-1);
        if (!format) {
          skipped++;
          continue;
        }
        await api.invoke("media:download", {
          analysisId: info.analysisId,
          formatId: format.formatId,
          ...(folder !== settings.defaultDownloadPath
            ? { savePath: folder }
            : {}),
        });
        queued++;
      }
      useUIStore
        .getState()
        .notify(
          t("media.playlistQueued", { count: queued }) +
            (skipped
              ? ` ${t("media.playlistSkipped", { count: skipped })}`
              : ""),
        );
      useUIStore.getState().setActiveTab("all");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setPlaylistBusy(false);
    }
  };
  useEffect(() => {
    if (mediaRequest && lastAuto.current !== mediaRequest && url) {
      lastAuto.current = mediaRequest;
      analyze();
    }
  }, [mediaRequest]);
  useEffect(
    () => () => {
      generation.current++;
      lastAuto.current = 0;
    },
    [],
  );
  const format = result?.formats.find((item) => item.formatId === selected);
  const partialSegment = group === "video" && !!segment;
  const add = async () => {
    setAdding(true);
    setError("");
    try {
      await api.invoke("media:download", {
        analysisId: result.analysisId,
        formatId: format.formatId,
        ...(segment && group === "video" ? { segment } : {}),
        ...(!segment && withSubtitles && subtitleLanguage
          ? {
              subtitle: {
                languageId: subtitleLanguage,
                format: subtitleFormat,
              },
            }
          : {}),
        ...(folder !== settings.defaultDownloadPath
          ? { savePath: folder }
          : {}),
      });
      useUIStore
        .getState()
        .notify(
          partialSegment
            ? t("media.segment.queued")
            : withSubtitles
              ? t("media.addedWithSubtitles")
              : t("media.added"),
        );
      useUIStore.getState().setActiveTab("all");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setAdding(false);
    }
  };
  return (
    <div className="page media-page">
      <PageHeader eyebrow={t("media.eyebrow")} title={t("media.title")}>
        <span className={`engine-label ${tools.ytdlp ? "ready" : ""}`}>
          <span className="status-dot" />
          {tools.ytdlp ? t("media.engineReady") : t("media.engineMissing")}
        </span>
      </PageHeader>
      {!tools.ytdlp && (
        <ErrorBanner>{t("media.engineMissingBanner")}</ErrorBanner>
      )}
      <form className="media-search-panel" onSubmit={analyze}>
        <Field label={t("media.pageLabel")} id="media-url">
          <div className="media-search">
            <LuLink />
            <div className="media-field">
              <input
                id="media-url"
                type="url"
                required
                placeholder={t("media.urlPlaceholder")}
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  setPlaylist(null);
                  setPlaylistSelection(new Set());
                  if (result) {
                    setResult(null);
                    setSelected(null);
                  }
                }}
                spellCheck="false"
                autoComplete="off"
              />
              {url && (
                <button
                  type="button"
                  className="clear-link"
                  title={t("media.clearLink")}
                  aria-label={t("media.clearLink")}
                  onClick={clearLink}
                >
                  <LuX />
                </button>
              )}
            </div>
            <Button
              type="submit"
              icon={LuSearch}
              variant="primary"
              busy={busy}
              disabled={!url.trim() || !tools.ytdlp}
            >
              {t("media.analyze")}
            </Button>
            <Button
              type="button"
              icon={LuFilm}
              busy={playlistBusy}
              disabled={!url.trim() || !tools.ytdlp}
              onClick={loadPlaylist}
            >
              {t("media.loadPlaylist")}
            </Button>
          </div>
        </Field>
        <div className="media-search-note">
          <span>{t("media.poweredBy")}</span>
          <span>{t("media.disclaimer")}</span>
        </div>
      </form>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {playlist && (
        <section className="playlist-panel">
          <div className="playlist-heading">
            <div>
              <h2>{playlist.title}</h2>
              <p>
                {t("media.playlistCount", { count: playlist.entries.length })}
              </p>
            </div>
            <Button
              variant="primary"
              busy={playlistBusy}
              disabled={!playlistSelection.size}
              onClick={queuePlaylist}
            >
              {t("media.queueSelected", { count: playlistSelection.size })}
            </Button>
          </div>
          <div className="playlist-toolbar">
            <Button
              variant="ghost"
              onClick={() =>
                setPlaylistSelection(
                  new Set(playlist.entries.map((_, index) => index)),
                )
              }
            >
              {t("media.selectAll")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setPlaylistSelection(new Set())}
            >
              {t("media.deselectAll")}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                setPlaylistSelection(
                  (old) =>
                    new Set(
                      playlist.entries
                        .map((_, index) => (!old.has(index) ? index : null))
                        .filter((index) => index !== null),
                    ),
                )
              }
            >
              {t("media.invertSelection")}
            </Button>
            <label>
              {t("media.applyQuality")}{" "}
              <Select
                value={playlistQuality}
                onChange={(event) => setPlaylistQuality(event.target.value)}
              >
                <option value="1080">1080p MP4</option>
                <option value="720">720p MP4</option>
                <option value="480">480p MP4</option>
                <option value="highest">Highest available</option>
              </Select>
            </label>
          </div>
          <VirtualList
            items={playlist.entries}
            getKey={playlistGetKey}
            estimate={54}
            className="playlist-list"
            renderItem={renderPlaylistEntry}
          />
        </section>
      )}
      {busy && (
        <div className="analysis-loading">
          <div className="loader-ring" />
          <h2>{t("media.loadingTitle")}</h2>
          <p>{t("media.loadingText")}</p>
          <span>{t("media.loadingNote")}</span>
        </div>
      )}
      {!busy && result && (
        <section className="media-result">
          <div className="media-result-header">
            {result.thumbnail ? (
              <img
                className="media-thumbnail"
                src={result.thumbnail}
                alt={t("media.previewAlt")}
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            ) : (
              <div className="media-thumbnail fallback">
                <LuFilm />
              </div>
            )}
            <div>
              <span className="eyebrow">
                {result.extractor || t("media.source")}{" "}
                {result.duration ? `· ${duration(result.duration)}` : ""}
              </span>
              <h2>{result.title}</h2>
              <p>{t("media.formatsCount", { count: result.formats.length })}</p>
            </div>
          </div>
          <div
            className="media-section-tabs"
            role="tablist"
            aria-label={t("media.toolsLabel")}
          >
            {[
              ["media", LuFilm, "media.tab.media", result.formats.length],
              [
                "thumbnails",
                LuImage,
                "media.tab.thumbnails",
                result.thumbnails.length,
              ],
              ["description", LuFileText, "media.tab.description", null],
              ["tags", LuTags, "media.tab.tags", result.tags.length],
              [
                "subtitles",
                LuCaptions,
                "media.tab.subtitles",
                result.subtitles.length,
              ],
            ].map(([id, Icon, labelKey, count]) => (
              <button
                key={id}
                role="tab"
                aria-selected={section === id}
                onClick={() => setSection(id)}
              >
                <Icon />
                {t(labelKey)}
                {count != null && <span>{count}</span>}
              </button>
            ))}
          </div>
          {section === "media" && (
            <div className="media-result-body">
              <div className="format-panel">
                <div
                  className="format-tabs"
                  role="tablist"
                  aria-label={t("media.formatTypeLabel")}
                >
                  {[
                    ["video", LuFilm, "media.video"],
                    ["audio", LuAudioLines, "media.audioOnly"],
                  ].map(([key, Icon, labelKey]) => (
                    <button
                      role="tab"
                      aria-selected={group === key}
                      key={key}
                      onClick={() => {
                        setGroup(key);
                        if (key !== "video") setSegment(null);
                        const first = result.formats.find(
                          (item) => item.group === key,
                        );
                        setSelected(first?.formatId || null);
                      }}
                    >
                      <Icon />
                      {t(labelKey)}
                      <span>
                        {
                          result.formats.filter((item) => item.group === key)
                            .length
                        }
                      </span>
                    </button>
                  ))}
                </div>
                <div className="format-heading">
                  <span>{t("media.qualityFormat")}</span>
                  <span>{t("media.size")}</span>
                </div>
                <div
                  className="format-list"
                  role="radiogroup"
                  aria-label={t("media.formatGroup", {
                    group: t(
                      group === "audio" ? "media.audioOnly" : "media.video",
                    ),
                  })}
                >
                  {result.formats
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <label
                        key={item.formatId}
                        className={`format-option ${selected === item.formatId ? "selected" : ""} ${item.mergeAudio && !result.tools.ffmpeg ? "unavailable" : ""}`}
                      >
                        <input
                          type="radio"
                          name="media-format"
                          value={item.formatId}
                          checked={selected === item.formatId}
                          disabled={item.mergeAudio && !result.tools.ffmpeg}
                          onChange={() => setSelected(item.formatId)}
                        />
                        <span className="format-radio">
                          <LuCheck />
                        </span>
                        <div className="format-description">
                          <strong>
                            {item.quality} <span>{item.ext.toUpperCase()}</span>
                            {item.fps > 30 && <span>{item.fps} FPS</span>}
                          </strong>
                          <small>
                            {[
                              item.resolution,
                              item.vcodec?.split(".")[0],
                              item.acodec?.split(".")[0],
                              item.language,
                              item.mergeAudio
                                ? t("media.audioMerged")
                                : item.hasVideo
                                  ? item.audioUnknown
                                    ? t("media.audioNotReported")
                                    : item.hasAudio
                                      ? t("media.videoAudio")
                                      : t("media.videoOnlyNoAudio")
                                  : item.audioChannels
                                    ? t("media.channels", {
                                        count: item.audioChannels,
                                      })
                                    : t("media.audioStream"),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </div>
                        <span className="format-size">
                          {item.filesize
                            ? `${item.approximateSize ? "≈ " : ""}${bytes(item.filesize)}`
                            : t("media.unknownSize")}
                          {item.mergeAudio && item.filesize ? (
                            <small>{t("media.plusAudio")}</small>
                          ) : null}
                        </span>
                      </label>
                    ))}
                  {!result.formats.some((item) => item.group === group) && (
                    <div className="format-empty">
                      {t("media.noGroupFormats", {
                        group: t(
                          group === "audio"
                            ? "media.groupAudio"
                            : "media.groupVideo",
                        ),
                      })}
                    </div>
                  )}
                </div>
                <p className="format-footnote">
                  <LuInfo />
                  {t("media.formatFootnote")}
                </p>
              </div>
              <aside className="media-output">
                <div className="eyebrow">{t("media.yourDownload")}</div>
                <div className="selected-quality">
                  {format?.quality || t("media.chooseFormat")}
                  <span>{format?.ext.toUpperCase()}</span>
                </div>
                <dl>
                  <div>
                    <dt>{t("media.content")}</dt>
                    <dd>
                      {format?.group === "audio"
                        ? t("media.audioOnlyContent")
                        : format?.audioUnknown
                          ? t("media.tracksUnreported")
                          : format?.hasAudio || format?.mergeAudio
                            ? t("media.videoWithAudio")
                            : t("media.videoOnly")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("media.audio")}</dt>
                    <dd>
                      {format?.mergeAudio
                        ? t("media.mergedFfmpeg")
                        : format?.hasAudio
                          ? t("media.included")
                          : format?.audioUnknown
                            ? t("media.audioNotReported")
                            : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("media.fileSize")}</dt>
                    <dd>
                      {format?.filesize
                        ? `${format.approximateSize ? "≈ " : ""}${bytes(format.filesize)}${format.mergeAudio ? ` ${t("media.plusAudio")}` : ""}`
                        : t("common.notProvided")}
                    </dd>
                  </div>
                </dl>
                <FolderField
                  value={folder}
                  onChange={setFolder}
                  id="media-folder"
                />
                {group === "video" &&
                  result.duration >= 1 &&
                  !result.live &&
                  result.tools.ffmpeg && (
                    <VideoSegmentSelector
                      duration={result.duration}
                      value={segment}
                      onChange={(next) => {
                        setSegment(next);
                        if (next) setWithSubtitles(false);
                      }}
                    />
                  )}
                {group === "video" && (result.live || !result.duration) && (
                  <div className="segment-unavailable">
                    {result.live
                      ? t("media.segment.liveUnavailable")
                      : t("media.segment.durationUnavailable")}
                  </div>
                )}
                {group === "video" &&
                  result.duration > 0 &&
                  result.duration < 1 && (
                    <div className="segment-unavailable">
                      {t("media.segment.durationUnavailable")}
                    </div>
                  )}
                {group === "video" &&
                  result.duration >= 1 &&
                  !result.live &&
                  !result.tools.ffmpeg && (
                    <div className="segment-unavailable">
                      {t("media.segment.ffmpegUnavailable")}
                    </div>
                  )}
                {group === "video" && result.subtitles.length > 0 && (
                  <div className="subtitle-companion">
                    <label>
                      <input
                        type="checkbox"
                        checked={withSubtitles}
                        disabled={partialSegment}
                        onChange={(event) =>
                          setWithSubtitles(event.target.checked)
                        }
                      />
                      {partialSegment
                        ? t("media.segment.subtitleUnavailable")
                        : t("media.includeSubtitles")}
                    </label>
                    {withSubtitles && (
                      <div>
                        <Select
                          aria-label={t("media.subtitleLanguage")}
                          value={subtitleLanguage}
                          onChange={(event) =>
                            setSubtitleLanguage(event.target.value)
                          }
                        >
                          {result.subtitles.map((subtitle) => (
                            <option key={subtitle.id} value={subtitle.id}>
                              {subtitle.name}
                              {subtitle.automatic ? t("media.autoSuffix") : ""}
                            </option>
                          ))}
                        </Select>
                        <Select
                          aria-label={t("media.subtitleFormat")}
                          value={subtitleFormat}
                          onChange={(event) =>
                            setSubtitleFormat(event.target.value)
                          }
                        >
                          <option value="vtt">VTT</option>
                          <option value="srt">SRT</option>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
                <Button
                  variant="primary"
                  icon={LuArrowDownToLine}
                  busy={adding}
                  disabled={
                    !format ||
                    !folder ||
                    (withSubtitles && !partialSegment && !subtitleLanguage) ||
                    (format.mergeAudio && !result.tools.ffmpeg)
                  }
                  onClick={add}
                >
                  {t(
                    partialSegment
                      ? "media.segment.download"
                      : group === "audio"
                        ? "media.downloadAudio"
                        : "media.downloadVideo",
                  )}
                </Button>
                <p>
                  {partialSegment
                    ? t("media.segment.progressNote")
                    : t("media.progressNote")}
                </p>
                {!result.tools.ffmpeg && (
                  <div className="small-warning">
                    {t("media.ffmpegMissing")}
                  </div>
                )}
              </aside>
            </div>
          )}
          {section !== "media" && (
            <MediaMetadata
              section={section}
              result={result}
              savePath={
                folder !== settings.defaultDownloadPath ? folder : undefined
              }
              onError={setError}
            />
          )}
        </section>
      )}
      {!busy && !result && !error && (
        <div className="media-intro">
          <div className="media-intro-icon">
            <LuFilm />
            <LuAudioLines />
          </div>
          <h2>{t("media.introTitle")}</h2>
          <p>{t("media.introDescription")}</p>
          <div className="media-capabilities">
            <span>
              <LuCheck />
              {t("media.capVideoAudio")}
            </span>
            <span>
              <LuCheck />
              {t("media.capAudioOnly")}
            </span>
            <span>
              <LuCheck />
              {t("media.capProgress")}
            </span>
          </div>
          <p className="media-limit-note">
            {t("media.availabilityNote")}
            <br />
            {t("media.privateNote")}
          </p>
        </div>
      )}
    </div>
  );
}
