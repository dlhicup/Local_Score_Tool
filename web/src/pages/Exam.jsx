import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GraduationCap, AlertTriangle, ChevronDown, Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../store/useStore';
import { LABEL_META, labelTitle } from '../lib/labels';
import { timecode } from '../lib/format';
import ReadOnlyTimeline from '../components/ReadOnlyTimeline';

/**
 * The reference answers in exam/, laid out like the annotate workspace so a
 * reviewer reads them the same way they write them — but with nothing that
 * can change a thing.
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

  const step = useCallback((frames) => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(duration, v.currentTime + frames / 25));
    setNow(v.currentTime);
  }, [duration]);

  const rows = entry?.rows ?? [];
  const activeIdx = useMemo(() => {
    let best = -1;
    for (let i = 0; i < rows.length; i++) if (rows[i].seconds <= now + 0.05) best = i;
    return best;
  }, [rows, now]);

  const current = list?.entries.find((e) => e.hash === sel);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header: which answer is on screen, and how to switch */}
      <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.06] px-4 py-2.5">
        <GraduationCap size={16} className="text-pitch-400" />
        <span className="text-sm font-semibold text-white">Reference</span>

        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1 text-xs transition hover:bg-white/[0.05]"
          >
            <span className="font-mono text-ink-100">{sel?.slice(0, 14)}…</span>
            {current?.clip && (
              <span
                className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-2xs text-ink-500"
                title={`Same clip appears in the library as ${current.clip}. exam/ files are identified by hash, not by number.`}
              >
                lib {current.clip.replace('.mp4', '')}
              </span>
            )}
            <ChevronDown size={13} className="text-ink-500" />
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 max-h-[60vh] w-64 overflow-y-auto rounded-xl border border-white/10 bg-ink-900/95 p-1 shadow-xl backdrop-blur">
              {list?.entries.map((e) => (
                <button
                  key={e.hash}
                  onClick={() => { setSel(e.hash); setPickerOpen(false); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                    e.hash === sel ? 'bg-pitch-500/12 text-white' : 'text-ink-300 hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">{e.hash.slice(0, 18)}…</span>
                    {e.clip && <span className="block truncate font-mono text-2xs text-ink-600">lib {e.clip.replace('.mp4', '')}</span>}
                  </span>
                  <span className="font-mono text-2xs tabular text-pitch-400">{e.events}</span>
                  {e.offTaxonomy > 0 && <AlertTriangle size={11} className="text-amber-400" />}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="font-mono text-2xs text-ink-500 tabular">{timecode(now)} / {timecode(duration, { ms: false })}</span>
        <div className="flex-1" />
        <span className="rounded-md border border-white/10 px-2 py-0.5 text-2xs uppercase tracking-wider text-ink-500">read-only</span>
        <span className="font-mono text-xs text-ink-300">
          <span className="text-pitch-400">{rows.length}</span> actions
        </span>
      </div>

      {/* Same shape as the workspace: picture over timeline, list beside it */}
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[7fr_3fr] gap-3">
          <div className="min-h-0">
            <div className="relative flex h-full items-center justify-center overflow-hidden rounded-2xl border border-white/[0.07] bg-black">
              {sel && (
                <video
                  key={sel}
                  ref={video}
                  src={api.examVideoUrl(sel)}
                  preload="auto"
                  playsInline
                  muted
                  className="h-full w-full object-contain"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 30)}
                  onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onClick={() => toggle()}
                />
              )}
              {sel && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-3 pt-10">
                  <div className="flex items-center gap-1.5">
                    <button onClick={toggle} title="Play / pause (Space)" className="rounded-lg p-2 text-white transition hover:bg-white/10">
                      {playing ? <Pause size={17} /> : <Play size={17} />}
                    </button>
                    <button onClick={() => step(-1)} title="Back one frame" className="rounded-lg p-2 text-white transition hover:bg-white/10"><ChevronLeft size={17} /></button>
                    <button onClick={() => step(1)} title="Forward one frame" className="rounded-lg p-2 text-white transition hover:bg-white/10"><ChevronRight size={17} /></button>
                    <span className="ml-2 font-mono text-xs text-white tabular">{timecode(now)}</span>
                    <span className="font-mono text-xs text-ink-400 tabular">/ {timecode(duration, { ms: false })}</span>
                    <div className="flex-1" />
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
              {entry && rows.length === 0 && <p className="px-2 py-3 text-xs text-ink-600">No actions in this answer.</p>}
              {!entry && <div className="space-y-1.5 p-1">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-7 rounded-lg" />)}</div>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
