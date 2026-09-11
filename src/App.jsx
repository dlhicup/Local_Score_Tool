import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from './store';
import { useHotkeys } from './lib/useHotkeys';
import { getVideoEl } from './lib/videoRef';
import { REPORTING_FPS } from './lib/fps';
import { KEY_TO_LABEL, labelTitle } from './lib/labels';
import TopBar from './components/TopBar';
import DropZone from './components/DropZone';
import VideoStage from './components/VideoStage';
import Timeline from './components/Timeline';
import EventList from './components/EventList';
import ActionMenu from './components/ActionMenu';
import Shortcuts from './components/Shortcuts';

export default function App() {
  const videoUrl = useStore((s) => s.videoUrl);
  const [dirHandle, setDirHandle] = useState(null);
  const [toasts, setToasts] = useState([]);
  const toastId = useRef(0);

  // one toast channel, reachable from anywhere (incl. the save handler)
  const pushToast = useCallback((msg, kind = '') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  }, []);
  useEffect(() => { window.__toast = pushToast; }, [pushToast]);

  // frame-accurate stepping, reachable from the transport buttons too
  const stepFrame = useCallback((dir) => {
    const el = getVideoEl(); if (!el) return;
    if (!el.paused) el.pause();
    const f = Math.max(0, Math.round(el.currentTime * REPORTING_FPS) + dir);
    useStore.getState().seek(f / REPORTING_FPS);
  }, []);
  useEffect(() => { window.__stepFrame = stepFrame; }, [stepFrame]);

  useHotkeys((e) => {
    const s = useStore.getState();
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); window.__save?.(); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); return; }
    if (mod) return;

    if (e.key === '?') { s.toggleHelp(); return; }
    if (!s.videoUrl) return;
    const t = getVideoEl()?.currentTime ?? s.currentTime;

    switch (e.key) {
      case ' ': e.preventDefault(); return s.setPlaying(!s.playing);
      case 'ArrowLeft': e.preventDefault(); return e.shiftKey ? s.seek(t - 1) : stepFrame(-1);
      case 'ArrowRight': e.preventDefault(); return e.shiftKey ? s.seek(t + 1) : stepFrame(1);
      case 'Delete': case 'Backspace':
        if (s.selectedIds.length) { e.preventDefault(); const n = s.deleteSelected(); pushToast(`Deleted ${n} action${n > 1 ? 's' : ''}`); }
        return;
      case 'Escape': if (s.selectedIds.length) { e.preventDefault(); s.clearSelection(); } return;
      case '+': case '=': e.preventDefault(); return window.__zoomBy?.(1.4);
      case '-': case '_': e.preventDefault(); return window.__zoomBy?.(1 / 1.4);
      case '0': e.preventDefault(); return window.__zoomReset?.();
      default: break;
    }
    const label = KEY_TO_LABEL[e.key.toLowerCase()];
    if (label) { e.preventDefault(); s.addEvent(label, t); pushToast(`${labelTitle(label)} at ${t.toFixed(2)}s`, 'ok'); }
  }, [stepFrame, pushToast]);

  // warn before losing unsaved work
  useEffect(() => {
    const h = (e) => { if (useStore.getState().dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar dirHandle={dirHandle} setDirHandle={setDirHandle} />
      <main className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          {videoUrl ? (
            <>
              <div className="min-h-0 flex-[7]"><VideoStage /></div>
              <div className="min-h-0 flex-[3]"><Timeline /></div>
            </>
          ) : (
            <div className="min-h-0 flex-1"><DropZone /></div>
          )}
        </div>
        <EventList />
      </main>

      <ActionMenu />
      <Shortcuts />

      {/* toasts */}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={`flex items-center gap-2 rounded-lg border bg-ink-800 px-4 py-2 text-sm shadow-lift ${
            t.kind === 'ok' ? 'border-pitch-500/50' : t.kind === 'err' ? 'border-avoid-500/50' : 'border-white/10'
          }`}>
            {t.kind && <span className={t.kind === 'ok' ? 'text-pitch-400' : 'text-avoid-500'}>●</span>}
            <span className="text-ink-100">{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
