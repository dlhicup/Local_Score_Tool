import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { LABEL_META, labelTitle } from '../lib/labels';
import { timecode, seconds2 } from '../lib/format';

/**
 * The annotate timeline, minus every way to change anything.
 *
 * Deliberately a separate component rather than a flag on the editing one:
 * the reference answers must not be one prop away from being editable, and the
 * timeline annotators depend on all day should not grow branches for a page
 * they never see.
 */
const LANE_H = 24;
const GUTTER = 148;
const RULER_H = 28;

function tickStep(pxPerSec) {
  const raw = 90 / pxPerSec;
  return [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s >= raw) ?? 60;
}

export default function ReadOnlyTimeline({ rows, duration, currentTime, onSeek, activeIdx, reference = null }) {
  const scrollRef = useRef(null);
  const trackRef = useRef(null);
  const gutterRef = useRef(null);
  const [zoom, setZoom] = useState(12);
  const [fitted, setFitted] = useState(false);
  const [hoverLane, setHoverLane] = useState(null);

  const lanes = useMemo(() => {
    const present = new Set(rows.map((r) => r.action));
    return Object.keys(LABEL_META).filter((l) => present.has(l));
  }, [rows]);
  const laneIndex = useMemo(() => Object.fromEntries(lanes.map((l, i) => [l, i])), [lanes]);
  const laneCounts = useMemo(() => {
    const c = {};
    for (const r of rows) c[r.action] = (c[r.action] ?? 0) + 1;
    return c;
  }, [rows]);

  // A reference event is "missed" when the annotator has no same-action mark
  // within a second of it — shown as a hollow dashed marker on its own lane.
  const refMarks = useMemo(() => {
    if (!reference) return [];
    return reference.map((r) => ({
      ...r,
      missed: !rows.some((e) => e.action === r.action && Math.abs(e.seconds - r.seconds) <= 1),
    }));
  }, [reference, rows]);
  const refLane = lanes.length; // sits just below the action lanes
  const totalLanes = lanes.length + (reference ? 1 : 0);

  useEffect(() => { setFitted(false); }, [rows]);
  useEffect(() => {
    if (fitted || !duration || !scrollRef.current) return;
    const w = scrollRef.current.clientWidth;
    if (w > 0) { setZoom(Math.max(2, (w - 24) / duration)); setFitted(true); }
  }, [duration, fitted]);

  const timeToX = useCallback((t) => t * zoom, [zoom]);
  const width = Math.max(200, duration * zoom + 24);

  const step = tickStep(zoom);
  const ticks = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  const seekFrom = (clientX) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek(Math.max(0, Math.min(duration, (clientX - rect.left) / zoom)));
  };

  return (
    <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <span className="label-text">Timeline</span>
        <span className="font-mono text-xs text-pitch-400 tabular">{seconds2(currentTime)}</span>
        <span className="hidden text-2xs text-ink-600 xl:inline">reference answers · read-only</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5">
          <button onClick={() => setZoom((z) => Math.max(2, z / 1.5))} className="rounded p-1 text-ink-400 transition hover:bg-white/10 hover:text-white"><ZoomOut size={13} /></button>
          <span className="w-14 text-center font-mono text-2xs text-ink-400 tabular">{zoom.toFixed(0)} px/s</span>
          <button onClick={() => setZoom((z) => Math.min(240, z * 1.5))} className="rounded p-1 text-ink-400 transition hover:bg-white/10 hover:text-white"><ZoomIn size={13} /></button>
          <button
            onClick={() => setZoom(Math.max(2, ((scrollRef.current?.clientWidth ?? 800) - 20) / Math.max(1, duration)))}
            title="Fit whole video"
            className="rounded p-1 text-ink-400 transition hover:bg-white/10 hover:text-white"
          ><Maximize size={13} /></button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/40" style={{ width: GUTTER }}>
          <div className="shrink-0 border-b border-white/[0.06]" style={{ height: RULER_H }} />
          <div ref={gutterRef} className="min-h-0 flex-1 overflow-hidden">
            {lanes.map((l, i) => (
              <div
                key={l}
                onMouseEnter={() => setHoverLane(i)}
                onMouseLeave={() => setHoverLane(null)}
                className={`flex cursor-default items-center gap-2 px-2.5 transition-colors ${hoverLane === i ? 'bg-white/[0.05]' : ''}`}
                style={{ height: LANE_H }}
                title={`${labelTitle(l)} — ${laneCounts[l]} action${laneCounts[l] === 1 ? '' : 's'}`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LABEL_META[l].color, boxShadow: `0 0 6px ${LABEL_META[l].color}99` }} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-200">{labelTitle(l)}</span>
                <span className="shrink-0 font-mono text-2xs text-ink-500 tabular">{laneCounts[l]}</span>
              </div>
            ))}
            {lanes.length === 0 && <div className="px-2.5 py-3 text-2xs leading-snug text-ink-600">no actions</div>}
            {reference && (
              <div className="flex items-center gap-2 border-t border-white/[0.06] px-2.5" style={{ height: LANE_H }} title="Score's reference answer for this gold clip">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: '#34D399', boxShadow: '0 0 6px #34D39999' }} />
                <span className="min-w-0 flex-1 truncate text-xs font-semibold text-pitch-400">Reference</span>
                <span className="shrink-0 font-mono text-2xs text-ink-500 tabular">{reference.length}</span>
              </div>
            )}
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
          className="min-h-0 min-w-0 flex-1 overflow-auto"
        >
          <div
            ref={trackRef}
            className="relative pitch-stripes select-none"
            style={{ width, minHeight: '100%', height: RULER_H + Math.max(totalLanes, 1) * LANE_H }}
            onPointerDown={(e) => e.button !== 2 && seekFrom(e.clientX)}
          >
            <div className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-900/85 backdrop-blur" style={{ height: RULER_H }}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full" style={{ left: timeToX(t) }}>
                  <div className="h-2 w-px bg-white/15" />
                  <span className="absolute left-1 top-1.5 whitespace-nowrap font-mono text-2xs text-ink-500">{timecode(t, { ms: false })}</span>
                </div>
              ))}
            </div>

            {lanes.map((l, i) => (
              <div
                key={l}
                onMouseEnter={() => setHoverLane(i)}
                onMouseLeave={() => setHoverLane(null)}
                className="absolute left-0 right-0 border-b border-white/[0.03] transition-colors"
                style={{
                  top: RULER_H + i * LANE_H, height: LANE_H,
                  background: hoverLane === i ? 'rgba(255,255,255,.05)' : i % 2 ? 'rgba(255,255,255,.012)' : 'transparent',
                }}
              />
            ))}
            {reference && (
              <div className="absolute left-0 right-0 border-t border-white/[0.08]" style={{ top: RULER_H + refLane * LANE_H, height: LANE_H, background: 'rgba(52,211,153,.05)' }} />
            )}
            {reference && refMarks.map((r, i) => (
              <div key={`ref${i}`}
                title={`Reference: ${labelTitle(r.action)} · ${r.seconds.toFixed(2)}s${r.missed ? ' — MISSED by annotator' : ''}`}
                className="absolute z-10 rounded-[3px]"
                style={{
                  left: timeToX(r.seconds) - 5, top: RULER_H + refLane * LANE_H + 4, width: 10, height: LANE_H - 8,
                  background: r.missed ? 'transparent' : '#34D399',
                  border: r.missed ? '1px dashed #34D399' : 'none',
                  boxShadow: r.missed ? 'none' : '0 0 5px #34D39966',
                }} />
            ))}

            {rows.map((r, i) => {
              const lane = laneIndex[r.action] ?? 0;
              const c = LABEL_META[r.action]?.color ?? '#94A3B8';
              const on = i === activeIdx;
              return (
                <div
                  key={i}
                  onPointerDown={(e) => { e.stopPropagation(); onSeek(r.seconds); }}
                  title={`${labelTitle(r.action)} · ${r.seconds.toFixed(2)}s · frame ${r.frame}`}
                  className="absolute z-10 cursor-pointer"
                  style={{ left: timeToX(r.seconds) - 6, top: RULER_H + lane * LANE_H + 3, width: 12, height: LANE_H - 6 }}
                >
                  <div
                    className="h-full w-full rounded-[3px] transition-transform"
                    style={{ background: c, transform: on ? 'scale(1.25)' : 'scale(1)', boxShadow: on ? `0 0 10px ${c}` : `0 0 6px ${c}66` }}
                  />
                </div>
              );
            })}

            <div className="pointer-events-none absolute bottom-0 z-40 w-px bg-pitch-400" style={{ left: timeToX(currentTime), top: RULER_H }}>
              <div className="absolute -left-[3px] -top-1 h-1.5 w-1.5 rotate-45 bg-pitch-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
