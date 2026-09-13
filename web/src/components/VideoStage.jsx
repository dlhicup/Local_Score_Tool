import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Volume2, VolumeX, Maximize2, Gauge, Loader2,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { timecode, seconds2 } from '../lib/format';
import { LABEL_META, labelTitle } from '../lib/labels';
import { toFrame, frameStep, REPORTING_FPS } from '../lib/fps';
import { setVideoEl, seekVideo } from '../lib/videoRef';

const RATES = [0.25, 0.5, 1, 1.5, 2];

export default function VideoStage({ nearbyEvents = [] }) {
  const videoUrl = useStore((s) => s.videoUrl);
  const playing = useStore((s) => s.playing);
  const setPlaying = useStore((s) => s.setPlaying);
  const setCurrentTime = useStore((s) => s.setCurrentTime);
  const currentTime = useStore((s) => s.currentTime);
  const seekRequest = useStore((s) => s.seekRequest);
  const setVideoMeta = useStore((s) => s.setVideoMeta);
  const videoLoading = useStore((s) => s.videoLoading);
  const videoConverting = useStore((s) => s.videoConverting);
  const [ready, setReady] = useState(false);
  const videoProgress = useStore((s) => s.videoProgress);
  const rate = useStore((s) => s.playbackRate);
  const setRate = useStore((s) => s.setPlaybackRate);
  // Stepping moves one frame on the reporting clock — the same unit the
  // exported frame numbers use.
  const FRAME = frameStep(REPORTING_FPS);

  const ref = useRef(null);
  const wrapRef = useRef(null);
  const rafRef = useRef(0);
  const [muted, setMuted] = useState(true);

  /**
   * Magnifying the picture. These clips are wide pitch shots, so the ball is
   * often a few pixels; zooming in is the difference between guessing at a
   * touch and seeing it. Pan is in *screen* pixels and is applied before the
   * scale, so dragging always moves the picture by the distance the pointer
   * moved, whatever the zoom.
   */
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panning = useRef(null);
  // A pan ends with a click event; this makes the click a no-op rather than a
  // play/pause toggle the annotator never asked for.
  const justPanned = useRef(false);

  const clampPan = useCallback((p, z) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return p;
    // Never let the picture be dragged clean off the stage.
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
  useEffect(() => { resetZoom(); setReady(false); }, [videoUrl, resetZoom]);

  // Zoom from the keyboard, so a hand can stay on the label keys.
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.4); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.4); }
      else if (e.key === '0') { e.preventDefault(); resetZoom(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomBy, resetZoom]);
  const [duration, setDuration] = useState(0);
  const [showRates, setShowRates] = useState(false);

  // Drive the store from rAF rather than `timeupdate`; the native event fires
  // only ~4x/second, which makes the playhead visibly stutter.
  useEffect(() => {
    const tick = () => {
      const v = ref.current;
      if (v && !v.paused) setCurrentTime(v.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [setCurrentTime]);

  // Hand the element to the scrubber so it can seek without a re-render.
  useEffect(() => {
    setVideoEl(ref.current);
    return () => setVideoEl(null);
  }, [videoUrl]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !seekRequest) return;
    // A scrub has already moved the element directly; re-issuing it here would
    // just queue a second seek for the same frame.
    if (seekRequest.scrub) return;
    const t = seekRequest.t;

    // While dragging, fastSeek jumps to the nearest keyframe without waiting
    // for an exact decode, so the picture tracks the pointer instead of
    // queueing one slow precise seek per pointer move. The drag's final seek
    // is not a scrub, so it lands exactly.
    v.currentTime = t;
    setCurrentTime(t);
  }, [seekRequest, setCurrentTime]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) v.play().catch(() => setPlaying(false));
    else v.pause();
  }, [playing, setPlaying]);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate]);

  const step = useCallback(
    (frames) => {
      const v = ref.current;
      if (!v) return;
      setPlaying(false);
      const t = Math.max(0, Math.min(v.duration || 0, v.currentTime + frames * FRAME));
      v.currentTime = t;
      setCurrentTime(t);
    },
    [setPlaying, setCurrentTime],
  );

  const jump = (secs) => {
    const v = ref.current;
    if (!v) return;
    const t = Math.max(0, Math.min(v.duration || 0, v.currentTime + secs));
    v.currentTime = t;
    setCurrentTime(t);
  };

  if (!videoUrl) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.07] bg-black">
        {videoLoading ? (
          <>
            <p className="text-xs text-ink-400">Loading the clip…</p>
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pitch-600 to-pitch-400 transition-[width] duration-150"
                style={{ width: `${Math.round((videoProgress || 0) * 100)}%` }}
              />
            </div>
            <p className="font-mono text-2xs text-ink-600">
              {Math.round((videoProgress || 0) * 100)}% — downloading so scrubbing is instant
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-500">No video</p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      className="group relative flex h-full min-h-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.07] bg-black"
      onWheel={(e) => {
        // Plain wheel: the workspace is a fixed full-height layout with nothing
        // to scroll, and Ctrl/⌘ + wheel belongs to the browser's own zoom.
        if (e.ctrlKey || e.metaKey) return;
        zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
      }}
    >
      <video
        ref={ref}
        src={videoUrl}
        muted={muted}
        playsInline
        preload="auto"
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
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          setDuration(el.duration);
          setVideoMeta({ duration: el.duration, width: el.videoWidth, height: el.videoHeight });
        }}
        onClick={() => {
          if (justPanned.current) { justPanned.current = false; return; }
          setPlaying(!playing);
        }}
        onEnded={() => setPlaying(false)}
        onError={(e) => console.error('video element error', e.currentTarget.error)}
        onCanPlay={() => setReady(true)}
        onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onTimeUpdate={(e) => {
          // The rAF loop covers playback; this catches paused seeks that come
          // from outside React (fullscreen UI, picture-in-picture, extensions).
          if (e.currentTarget.paused) setCurrentTime(e.currentTarget.currentTime);
        }}
      />

      {/* One-time transcode of an HEVC/Veo clip to a browser-playable proxy.
          The original is what is loaded underneath (and shows black until the
          proxy lands), so cover it while the encode runs. */}
      {videoConverting && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 backdrop-blur-sm">
          <Loader2 size={26} className="animate-spin text-pitch-400" />
          <p className="text-sm font-medium text-white">Converting this clip for playback…</p>
          {typeof videoConverting.pct === 'number' && (
            <div className="h-1.5 w-56 overflow-hidden rounded-full bg-ink-700">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pitch-600 to-pitch-400 transition-[width] duration-300"
                style={{ width: `${Math.round(videoConverting.pct * 100)}%` }}
              />
            </div>
          )}
          <p className="max-w-[46ch] text-center text-2xs text-ink-400">
            Veo clips use a codec the browser can't show, so the tool builds a playable
            copy once. This runs on the host and only happens the first time.
          </p>
        </div>
      )}

      {/* Events firing at this instant, shown over the picture */}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-col gap-1.5">
        <AnimatePresence>
          {nearbyEvents.map((e) => (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, x: -20, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: -12, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 backdrop-blur-md"
              style={{
                borderColor: `${LABEL_META[e.type].color}55`,
                background: `${LABEL_META[e.type].color}1f`,
              }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: LABEL_META[e.type].color, boxShadow: `0 0 10px ${LABEL_META[e.type].color}` }}
              />
              <span className="text-xs font-semibold text-white">{labelTitle(e.type)}</span>
              {e.team && <span className="text-2xs uppercase text-white/60">{e.team}</span>}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* No centre play button: paused is the working state here, and a disc
          in the middle of the frame covers the ball just when it matters.
          Play/pause lives in the transport below, and on the picture itself. */}

      {/* Transport */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-10">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPlaying(!playing)} className="rounded-lg p-2 text-white transition hover:bg-white/10">
            {playing ? <Pause size={17} /> : <Play size={17} />}
          </button>

          <button onClick={() => jump(-5)} title="Back 5s" className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white">
            <SkipBack size={15} />
          </button>
          <button onClick={() => step(-1)} title="Previous frame (,)" className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white">
            <ChevronLeft size={15} />
          </button>
          <button onClick={() => step(1)} title="Next frame (.)" className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white">
            <ChevronRight size={15} />
          </button>
          <button onClick={() => jump(5)} title="Forward 5s" className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white">
            <SkipForward size={15} />
          </button>

          <div className="ml-2 flex items-baseline gap-2 font-mono text-xs text-white tabular">
            <span>
              {timecode(currentTime)}
              <span className="text-white/40"> / {timecode(duration, { ms: false })}</span>
            </span>
            <span
              className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-2xs text-pitch-400"
              title={`frame ${toFrame(currentTime)} on the ${REPORTING_FPS} fps reporting clock`}
            >
              {seconds2(currentTime)} · f{toFrame(currentTime)}
            </span>
          </div>

          <div className="flex-1" />

          <div className="mr-1 flex items-center gap-0.5 rounded-lg border border-white/10 p-0.5">
            <button onClick={() => zoomBy(1 / 1.4)} disabled={zoom <= 1} title="Zoom out (− or wheel down)"
              className="rounded p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/25">
              <ZoomOut size={15} />
            </button>
            <button onClick={resetZoom} disabled={zoom === 1} title="Fit the whole frame"
              className="min-w-[42px] rounded px-1 py-1 font-mono text-2xs tabular text-white/80 transition hover:bg-white/10 hover:text-white disabled:text-white/25">
              {zoom.toFixed(1)}×
            </button>
            <button onClick={() => zoomBy(1.4)} disabled={zoom >= 6} title="Zoom in (+ or wheel up)"
              className="rounded p-1.5 text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/25">
              <ZoomIn size={15} />
            </button>
          </div>

          <div className="relative">
            <button
              onClick={() => setShowRates((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-semibold text-white/80 transition hover:bg-white/10 hover:text-white"
            >
              <Gauge size={14} /> {rate}×
            </button>
            <AnimatePresence>
              {showRates && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute bottom-full right-0 mb-2 flex flex-col overflow-hidden rounded-lg border border-white/10 bg-ink-800 shadow-lift"
                >
                  {RATES.map((r) => (
                    <button
                      key={r}
                      onClick={() => {
                        setRate(r);
                        setShowRates(false);
                      }}
                      className={`px-4 py-1.5 text-xs transition hover:bg-white/10 ${
                        r === rate ? 'font-bold text-pitch-400' : 'text-ink-200'
                      }`}
                    >
                      {r}×
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button onClick={() => setMuted((m) => !m)} className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white">
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>
          <button
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : wrapRef.current?.requestFullscreen())}
            className="rounded-lg p-2 text-white/80 transition hover:bg-white/10 hover:text-white"
          >
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
