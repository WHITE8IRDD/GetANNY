import { useEffect, useRef, useState } from "react";
import { LuRotateCcw } from "react-icons/lu";
import { duration } from "../utils/format";
import { useI18n } from "../i18n/useI18n";

function formatTime(value, showHours = false) {
  const whole = Math.max(0, Math.floor(value));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  if (showHours || hours)
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function parseTime(raw) {
  const parts = String(raw).trim().split(":");
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    parts.some((part) => !/^\d+$/.test(part))
  )
    return null;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part > 59)) return null;
  return numbers.length === 2
    ? numbers[0] * 60 + numbers[1]
    : numbers[0] * 3600 + numbers[1] * 60 + numbers[2];
}

function normalize(value, total) {
  if (!value) return { start: 0, end: total };
  return {
    start: Math.max(0, Math.min(total - 1, value.start)),
    end: Math.max(1, Math.min(total, value.end)),
  };
}

export default function VideoSegmentSelector({
  duration: totalDuration,
  value,
  onChange,
}) {
  const { t } = useI18n();
  const total = Math.floor(totalDuration);
  const range = normalize(value, total);
  const track = useRef(null);
  const drag = useRef(null);
  const pending = useRef(null);
  const frame = useRef(0);
  const startInput = useRef(null);
  const endInput = useRef(null);
  const [drafts, setDrafts] = useState({
    start: formatTime(range.start, total >= 3600),
    end: formatTime(range.end, total >= 3600),
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (document.activeElement !== startInput.current)
      setDrafts((old) => ({
        ...old,
        start: formatTime(range.start, total >= 3600),
      }));
    if (document.activeElement !== endInput.current)
      setDrafts((old) => ({
        ...old,
        end: formatTime(range.end, total >= 3600),
      }));
  }, [range.start, range.end, total]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const emitRange = (next) => {
    const normalized = {
      start: Math.round(next.start),
      end: Math.round(next.end),
    };
    if (normalized.start <= 0 && normalized.end >= total) onChange(null);
    else onChange(normalized);
  };

  const beginDrag = (handle, event) => {
    event.preventDefault();
    const rect = track.current?.getBoundingClientRect();
    if (!rect?.width) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      handle,
      pointer: event.pointerId,
      x: event.clientX,
      value: range[handle],
      width: rect.width,
      fine: event.shiftKey,
      range,
    };
  };

  const moveDrag = (event) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const scale = current.fine || event.shiftKey ? 0.1 : 1;
    const delta = ((event.clientX - current.x) / current.width) * total * scale;
    const minimum = 1;
    const next = { ...current.range };
    if (current.handle === "start")
      next.start = Math.max(
        0,
        Math.min(next.end - minimum, current.value + delta),
      );
    else
      next.end = Math.min(
        total,
        Math.max(next.start + minimum, current.value + delta),
      );
    pending.current = next;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (pending.current) emitRange(pending.current);
    });
  };

  const endDrag = (event) => {
    if (!drag.current || drag.current.pointer !== event.pointerId) return;
    drag.current = null;
    if (pending.current) emitRange(pending.current);
    pending.current = null;
  };

  const keyboardMove = (handle, event) => {
    const step = event.shiftKey
      ? 10
      : event.key === "PageUp" || event.key === "PageDown"
        ? 30
        : 1;
    let delta = 0;
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowDown" ||
      event.key === "PageDown"
    )
      delta = -step;
    else if (
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "PageUp"
    )
      delta = step;
    else if (event.key === "Home") delta = -total;
    else if (event.key === "End") delta = total;
    else return;
    event.preventDefault();
    const next = { ...range };
    if (handle === "start")
      next.start = Math.max(0, Math.min(next.end - 1, range.start + delta));
    else
      next.end = Math.min(total, Math.max(next.start + 1, range.end + delta));
    emitRange(next);
  };

  const commitInput = (which) => {
    const parsed = parseTime(drafts[which]);
    const other = which === "start" ? range.end : range.start;
    let message = "";
    if (parsed == null) message = t("media.segment.invalidTime");
    else if (parsed > total) message = t("media.segment.outOfRange");
    else if (which === "start" ? parsed > other - 1 : parsed < other + 1)
      message = t("media.segment.rangeError");
    setErrors((old) => ({ ...old, [which]: message }));
    if (message) return;
    const next = { ...range, [which]: parsed };
    emitRange(next);
    setDrafts((old) => ({
      ...old,
      [which]: formatTime(parsed, total >= 3600),
    }));
  };

  const left = (range.start / total) * 100;
  const width = ((range.end - range.start) / total) * 100;
  return (
    <section className="media-segment" aria-label={t("media.segment.title")}>
      <div className="media-segment-heading">
        <div>
          <strong>{t("media.segment.title")}</strong>
          <small>{t("media.segment.description")}</small>
        </div>
        <button
          type="button"
          className="segment-reset"
          onClick={() => {
            onChange(null);
            setErrors({});
          }}
        >
          <LuRotateCcw /> {t("media.segment.fullVideo")}
        </button>
      </div>
      <div className="segment-track-wrap">
        <div className="segment-track" ref={track}>
          <div
            className="segment-selected"
            style={{ left: `${left}%`, width: `${width}%` }}
          />
          {["start", "end"].map((handle) => (
            <button
              type="button"
              key={handle}
              className={`segment-handle ${handle}`}
              style={{ left: `${(range[handle] / total) * 100}%` }}
              role="slider"
              aria-label={t(`media.segment.${handle}`)}
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={Math.round(range[handle])}
              aria-valuetext={formatTime(range[handle], total >= 3600)}
              onPointerDown={(event) => beginDrag(handle, event)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={(event) => keyboardMove(handle, event)}
            />
          ))}
        </div>
        <div className="segment-timeline-labels">
          <span>00:00</span>
          <span>{duration(total)}</span>
        </div>
      </div>
      <div className="segment-fields">
        {["start", "end"].map((which) => {
          const input = which === "start" ? startInput : endInput;
          return (
            <label key={which}>
              <span>{t(`media.segment.${which}`)}</span>
              <input
                ref={input}
                value={drafts[which]}
                aria-invalid={!!errors[which]}
                aria-describedby={
                  errors[which] ? `segment-${which}-error` : undefined
                }
                inputMode="numeric"
                onChange={(event) =>
                  setDrafts((old) => ({ ...old, [which]: event.target.value }))
                }
                onBlur={() => commitInput(which)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
              {errors[which] && (
                <small id={`segment-${which}-error`} className="segment-error">
                  {errors[which]}
                </small>
              )}
            </label>
          );
        })}
        <div className="segment-length">
          <span>{t("media.segment.selectedLength")}</span>
          <strong>{duration(Math.round(range.end - range.start))}</strong>
        </div>
      </div>
      <small className="segment-precision-note">
        {t("media.segment.precision")}
      </small>
    </section>
  );
}

export { formatTime, parseTime };
