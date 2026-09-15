import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, AlertTriangle, ChevronDown, Play, Pause, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FolderOpen } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../store/useStore';
import { LABEL_META, labelTitle } from '../lib/labels';
import { timecode } from '../lib/format';
import { REPORTING_FPS, toFrame } from '../lib/fps';
import ReadOnlyTimeline from '../components/ReadOnlyTimeline';

/**
 * The reference set: worked examples of ground truth, each beside the clip it
 * describes. Laid out like the annotate workspace — same picture, timeline and
 * frame-accurate controls — so the team reads a reference the way they mark a
 * clip, but with nothing that can change a thing.
 *
 * Entries come from the exam/ folder on the host: a matched pair per example,
 * <name>.gt.json (the ground truth) and <name>.mp4 (the clip).
 */
export default function Exam() {
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState(null);
  const [sel, setSel] = useState(null);
  const [entry, setEntry] = useState(null);
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(30);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const video = useRef(null);

  /**
   * Magnify the picture — the ball is only a few pixels in these wide pitch
   * shots. Same zoom/pan as the annotate workspace, so a viewer studies a
   * reference the way they mark a clip. Pan is in screen pixels, applied before
   * the scale, so a drag moves the picture by the distance the pointer moved.
   */
  const wrapRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef(null);
  // A pan ends in a click; this keeps that click from toggling play/pause.
  const justPanned = useRef(false);
  // Latest reference rows, read live by ↑/↓ without re-binding the listener.
  const rowsRef = useRef([]);

  const clampPan = useCallback((p, z) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return p;
    const maxX = (r.width * (z - 1)) / 2 / z;
    const maxY = (r.height * (z - 1)) / 2 / z;
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
  }, []);
  const zoomBy = useCallback((factor) => {
    setZoom((z) => {
      const next = Math.max(1, Math.min(6, Number((z * factor).toFixed(3))));
      setPan((p) => (next === 1 ? { x: 0, y: 0 } : clampPan(p, next)));
      return next;
    });
  }, [clampPan]);
  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // A new clip starts at 1x rather than inheriting the last one's framing.
  useEffect(() => { resetZoom(); }, [sel, resetZoom]);

  useEffect(() => {
    api.examList()
      .then((d) => { setList(d); if (d.entries.length) setSel(d.entries[0].hash); })
      .catch((err) => !err.silent && toast(err.message, 'error'));
  }, [toast]);

  useEffect(() => {
    if (!sel) return;
    let live = true;
    setEntry(null); setNow(0);
    api.examEntry(sel)
      // Switching clips quickly must not let an earlier answer arrive last and
      // sit beside the wrong video.
      .then((d) => { if (live && d.hash === sel) setEntry(d); })
      .catch((err) => { if (live && !err.silent) toast(err.message, 'error'); });
    return () => { live = false; };
  }, [sel, toast]);

  // Playback speed, same five steps and same 1-5 keys as the workspace.
  const RATES = [0.25, 0.5, 1, 1.5, 2];
  const [rate, setRate] = useState(1);
  useEffect(() => { if (video.current) video.current.playbackRate = rate; }, [rate, sel]);

  const seek = useCallback((seconds) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, seconds);
    v.pause();
    setNow(Math.max(0, seconds));
  }, []);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  /**
   * Step whole frames on the 25 fps reporting clock — the same movement the
   * annotate workspace makes.
   *
   * Snapping to the grid is the point. Adding 1/25 to whatever currentTime
   * happens to be lets the position sit between frames: the decoder lands on
   * the nearest real frame it has, and on 29.97 fps footage two consecutive
   * presses can land on the same one. Measured over twelve presses the old
   * arithmetic produced 76,77,78,78,79,... - ten presses advanced eight
   * frames, and the repeats read as a dead arrow key. Rounding to a frame
   * number first makes every press move exactly one frame.
   */
  const step = useCallback((frames) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    const f = Math.max(0, Math.round(v.currentTime * REPORTING_FPS) + frames);
    const t = Math.min(duration || Infinity, f / REPORTING_FPS);
    v.currentTime = t;
    setNow(t);
  }, [duration]);

  // Jump to the previous / next reference action from the playhead.
  const gotoAction = useCallback((dir) => {
    const items = rowsRef.current;
    if (!items.length) return;
    const t = video.current?.currentTime ?? 0;
    if (dir > 0) {
      const next = items.find((r) => r.seconds > t + 0.02);
      if (next) seek(next.seconds);
    } else {
      let prev = null;
      for (const r of items) { if (r.seconds < t - 0.02) prev = r; else break; }
      if (prev) seek(prev.seconds);
    }
  }, [seek]);

  /**
   * Keyboard, mirroring the workspace but with nothing that can change a label:
   * Space plays, ←/→ step one frame (Shift = one second), ↑/↓ jump between
   * actions, +/−/0 zoom.
   */
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const at = () => video.current?.currentTime ?? 0;
      switch (e.key) {
        case ' ':
          if (t && t.tagName === 'BUTTON') return; // let a focused button take Space
          e.preventDefault(); return toggle();
        case 'ArrowLeft':
          e.preventDefault(); return e.shiftKey ? seek(at() - 1) : step(-1);
        case 'ArrowRight':
          e.preventDefault(); return e.shiftKey ? seek(at() + 1) : step(1);
        case 'ArrowUp':
          e.preventDefault(); return gotoAction(-1);
        case 'ArrowDown':
          e.preventDefault(); return gotoAction(1);
        case '+':
        case '=':
          e.preventDefault(); return zoomBy(1.4);
        case '-':
        case '_':
          e.preventDefault(); return zoomBy(1 / 1.4);
        case ',':
          e.preventDefault(); return step(-1);
        case '.':
          e.preventDefault(); return step(1);
        case '0':
          e.preventDefault(); return resetZoom();
        default:
      }
      if (['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        setRate(RATES[Number(e.key) - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seek, step, gotoAction, zoomBy, resetZoom]);

  const rows = entry?.rows ?? [];
  rowsRef.current = rows;
  const activeIdx = useMemo(() => {
    let best = -1;
    for (let i = 0; i < rows.length; i++) if (rows[i].seconds <= now + 0.05) best = i;
    return best;
  }, [rows, now]);

  const current = list?.entries.find((e) => e.hash === sel);
  const isEmpty = Boolean(list) && list.entries.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: which reference is on screen, and how to switch */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
        <GraduationCap size={16} className="text-pitch-400" />
        <span className="text-sm font-semibold text-white">Reference</span>

        {!isEmpty && (
          <div className="relative">
            <button
              onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1 text-xs transition hover:bg-white/[0.05]"
            >
              <span className="font-mono text-ink-100">{sel ? `${sel.slice(0, 18)}${sel.length > 18 ? '…' : ''}` : 'pick a clip'}</span>
              {current?.clip && (
                <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-2xs text-ink-500" title={`Also in the library as ${current.clip}`}>
                  lib {current.clip.replace('.mp4', '')}
                </span>
              )}
              <ChevronDown size={13} className="text-ink-500" />
            </button>
            {pickerOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-white/10 bg-ink-900/95 p-1 shadow-xl backdrop-blur">
                {list?.entries.map((e) => (
                  <button
                    key={e.hash}
                    onClick={() => { setSel(e.hash); setPickerOpen(false); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                      e.hash === sel ? 'bg-pitch-500/12 text-white' : 'text-ink-300 hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-xs">{e.hash}</span>
                      {e.clip && <span className="block truncate font-mono text-2xs text-ink-600">lib {e.clip.replace('.mp4', '')}</span>}
                    </span>
                    {!e.hasVideo && <span className="shrink-0 text-2xs text-ink-600" title="No .mp4 beside this answer">no clip</span>}
                    <span className="font-mono text-2xs tabular text-pitch-400">{e.events}</span>
                    {e.offTaxonomy > 0 && <AlertTriangle size={11} className="text-amber-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!isEmpty && <span className="font-mono text-2xs text-ink-500 tabular">{timecode(now)} / {timecode(duration, { ms: false })}</span>}
        <div className="flex-1" />
        <span className="rounded-md border border-white/10 px-2 py-0.5 text-2xs uppercase tracking-wider text-ink-500">read-only</span>
        {!isEmpty && (
          <span className="font-mono text-xs text-ink-300">
            <span className="text-pitch-400">{rows.length}</span> actions
          </span>
        )}
      </div>

      {isEmpty ? (
        /* No reference pairs on the host yet — say exactly how to add them. */
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
          <GraduationCap size={26} className="mb-3 text-ink-600" />
          <p className="text-sm font-medium text-ink-200">No reference clips yet</p>
          <p className="mt-2 max-w-[52ch] text-xs leading-relaxed text-ink-500">
            Drop matched pairs into the <span className="font-mono text-ink-300">exam/</span> folder on the host — for each
            example, <span className="font-mono text-ink-300">name.gt.json</span> (the ground truth) and
            {' '}<span className="font-mono text-ink-300">name.mp4</span> (the clip, H.264). They appear here for the whole
            team to learn from. Nothing here can be edited.
          </p>
          {list?.dir && (
            <p className="mt-3 flex items-center gap-1.5 font-mono text-2xs text-ink-600">
              <FolderOpen size={11} /> {list.dir}
            </p>
          )}
        </div>
      ) : (
        /* Same shape as the workspace: picture over timeline, list beside it */
        <div className="flex min-h-0 flex-1 gap-3 p-3">
          <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[7fr_3fr] gap-3">
            <div className="min-h-0">
              <div
                ref={wrapRef}
                onWheel={(e) => { if (e.ctrlKey || e.metaKey) return; zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }}
                className="relative flex h-full items-center justify-center overflow-hidden rounded-2xl border border-white/[0.07] bg-black"
              >
                {sel && (
                  <video
                    key={sel}
                    ref={video}
                    src={api.examVideoUrl(sel)}
                    preload="auto"
                    playsInline
                    muted
                    className="h-full w-full object-contain"
                    style={{
                      transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
                      transformOrigin: 'center center',
                      cursor: zoom > 1 ? (panning.current ? 'grabbing' : 'grab') : 'default',
                    }}
                    onPointerDown={(e) => {
                      if (zoom === 1 || e.button !== 0) return;
                      panning.current = { x: e.clientX, y: e.clientY, from: pan, moved: false };
                      e.currentTarget.setPointerCapture(e.pointerId);
                    }}
                    onPointerMove={(e) => {
                      const d = panning.current;
                      if (!d) return;
                      const dx = (e.clientX - d.x) / zoom;
                      const dy = (e.clientY - d.y) / zoom;
                      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
                      setPan(clampPan({ x: d.from.x + dx, y: d.from.y + dy }, zoom));
                    }}
                    onPointerUp={(e) => {
                      const d = panning.current;
                      panning.current = null;
                      e.currentTarget.releasePointerCapture?.(e.pointerId);
                      justPanned.current = Boolean(d?.moved);
                    }}
                    onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 30)}
                    onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    onClick={() => { if (justPanned.current) { justPanned.current = false; return; } toggle(); }}
                  />
                )}
                {sel && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-10">
                    <div className="flex items-center gap-1.5">
                      <button onClick={toggle} title="Play / pause (Space)" className="rounded-lg p-2 text-white transition hover:bg-white/10">
                        {playing ? <Pause size={17} /> : <Play size={17} />}
                      </button>
                      <button onClick={() => step(-1)} title="Back one frame (← · Shift+← one second)" className="rounded-lg p-2 text-white transition hover:bg-white/10"><ChevronLeft size={17} /></button>
                      <button onClick={() => step(1)} title="Forward one frame (→ · Shift+→ one second)" className="rounded-lg p-2 text-white transition hover:bg-white/10"><ChevronRight size={17} /></button>
                      <span className="ml-2 font-mono text-xs text-white tabular">{timecode(now)}</span>
                      <span className="font-mono text-xs text-ink-400 tabular">/ {timecode(duration, { ms: false })}</span>
                      <span
                        className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-2xs text-pitch-400"
                        title={`frame ${toFrame(now)} on the ${REPORTING_FPS} fps reporting clock`}
                      >
                        f{toFrame(now)}
                      </span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-2xs text-ink-300" title="Playback speed (1-5)">
                        {rate}×
                      </span>
                      <div className="flex-1" />
                      <div className="mr-1 flex items-center gap-0.5 rounded-lg border border-white/10 p-0.5">
                        <button onClick={() => zoomBy(1 / 1.4)} disabled={zoom <= 1} title="Zoom out (− or wheel down)"
                          className="rounded p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/25">
                          <ZoomOut size={15} />
                        </button>
                        <button onClick={resetZoom} disabled={zoom === 1} title="Fit the whole frame (0)"
                          className="min-w-[42px] rounded px-1 py-1 font-mono text-2xs tabular text-white/80 transition hover:bg-white/10 hover:text-white disabled:text-white/25">
                          {zoom.toFixed(1)}×
                        </button>
                        <button onClick={() => zoomBy(1.4)} disabled={zoom >= 6} title="Zoom in (+ or wheel up)"
                          className="rounded p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/25">
                          <ZoomIn size={15} />
                        </button>
                      </div>
                      <span className="rounded-md bg-pitch-500/15 px-2 py-0.5 font-mono text-2xs text-pitch-400 tabular">
                        {now.toFixed(2)}s · f{Math.round(now * 25)}
                      </span>
                    </div>
                  </div>
                )}

                {activeIdx >= 0 && rows[activeIdx] && Math.abs(rows[activeIdx].seconds - now) < 1.2 && (
                  <div
                    className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 backdrop-blur-md"
                    style={{
                      borderColor: `${LABEL_META[rows[activeIdx].action]?.color ?? '#94A3B8'}55`,
                      background: `${LABEL_META[rows[activeIdx].action]?.color ?? '#94A3B8'}1a`,
                    }}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ background: LABEL_META[rows[activeIdx].action]?.color ?? '#94A3B8' }} />
                    <span className="text-xs font-medium text-white">{labelTitle(rows[activeIdx].action)}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="min-h-0">
              <ReadOnlyTimeline rows={rows} duration={duration} currentTime={now} onSeek={seek} activeIdx={activeIdx} />
            </div>
          </div>

          <aside className="w-[340px] shrink-0">
            <div className="panel flex h-full min-h-0 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3 py-2">
                <span className="label-text">Actions</span>
                <span className="font-mono text-2xs text-ink-500">{rows.length}</span>
                {current?.offTaxonomy > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-2xs text-amber-400">
                    <AlertTriangle size={11} /> {current.offTaxonomy} off-taxonomy
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {rows.map((r, i) => (
                  <button
                    key={i}
                    onClick={() => seek(r.seconds)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition ${
                      i === activeIdx ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LABEL_META[r.action]?.color ?? '#94A3B8' }} />
                    <span className={`min-w-0 flex-1 truncate text-xs ${r.valid ? 'text-ink-200' : 'text-amber-400'}`}>
                      {r.valid ? labelTitle(r.action) : `${r.action} (not in the 15)`}
                    </span>
                    <span className="shrink-0 font-mono text-2xs tabular text-ink-500">{r.seconds.toFixed(2)}s</span>
                    <span className="shrink-0 font-mono text-2xs tabular text-ink-600">f{r.frame}</span>
                  </button>
                ))}
                {entry && rows.length === 0 && <p className="px-2 py-3 text-xs text-ink-600">No actions in this reference.</p>}
                {!entry && <div className="space-y-1.5 p-1">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-7 rounded-lg" />)}</div>}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
