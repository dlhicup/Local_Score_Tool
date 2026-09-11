import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import { useStore } from '../store';
import { setVideoEl } from '../lib/videoRef';
import { REPORTING_FPS, toFrame } from '../lib/fps';
import { timecode } from '../lib/format';
import { LABEL_META, labelTitle } from '../lib/labels';

/**
 * The picture and its transport. The clip plays from a local object URL, so it
 * is fully in memory — scrubbing, frame stepping and seeking are all instant.
 */
export default function VideoStage() {
  const videoUrl = useStore((s) => s.videoUrl);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const setDuration = useStore((s) => s.setDuration);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const currentTime = useStore((s) => s.currentTime);
  const duration = useStore((s) => s.duration);
  const seekReq = useStore((s) => s.seekReq);
  const clearSeek = useStore((s) => s.clearSeek);
  const openMenu = useStore((s) => s.openMenu);
  const events = useStore((s) => s.events);

  const ref = useRef(null);
  const wrap = useRef(null);
  const raf = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef(null);
  const justPanned = useRef(false);

  // register the element for direct seeking; reset zoom on a new clip
  useEffect(() => {
    setVideoEl(ref.current);
    setZoom(1); setPan({ x: 0, y: 0 });
    return () => setVideoEl(null);
  }, [videoUrl]);

  // apply seek requests coming from the timeline / list / keyboard
  useEffect(() => {
    if (!seekReq || !ref.current) return;
    ref.current.currentTime = seekReq.t;
    setCurrentTime(seekReq.t);
    clearSeek();
  }, [seekReq, setCurrentTime, clearSeek]);

  // reflect store play state onto the element
  useEffect(() => {
    const v = ref.current; if (!v) return;
    if (playing) v.play().catch(() => setPlaying(false)); else v.pause();
  }, [playing, setPlaying]);

  // follow playback with rAF for a smooth playhead
  useEffect(() => {
    if (!playing) return;
    const tick = () => { if (ref.current) setCurrentTime(ref.current.currentTime); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, setCurrentTime]);

  // ---- picture zoom + pan --------------------------------------------------
  const clampPan = useCallback((p, z) => {
    const r = wrap.current?.getBoundingClientRect(); if (!r) return p;
    const mx = (r.width * (z - 1)) / 2 / z, my = (r.height * (z - 1)) / 2 / z;
    return { x: Math.max(-mx, Math.min(mx, p.x)), y: Math.max(-my, Math.min(my, p.y)) };
  }, []);
  const zoomBy = useCallback((f) => {
    setZoom((z) => {
      const n = Math.max(1, Math.min(6, +(z * f).toFixed(3)));
      setPan((p) => (n === 1 ? { x: 0, y: 0 } : clampPan(p, n)));
      return n;
    });
  }, [clampPan]);
  useEffect(() => {
    window.__zoomBy = zoomBy;
    window.__zoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  }, [zoomBy]);

  const nearby = events
    .map((e) => ({ e, d: Math.abs(e.t - currentTime) }))
    .filter((x) => x.d < 0.6)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.e);

  if (!videoUrl) return null;

  return (
    <div
      ref={wrap}
      className="group relative flex h-full items-center justify-center overflow-hidden rounded-2xl border border-white/[0.07] bg-black"
      onWheel={(e) => { if (e.ctrlKey || e.metaKey) return; e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12); }}
    >
      <video
        ref={ref}
        src={videoUrl}
        muted
        playsInline
        preload="auto"
        className="h-full w-full object-contain"
        style={{ transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`, cursor: zoom > 1 ? (panning.current ? 'grabbing' : 'grab') : 'default' }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onClick={() => { if (justPanned.current) { justPanned.current = false; return; } setPlaying(!playing); }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onTimeUpdate={(e) => { if (e.currentTarget.paused) setCurrentTime(e.currentTarget.currentTime); }}
        onContextMenu={(e) => { e.preventDefault(); openMenu(e.clientX, e.clientY, ref.current?.currentTime ?? 0); }}
        onPointerDown={(e) => {
          if (zoom === 1 || e.button !== 0) return;
          panning.current = { x: e.clientX, y: e.clientY, from: pan, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = panning.current; if (!d) return;
          const dx = (e.clientX - d.x) / zoom, dy = (e.clientY - d.y) / zoom;
          if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
          setPan(clampPan({ x: d.from.x + dx, y: d.from.y + dy }, zoom));
        }}
        onPointerUp={(e) => { const d = panning.current; panning.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId); justPanned.current = !!d?.moved; }}
      />

      {/* event badge(s) at the current instant */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1.5">
        {nearby.map((e) => (
          <span key={e.id} className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium backdrop-blur-md"
            style={{ borderColor: `${LABEL_META[e.type].color}55`, background: `${LABEL_META[e.type].color}1a` }}>
            <span className="h-2 w-2 rounded-full" style={{ background: LABEL_META[e.type].color }} />
            <span className="text-white">{labelTitle(e.type)}</span>
          </span>
        ))}
      </div>

      {/* transport */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 pb-3 pt-10 opacity-0 transition group-hover:opacity-100">
        <button className="grid h-9 w-9 place-items-center rounded-lg text-white transition hover:bg-white/15" onClick={() => setPlaying(!playing)} title="Play / pause (Space)">
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button className="grid h-9 w-9 place-items-center rounded-lg text-white/80 transition hover:bg-white/15" onClick={() => window.__stepFrame?.(-1)} title="Previous frame (←)"><ChevronLeft size={18} /></button>
        <button className="grid h-9 w-9 place-items-center rounded-lg text-white/80 transition hover:bg-white/15" onClick={() => window.__stepFrame?.(1)} title="Next frame (→)"><ChevronRight size={18} /></button>
        <span className="ml-2 font-mono text-xs text-white tabular">{timecode(currentTime)} <span className="text-white/50">/ {timecode(duration, { ms: false })}</span></span>
        <div className="ml-2 flex items-center gap-0.5 rounded-lg border border-white/15 p-0.5">
          <button className="rounded px-2 py-1 font-mono text-2xs text-white transition hover:bg-white/15" onClick={() => zoomBy(1 / 1.4)} title="Zoom out (−)"><ZoomOut size={13} /></button>
          <button className="rounded px-2 py-1 font-mono text-2xs text-white transition hover:bg-white/15" onClick={() => window.__zoomReset?.()} title="Reset (0)">{zoom.toFixed(1)}×</button>
          <button className="rounded px-2 py-1 font-mono text-2xs text-white transition hover:bg-white/15" onClick={() => zoomBy(1.4)} title="Zoom in (+)"><ZoomIn size={13} /></button>
        </div>
        <span className="ml-auto rounded-md bg-pitch-500/15 px-2 py-1 font-mono text-2xs text-pitch-400 tabular">
          {currentTime.toFixed(2)}s · f{toFrame(currentTime)}
        </span>
      </div>
    </div>
  );
}
