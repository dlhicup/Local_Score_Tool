import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { useStore } from '../store';
import { EVENT_LABELS, LABEL_META, labelTitle } from '../lib/labels';
import { toFrame } from '../lib/fps';
import { timecode } from '../lib/format';

const RULER_H = 26;
const LANE_H = 24;
const GUTTER = 150;

const tickStep = (px) => [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s >= 90 / px) ?? 60;

export default function Timeline() {
  const events = useStore((s) => s.events);
  const duration = useStore((s) => s.duration);
  const currentTime = useStore((s) => s.currentTime);
  const selectedIds = useStore((s) => s.selectedIds);
  const seek = useStore((s) => s.seek);
  const select = useStore((s) => s.select);
  const selectSpan = useStore((s) => s.selectSpan);
  const clearSelection = useStore((s) => s.clearSelection);
  const retimeEvent = useStore((s) => s.retimeEvent);
  const openMenu = useStore((s) => s.openMenu);

  const scrollRef = useRef(null);
  const trackRef = useRef(null);
  const gutterRef = useRef(null);
  const [zoom, setZoom] = useState(12);
  const [fitted, setFitted] = useState(false);
  const [drag, setDrag] = useState(null); // {mode:'scrub'|'marker'|'band', ...}

  const lanes = useMemo(() => EVENT_LABELS.filter((l) => events.some((e) => e.type === l)), [events]);
  const laneIndex = useMemo(() => Object.fromEntries(lanes.map((l, i) => [l, i])), [lanes]);
  const counts = useMemo(() => {
    const c = {}; for (const e of events) c[e.type] = (c[e.type] ?? 0) + 1; return c;
  }, [events]);

  useEffect(() => { setFitted(false); }, [duration]);
  useEffect(() => {
    if (fitted || !duration || !scrollRef.current) return;
    const w = scrollRef.current.clientWidth;
    if (w > 0) { setZoom(Math.max(2, (w - 16) / duration)); setFitted(true); }
  }, [duration, fitted]);

  const timeToX = useCallback((t) => t * zoom, [zoom]);
  const timeAtX = (clientX) => {
    const r = trackRef.current?.getBoundingClientRect(); if (!r) return 0;
    return Math.max(0, Math.min(duration || 1e9, (clientX - r.left) / zoom));
  };

  const width = Math.max(200, duration * zoom + 16);
  const height = RULER_H + Math.max(lanes.length, 1) * LANE_H;
  const step = tickStep(zoom);
  const ticks = []; for (let t = 0; t <= duration + 0.001; t += step) ticks.push(t);

  const fit = () => { const w = scrollRef.current?.clientWidth ?? 800; setZoom(Math.max(2, (w - 16) / Math.max(1, duration))); };

  // ---- pointer interaction -------------------------------------------------
  const onDown = (e) => {
    if (e.button === 2) return;
    const markerId = e.target.getAttribute?.('data-mid');
    if (markerId && !e.shiftKey) {
      const ev = events.find((x) => x.id === markerId);
      select(markerId);
      setDrag({ mode: 'marker', id: markerId, origin: ev.t, startX: e.clientX, preview: ev.t });
      trackRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (e.shiftKey) {
      const t = timeAtX(e.clientX);
      setDrag({ mode: 'band', from: t, to: t });
      trackRef.current.setPointerCapture(e.pointerId);
      selectSpan(t, t);
      return;
    }
    clearSelection();
    setDrag({ mode: 'scrub' });
    seek(timeAtX(e.clientX));
    trackRef.current.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    if (!drag) return;
    if (drag.mode === 'scrub') seek(timeAtX(e.clientX));
    else if (drag.mode === 'marker') setDrag((d) => ({ ...d, preview: Math.max(0, Math.min(duration, d.origin + (e.clientX - d.startX) / zoom)) }));
    else if (drag.mode === 'band') { const to = timeAtX(e.clientX); setDrag((d) => ({ ...d, to })); selectSpan(drag.from, to); }
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.mode === 'marker') {
      if (Math.abs(drag.preview - drag.origin) > 0.005) retimeEvent(drag.id, drag.preview);
      else seek(drag.origin);
    }
    setDrag(null);
  };

  const band = drag?.mode === 'band' ? { lo: Math.min(drag.from, drag.to), hi: Math.max(drag.from, drag.to) } : null;

  return (
    <div className="panel flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-3 py-2">
        <span className="label-text">Timeline</span>
        <span className="font-mono text-xs text-pitch-400 tabular">{currentTime.toFixed(2)}s</span>
        <span className="hidden text-2xs text-ink-600 lg:inline">click to seek · drag a marker to retime · right-click to add · ⇧-drag to select a span</span>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-white/10 p-0.5">
          <button className="rounded p-1 text-ink-400 transition hover:bg-white/10 hover:text-white" onClick={() => setZoom((z) => Math.max(2, z / 1.5))}><ZoomOut size={13} /></button>
          <span className="w-14 text-center font-mono text-2xs text-ink-400 tabular">{zoom.toFixed(0)} px/s</span>
          <button className="rounded p-1 text-ink-400 transition hover:bg-white/10 hover:text-white" onClick={() => setZoom((z) => Math.min(240, z * 1.5))}><ZoomIn size={13} /></button>
          <button className="rounded p-1 text-ink-400 transition hover:bg-white/10 hover:text-white" onClick={fit} title="Fit whole clip"><Maximize size={13} /></button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* gutter */}
        <div className="flex shrink-0 flex-col overflow-hidden border-r border-white/[0.06] bg-ink-700/40" style={{ width: GUTTER }}>
          <div className="shrink-0 border-b border-white/[0.06]" style={{ height: RULER_H }} />
          <div ref={gutterRef} className="min-h-0 flex-1 overflow-hidden">
            {lanes.map((l) => (
              <div key={l} className="flex items-center gap-2 px-2.5" style={{ height: LANE_H }} title={`${labelTitle(l)} — ${counts[l]}`}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LABEL_META[l].color, boxShadow: `0 0 6px ${LABEL_META[l].color}99` }} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-200">{labelTitle(l)}</span>
                <span className="shrink-0 font-mono text-2xs text-ink-500 tabular">{counts[l]}</span>
              </div>
            ))}
            {!lanes.length && <div className="px-2.5 py-3 text-2xs text-ink-600">no actions yet</div>}
          </div>
        </div>

        {/* track */}
        <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-auto"
          onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}>
          <div
            ref={trackRef}
            className="pitch-stripes relative select-none"
            style={{ width, minHeight: '100%', height }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
            onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, timeAtX(e.clientX)); }}
          >
            {/* ruler */}
            <div className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/85 backdrop-blur" style={{ height: RULER_H }}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full" style={{ left: timeToX(t) }}>
                  <div className="h-2 w-px bg-white/15" />
                  <span className="absolute left-1 top-1.5 whitespace-nowrap font-mono text-2xs text-ink-500">{timecode(t, { ms: false })}</span>
                </div>
              ))}
            </div>

            {/* lanes */}
            {lanes.map((l, i) => (
              <div key={l} className="absolute left-0 right-0 border-b border-white/[0.03]"
                style={{ top: RULER_H + i * LANE_H, height: LANE_H, background: i % 2 ? 'rgba(255,255,255,.012)' : 'transparent' }} />
            ))}

            {/* span band */}
            {band && (
              <div className="pointer-events-none absolute z-20 border-x border-pitch-400/70 bg-pitch-400/15"
                style={{ left: timeToX(band.lo), width: Math.max(1, timeToX(band.hi) - timeToX(band.lo)), top: RULER_H, bottom: 0 }} />
            )}

            {/* markers */}
            {events.map((ev) => {
              const i = laneIndex[ev.type] ?? 0;
              const t = drag?.mode === 'marker' && drag.id === ev.id ? drag.preview : ev.t;
              const sel = selectedIds.includes(ev.id);
              const c = LABEL_META[ev.type].color;
              return (
                <div key={ev.id} data-mid={ev.id}
                  title={`${labelTitle(ev.type)} · ${ev.t.toFixed(2)}s · f${toFrame(ev.t)}`}
                  className="absolute z-10 cursor-ew-resize rounded-[3px]"
                  style={{
                    left: timeToX(t) - 6, top: RULER_H + i * LANE_H + 3, width: 12, height: LANE_H - 6,
                    background: c, color: c,
                    transform: sel ? 'scale(1.3)' : 'none',
                    boxShadow: sel ? `0 0 10px ${c}` : `0 0 5px ${c}66`,
                    outline: sel ? '2px solid #fff' : 'none',
                  }} />
              );
            })}

            {/* playhead */}
            <div className="pointer-events-none absolute z-40 w-0.5 bg-pitch-400" style={{ left: timeToX(currentTime), top: RULER_H, bottom: 0 }}>
              <div className="absolute -left-1 top-0 h-2.5 w-2.5" style={{ background: '#34D399', clipPath: 'polygon(50% 100%,0 0,100% 0)' }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
