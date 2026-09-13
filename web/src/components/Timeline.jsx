import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ZoomIn, ZoomOut, Crosshair, Maximize, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { EVENT_LABELS, LABEL_META, labelTitle } from '../lib/labels';
import { timecode, seconds2 } from '../lib/format';
import { seekVideo } from '../lib/videoRef';

const LANE_H = 24;
const GUTTER = 148;
const RULER_H = 28;

/** Choose a ruler interval that yields readable, round tick labels at any zoom. */
function tickStep(pxPerSec) {
  const targetPx = 90;
  const raw = targetPx / pxPerSec;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900];
  return steps.find((s) => s >= raw) ?? 1800;
}

export default function Timeline({ events, duration, onScrub, onContextMenu }) {
  const currentTime = useStore((s) => s.currentTime);
  const clipName = useStore((s) => s.project?.video?.filename);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const selectRange = useStore((s) => s.selectRange);
  const clearSelection = useStore((s) => s.clearSelection);
  const deleteSelection = useStore((s) => s.deleteSelection);
  const select = useStore((s) => s.select);
  const seek = useStore((s) => s.seek);
  const updateEvent = useStore((s) => s.updateEvent);

  const scrollRef = useRef(null);
  const trackRef = useRef(null);
  const gutterRef = useRef(null);
  const [fitted, setFitted] = useState(false);
  const [hoverLane, setHoverLane] = useState(null);
  const [zoom, setZoom] = useState(12); // px per second
  const [drag, setDrag] = useState(null);
  const [band, setBand] = useState(null); // shift-drag span, in seconds
  const [follow, setFollow] = useState(true);

  // Only render lanes for labels that actually occur — an empty lane is noise.
  const lanes = useMemo(() => {
    const present = new Set(events.map((e) => e.type));
    return EVENT_LABELS.filter((l) => present.has(l));
  }, [events]);

  const width = Math.max(240, duration * zoom);
  const laneIndex = useMemo(() => Object.fromEntries(lanes.map((l, i) => [l, i])), [lanes]);
  const laneCounts = useMemo(() => {
    const c = {};
    for (const e of events) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [events]);

  // A new clip gets a fresh view: scrolled to the start and re-fitted to its
  // own duration, rather than inheriting where the last clip was left.
  useEffect(() => {
    setFitted(false);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [clipName]);

  // Fit the whole video into view the first time we learn its duration —
  // an arbitrary default zoom leaves either dead space or an unusable scroll.
  useEffect(() => {
    if (fitted || !duration || !scrollRef.current) return;
    const w = scrollRef.current.clientWidth;
    if (w > 0) {
      setZoom(Math.max(2, (w - 24) / duration));
      setFitted(true);
    }
  }, [duration, fitted]);

  const timeToX = useCallback((t) => t * zoom, [zoom]);
  const xToTime = useCallback(
    (x) => Math.max(0, Math.min(duration, x / zoom)),
    [zoom, duration],
  );

  // Keep the playhead in view while playing, unless the user is dragging.
  useEffect(() => {
    if (!follow || drag) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = timeToX(currentTime);
    const { scrollLeft, clientWidth } = el;
    if (x < scrollLeft + 80 || x > scrollLeft + clientWidth - 120) {
      el.scrollTo({ left: Math.max(0, x - clientWidth * 0.35), behavior: 'smooth' });
    }
  }, [currentTime, follow, drag, timeToX]);

  const [scrubbing, setScrubbing] = useState(false);
  // Pointer moves arrive faster than frames can be decoded. Keep only the most
  // recent target and act on it once per animation frame.
  const pendingRef = useRef(null);
  const rafRef = useRef(0);

  const flushScrub = useCallback(() => {
    rafRef.current = 0;
    const t = pendingRef.current;
    if (t === null) return;
    pendingRef.current = null;
    seekVideo(t);
    // Keep the playhead and readouts in step, without blocking the seek on it.
    seek(t, { scrub: true });
  }, [seek]);

  const queueScrub = useCallback(
    (t) => {
      pendingRef.current = t;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(flushScrub);
    },
    [flushScrub],
  );

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const timeAt = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return null;
    // Round to hundredths: the annotator works in 0.01s, so the playhead should
    // land on a value they can type back exactly.
    return Number(xToTime(clientX - rect.left).toFixed(2));
  };

  const scrubFromEvent = (e) => {
    const t = timeAt(e.clientX);
    if (t === null) return;
    setScrubbing(true);
    trackRef.current?.setPointerCapture?.(e.pointerId);
    queueScrub(t);
    onScrub?.(t);
  };

  const scrubMove = (e) => {
    if (!scrubbing || drag) return;
    const t = timeAt(e.clientX);
    if (t !== null) {
      queueScrub(t);
      onScrub?.(t);
    }
  };

  const scrubEnd = (e) => {
    if (!scrubbing) return;
    setScrubbing(false);
    trackRef.current?.releasePointerCapture?.(e.pointerId);
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    pendingRef.current = null;
    // Settle on the exact frame the pointer ended on, not the keyframe
    // fastSeek happened to land on.
    const t = timeAt(e.clientX);
    if (t !== null) {
      seekVideo(t, { exact: true });
      seek(t);
    }
  };

  // --- shift-drag: pick every event in a span -------------------------------
  const eventsInSpan = useCallback(
    (a, b) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return events.filter((e) => e.timestamp >= lo && e.timestamp <= hi).map((e) => e.id);
    },
    [events],
  );

  const bandDown = (e) => {
    const t = timeAt(e.clientX);
    if (t === null) return;
    setBand({ from: t, to: t });
    trackRef.current?.setPointerCapture?.(e.pointerId);
    selectRange([]);
  };

  const bandMove = (e) => {
    if (!band) return;
    const t = timeAt(e.clientX);
    if (t === null) return;
    setBand((b) => ({ ...b, to: t }));
    // Live, so the annotator sees what the span has caught before letting go.
    selectRange(eventsInSpan(band.from, t));
  };

  const bandEnd = (e) => {
    if (!band) return;
    trackRef.current?.releasePointerCapture?.(e.pointerId);
    const t = timeAt(e.clientX) ?? band.to;
    selectRange(eventsInSpan(band.from, t));
    setBand(null);
  };

  // --- marker dragging: retime an event by pulling it along its lane ---------
  const onMarkerDown = (e, ev) => {
    // A span drag that happens to start on a marker is still a span drag: fall
    // through to the track rather than retiming the event under the pointer.
    if (e.shiftKey) return;
    e.stopPropagation();
    const rect = trackRef.current.getBoundingClientRect();
    select(ev.id);
    setDrag({ id: ev.id, startX: e.clientX, origin: ev.timestamp, rectLeft: rect.left, preview: ev.timestamp });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMarkerMove = (e) => {
    if (!drag) return;
    const dt = (e.clientX - drag.startX) / zoom;
    setDrag((d) => ({ ...d, preview: Math.max(0, Math.min(duration, d.origin + dt)) }));
  };

  const onMarkerUp = () => {
    if (!drag) return;
    if (Math.abs(drag.preview - drag.origin) > 0.005) {
      updateEvent(drag.id, { timestamp: Number(drag.preview.toFixed(2)) });
    } else {
      seek(drag.origin);
    }
    setDrag(null);
  };

  const step = tickStep(zoom);
  const ticks = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="label-text">Timeline</span>
        <span className="font-mono text-xs text-pitch-400 tabular">{seconds2(currentTime)}</span>
        <span className="hidden text-2xs text-ink-600 xl:inline">drag to scrub · shift-drag to select a span</span>
        <div className="flex-1" />
        <button
          onClick={() => setFollow((f) => !f)}
          title="Keep playhead in view"
          className={`rounded-lg border px-2 py-1 text-xs font-medium transition ${
            follow ? 'border-pitch-500/40 bg-pitch-500/10 text-pitch-400' : 'border-white/10 text-ink-400 hover:text-ink-100'
          }`}
        >
          <Crosshair size={12} className="inline" /> Follow
        </button>
        <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5">
          <button onClick={() => setZoom((z) => Math.max(2, z / 1.5))} className="rounded p-1 text-ink-400 transition hover:bg-white/10 hover:text-white">
            <ZoomOut size={13} />
          </button>
          <span className="w-14 text-center font-mono text-2xs text-ink-400 tabular">{zoom.toFixed(0)} px/s</span>
          <button onClick={() => setZoom((z) => Math.min(240, z * 1.5))} className="rounded p-1 text-ink-400 transition hover:bg-white/10 hover:text-white">
            <ZoomIn size={13} />
          </button>
          <button
            onClick={() => {
              const w = scrollRef.current?.clientWidth ?? 800;
              setZoom(Math.max(2, (w - 20) / Math.max(1, duration)));
            }}
            title="Fit whole video"
            className="rounded p-1 text-ink-400 transition hover:bg-white/10 hover:text-white"
          >
            <Maximize size={13} />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {selectedIds.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 bg-ink-900/95 px-2 py-1.5 shadow-xl backdrop-blur"
          >
            <span className="px-1 text-xs text-ink-200">
              <span className="font-mono tabular text-pitch-400">{selectedIds.length}</span> selected
            </span>
            <button
              onClick={() => deleteSelection()}
              title="Delete selected events (Del)"
              className="flex items-center gap-1.5 rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-300 transition hover:bg-red-500/25"
            >
              <Trash2 size={13} /> Delete
            </button>
            <button
              onClick={clearSelection}
              title="Clear selection (Esc)"
              className="rounded-lg px-2 py-1 text-xs text-ink-400 transition hover:bg-white/10 hover:text-ink-100"
            >
              Clear
            </button>
          </motion.div>
        )}
        {/* Lane labels — vertical scroll is mirrored from the track below */}
        <div className="flex shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/40" style={{ width: GUTTER }}>
          <div className="shrink-0 border-b border-white/[0.06]" style={{ height: RULER_H }} />
          {/* Mirrors the track's vertical scroll; height comes from the flex
              row so the lanes fill whatever the layout gives the timeline. */}
          <div ref={gutterRef} className="min-h-0 flex-1 overflow-hidden">
            {lanes.map((l, i) => (
              <div
                key={l}
                onMouseEnter={() => setHoverLane(i)}
                onMouseLeave={() => setHoverLane(null)}
                className={`flex cursor-default items-center gap-2 px-2.5 transition-colors ${
                  hoverLane === i ? 'bg-white/[0.05]' : ''
                }`}
                style={{ height: LANE_H }}
                title={`${labelTitle(l)} — ${laneCounts[l]} event${laneCounts[l] === 1 ? '' : 's'}`}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: LABEL_META[l].color, boxShadow: `0 0 6px ${LABEL_META[l].color}99` }}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-200">{labelTitle(l)}</span>
                <span className="shrink-0 font-mono text-2xs text-ink-500 tabular">{laneCounts[l]}</span>
              </div>
            ))}
            {lanes.length === 0 && (
              <div className="px-2.5 py-3 text-2xs leading-snug text-ink-600">no events yet</div>
            )}
          </div>
        </div>

        {/* Scrollable track */}
        <div
          ref={scrollRef}
          onScroll={(e) => {
            // Keep the label column locked to the lanes it names.
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          className="min-h-0 min-w-0 flex-1 overflow-auto"
        >
          <div
            ref={trackRef}
            className="relative pitch-stripes select-none"
            style={{ width, minHeight: '100%', height: RULER_H + Math.max(lanes.length, 1) * LANE_H }}
            onPointerDown={(e) => {
              // Right-click must not scrub; it opens the menu instead.
              if (e.button === 2) return;
              if (e.shiftKey) return bandDown(e);
              clearSelection();
              scrubFromEvent(e);
            }}
            onContextMenu={(e) => {
              const t = timeAt(e.clientX);
              if (t !== null) onContextMenu?.(e, t);
            }}
            onPointerMove={(e) => (band ? bandMove(e) : scrubMove(e))}
            onPointerUp={(e) => (band ? bandEnd(e) : scrubEnd(e))}
            onPointerCancel={(e) => (band ? bandEnd(e) : scrubEnd(e))}
          >
            {/* Ruler */}
            <div
              className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/85 backdrop-blur"
              style={{ height: RULER_H }}
            >
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full" style={{ left: timeToX(t) }}>
                  <div className="h-2 w-px bg-white/15" />
                  <span className="absolute left-1 top-1.5 whitespace-nowrap font-mono text-2xs text-ink-500">
                    {timecode(t, { ms: false })}
                  </span>
                </div>
              ))}
            </div>

            {/* Lane backgrounds */}
            {lanes.map((l, i) => (
              <div
                key={l}
                onMouseEnter={() => setHoverLane(i)}
                onMouseLeave={() => setHoverLane(null)}
                className="absolute left-0 right-0 border-b border-white/[0.03] transition-colors"
                style={{
                  top: RULER_H + i * LANE_H,
                  height: LANE_H,
                  background:
                    hoverLane === i ? 'rgba(255,255,255,.05)' : i % 2 ? 'rgba(255,255,255,.012)' : 'transparent',
                }}
              />
            ))}

            {/* Shift-drag span */}
            {band && (
              <div
                className="pointer-events-none absolute z-20 border-x border-pitch-400/70 bg-pitch-400/15"
                style={{
                  left: timeToX(Math.min(band.from, band.to)),
                  width: Math.max(1, Math.abs(timeToX(band.to) - timeToX(band.from))),
                  top: RULER_H,
                  bottom: 0,
                }}
              />
            )}

            {/* Event markers */}
            {events.map((ev) => {
              const i = laneIndex[ev.type] ?? 0;
              const isDragging = drag?.id === ev.id;
              const t = isDragging ? drag.preview : ev.timestamp;
              const c = LABEL_META[ev.type]?.color ?? '#94A3B8';
              const isSel = ev.id === selectedId || selectedIds.includes(ev.id);

              return (
                <div
                  key={ev.id}
                  onPointerDown={(e) => onMarkerDown(e, ev)}
                  onPointerMove={onMarkerMove}
                  onPointerUp={onMarkerUp}
                  onPointerCancel={onMarkerUp}
                  title={`${labelTitle(ev.type)} · ${timecode(ev.timestamp)}`}
                  className="absolute z-10 cursor-ew-resize"
                  style={{
                    left: timeToX(t) - 6,
                    top: RULER_H + i * LANE_H + 3,
                    width: 12,
                    height: LANE_H - 6,
                  }}
                >
                  <motion.div
                    animate={{ scale: isSel ? 1.25 : 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                    className="h-full w-full rounded-[3px]"
                    style={{
                      background: c,
                      border: `1.5px solid ${c}`,
                      boxShadow: isSel ? `0 0 0 2px #fff, 0 0 14px ${c}` : isDragging ? `0 0 12px ${c}` : 'none',
                    }}
                  />
                </div>
              );
            })}

            {/* Live readout while a marker is being dragged */}
            {drag && (
              <div
                className="pointer-events-none absolute z-30 -translate-x-1/2 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-2xs text-white shadow-lift"
                style={{ left: timeToX(drag.preview), top: 2 }}
              >
                {drag.preview.toFixed(2)}s
              </div>
            )}

            {/* Playhead */}
            <div
              className="pointer-events-none absolute top-0 z-20 h-full w-px bg-pitch-400"
              style={{ left: timeToX(currentTime), boxShadow: '0 0 8px rgba(34,227,125,.8)' }}
            >
              <div className="absolute -left-[5px] top-0 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-pitch-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
