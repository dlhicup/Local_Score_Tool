import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Flag, ChevronDown, AlertTriangle, GraduationCap, Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../lib/api';
import { useStore } from '../store/useStore';
import { LABEL_META, labelTitle } from '../lib/labels';
import { timecode } from '../lib/format';
import ReadOnlyTimeline from '../components/ReadOnlyTimeline';

const REASON_LABEL = {
  wrong_label: 'Wrong label', mistimed: 'Mistimed', missed_event: 'Missed event',
  extra_event: 'Extra event', off_taxonomy: 'Off-taxonomy', other: 'Other',
};
const FILTERS = [
  { key: 'unreviewed', label: 'Unreviewed' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'approved', label: 'Approved' },
  { key: 'sample', label: 'QC sample' },
  { key: 'all', label: 'All' },
];

/**
 * The reviewer workspace: judge each labeled clip — approve, or flag with a
 * reason and note. Same layout as annotating, but read-only and built around a
 * verdict. On gold clips the reference answer appears as a comparison lane.
 */
export default function Reviewer() {
  const toast = useStore((s) => s.toast);
  const [queue, setQueue] = useState(null);
  const [filter, setFilter] = useState('unreviewed');
  const [sel, setSel] = useState(null);       // clip id
  const [clip, setClip] = useState(null);      // full clip detail
  const [now, setNow] = useState(0);
  const [duration, setDuration] = useState(30);
  const [playing, setPlaying] = useState(false);
  const [verdict, setVerdict] = useState('approved');
  const [reason, setReason] = useState('mistimed');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const video = useRef(null);

  const loadQueue = useCallback(() => {
    api.reviewQueue().then(setQueue).catch((e) => !e.silent && toast(e.message, 'error'));
  }, [toast]);
  useEffect(() => { loadQueue(); }, [loadQueue]);

  const verdictOf = (r) => r.review?.verdict ?? 'unreviewed';
  const visible = useMemo(() => {
    if (!queue) return [];
    return queue.rows.filter((r) => {
      if (filter === 'all') return true;
      if (filter === 'sample') return r.inSample;
      return verdictOf(r) === filter;
    });
  }, [queue, filter]);

  // pick the first clip in view when the list changes and nothing valid is selected
  useEffect(() => {
    if (!visible.length) { setSel(null); return; }
    if (!visible.some((r) => r.id === sel)) setSel(visible[0].id);
  }, [visible, sel]);

  // load the selected clip's detail
  useEffect(() => {
    if (!sel) { setClip(null); return; }
    let live = true;
    setClip(null); setNow(0); setNote(''); setVerdict('approved');
    api.reviewClip(sel).then((d) => { if (live && d.id === sel) setClip(d); }).catch((e) => !e.silent && toast(e.message, 'error'));
    return () => { live = false; };
  }, [sel, toast]);

  const seek = useCallback((s) => { const v = video.current; if (!v) return; v.currentTime = Math.max(0, s); v.pause(); setNow(Math.max(0, s)); }, []);
  const toggle = useCallback(() => { const v = video.current; if (!v) return; v.paused ? v.play().catch(() => {}) : v.pause(); }, []);
  const stepFrame = useCallback((d) => { const v = video.current; if (!v) return; v.pause(); const f = Math.max(0, Math.round(v.currentTime * 25) + d); v.currentTime = f / 25; setNow(f / 25); }, []);

  const rows = clip?.actions ?? [];
  const activeIdx = useMemo(() => { let b = -1; for (let i = 0; i < rows.length; i++) if (rows[i].seconds <= now + 0.05) b = i; return b; }, [rows, now]);
  const matched = useMemo(() => {
    if (!clip?.reference) return null;
    const miss = clip.reference.filter((r) => !rows.some((e) => e.action === r.action && Math.abs(e.seconds - r.seconds) <= 1)).length;
    return { total: clip.reference.length, missed: miss };
  }, [clip, rows]);

  const submit = async () => {
    if (!clip) return;
    setSaving(true);
    try {
      await api.reviewVerdict(clip.id, { verdict, reason: verdict === 'flagged' ? reason : null, note });
      toast(verdict === 'approved' ? `Approved ${clip.clip}` : `Flagged ${clip.clip} — back to ${clip.annotator ?? 'queue'}`, verdict === 'approved' ? 'success' : 'info');
      // advance to the next clip in the current filter, then refresh counts
      const idx = visible.findIndex((r) => r.id === clip.id);
      const next = visible[idx + 1];
      loadQueue();
      setSel(next ? next.id : null);
    } catch (e) { toast(e.message, 'error'); } finally { setSaving(false); }
  };

  const current = queue?.rows.find((r) => r.id === sel);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* header: filters + progress */}
      <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-white/[0.06] px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold text-white"><CheckCircle2 size={16} className="text-pitch-400" /> Review</span>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const n = queue?.summary?.[f.key];
            return (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`rounded-lg px-2.5 py-1 text-xs transition ${filter === f.key ? 'bg-pitch-500/12 text-pitch-400' : 'text-ink-500 hover:bg-white/[0.04] hover:text-ink-200'}`}>
                {f.label}{n != null && <span className="ml-1.5 font-mono text-2xs text-ink-500">{n}</span>}
              </button>
            );
          })}
        </div>
        {queue && (
          <div className="ml-auto flex items-center gap-2.5">
            <span className="font-mono text-xs text-ink-400 tabular">{queue.summary.approved + queue.summary.flagged} / {queue.summary.total} reviewed</span>
            <span className="h-1.5 w-32 overflow-hidden rounded-full bg-ink-700">
              <span className="block h-full rounded-full bg-gradient-to-r from-pitch-600 to-pitch-400" style={{ width: `${queue.summary.total ? Math.round(((queue.summary.approved + queue.summary.flagged) / queue.summary.total) * 100) : 0}%` }} />
            </span>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* queue list */}
        <div className="flex w-56 shrink-0 flex-col border-r border-white/[0.06] bg-ink-800">
          <div className="min-h-0 flex-1 overflow-auto p-1.5">
            {!queue && <div className="space-y-1.5 p-1">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton h-9 rounded-lg" />)}</div>}
            {queue && !visible.length && <div className="px-3 py-8 text-center text-xs text-ink-600">Nothing here.</div>}
            {visible.map((r) => {
              const v = verdictOf(r);
              return (
                <button key={r.id} onClick={() => setSel(r.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${r.id === sel ? 'bg-ink-700 text-white' : 'text-ink-300 hover:bg-white/[0.04]'}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${v === 'approved' ? 'bg-pitch-400' : v === 'flagged' ? 'bg-amber-400' : 'bg-ink-600'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">{r.name.replace('.mp4', '')}</span>
                    <span className="block truncate text-2xs text-ink-600">{r.annotator ?? 'unassigned'}</span>
                  </span>
                  {r.inSample && <span className="shrink-0 font-mono text-[9px] text-pitch-400" title="In the QC sample">QC</span>}
                  <span className="shrink-0 font-mono text-2xs text-ink-500">{r.actions}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* clip + timeline */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          <div className="min-h-0 flex-[7]">
            <div className="relative flex h-full items-center justify-center overflow-hidden rounded-2xl border border-white/[0.07] bg-black">
              {current ? (
                <video
                  key={sel}
                  ref={video}
                  src={api.videoStreamUrl(current.name)}
                  preload="auto"
                  playsInline
                  muted
                  className="h-full w-full object-contain"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 30)}
                  onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onClick={toggle}
                />
              ) : <span className="text-sm text-ink-600">Select a clip to review</span>}

              {current && (
                <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2 text-xs">
                  <span className="rounded-lg border border-white/10 bg-black/50 px-2.5 py-1.5 backdrop-blur"><b className="text-white font-mono">{current.name}</b> <span className="text-ink-300">· {current.annotator ?? 'unassigned'}</span></span>
                  {clip?.reference && <span className="flex items-center gap-1.5 rounded-lg border border-pitch-500/50 bg-pitch-500/10 px-2.5 py-1.5 font-mono text-2xs text-pitch-400"><GraduationCap size={12} /> GOLD · {matched.total - matched.missed}/{matched.total} matched</span>}
                </div>
              )}
              {activeIdx >= 0 && rows[activeIdx] && Math.abs(rows[activeIdx].seconds - now) < 1.2 && (
                <div className="pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 backdrop-blur-md"
                  style={{ borderColor: `${LABEL_META[rows[activeIdx].action]?.color}55`, background: `${LABEL_META[rows[activeIdx].action]?.color}1a` }}>
                  <span className="h-2 w-2 rounded-full" style={{ background: LABEL_META[rows[activeIdx].action]?.color }} />
                  <span className="text-xs font-medium text-white">{labelTitle(rows[activeIdx].action)}</span>
                </div>
              )}
              {current && (
                <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 pb-3 pt-10">
                  <button className="grid h-9 w-9 place-items-center rounded-lg text-white transition hover:bg-white/15" onClick={toggle}>{playing ? <Pause size={17} /> : <Play size={17} />}</button>
                  <button className="grid h-9 w-9 place-items-center rounded-lg text-white/80 transition hover:bg-white/15" onClick={() => stepFrame(-1)}><ChevronLeft size={18} /></button>
                  <button className="grid h-9 w-9 place-items-center rounded-lg text-white/80 transition hover:bg-white/15" onClick={() => stepFrame(1)}><ChevronRight size={18} /></button>
                  <span className="ml-2 font-mono text-xs text-white tabular">{timecode(now)} <span className="text-white/50">/ {timecode(duration, { ms: false })}</span></span>
                  <span className="ml-auto rounded-md bg-pitch-500/15 px-2 py-1 font-mono text-2xs text-pitch-400 tabular">{now.toFixed(2)}s · f{Math.round(now * 25)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-[3]">
            <ReadOnlyTimeline rows={rows} reference={clip?.reference ?? null} duration={duration} currentTime={now} onSeek={seek} activeIdx={activeIdx} />
          </div>
        </div>

        {/* actions + verdict */}
        <aside className="flex w-[320px] shrink-0 flex-col border-l border-white/[0.06] bg-ink-800">
          <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-3.5 py-3">
            <h3 className="label-text">Annotator's actions</h3>
            <span className="ml-auto font-mono text-sm text-pitch-400">{rows.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1.5">
            {clip?.reference && matched && (
              <div className="mb-1.5 flex items-center gap-2 rounded-lg border border-pitch-500/30 bg-pitch-500/[0.06] px-2.5 py-2 text-2xs text-pitch-400">
                <GraduationCap size={13} /> Gold clip — {matched.total - matched.missed} of {matched.total} reference events matched{matched.missed ? `, ${matched.missed} missed` : ''}.
              </div>
            )}
            {rows.map((r, i) => (
              <button key={i} onClick={() => seek(r.seconds)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition ${i === activeIdx ? 'bg-ink-700' : 'hover:bg-white/[0.04]'}`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LABEL_META[r.action]?.color }} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink-200">{labelTitle(r.action)}</span>
                <span className="shrink-0 font-mono text-xs text-ink-400 tabular">{r.seconds.toFixed(2)}s</span>
                <span className="shrink-0 font-mono text-2xs text-ink-600 tabular">f{r.frame}</span>
              </button>
            ))}
            {clip && !rows.length && <div className="px-3 py-6 text-center text-xs text-ink-600">No actions in this clip.</div>}
          </div>

          {/* verdict */}
          <div className="shrink-0 border-t border-white/[0.06] p-3.5">
            {clip?.review?.verdict && (
              <div className="mb-2.5 flex items-center gap-2 text-2xs text-ink-500">
                <span className={clip.review.verdict === 'approved' ? 'text-pitch-400' : 'text-amber-400'}>●</span>
                already {clip.review.verdict}{clip.review.reviewer ? ` by ${clip.review.reviewer}` : ''} — re-reviewing overwrites it
              </div>
            )}
            <p className="label-text mb-2">Verdict</p>
            <div className="mb-2.5 grid grid-cols-2 gap-2">
              <button onClick={() => setVerdict('approved')}
                className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold transition ${verdict === 'approved' ? 'border-pitch-500 bg-pitch-500 text-ink-900' : 'border-white/10 text-ink-300 hover:bg-white/[0.05]'}`}>
                <CheckCircle2 size={15} /> Approve
              </button>
              <button onClick={() => setVerdict('flagged')}
                className={`flex items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-semibold transition ${verdict === 'flagged' ? 'border-amber-400 bg-amber-400/10 text-amber-400' : 'border-white/10 text-ink-300 hover:bg-white/[0.05]'}`}>
                <Flag size={15} /> Flag
              </button>
            </div>
            {verdict === 'flagged' && (
              <div className="relative mb-2.5">
                <select value={reason} onChange={(e) => setReason(e.target.value)}
                  className="w-full appearance-none rounded-lg border border-white/10 bg-ink-700 px-2.5 py-2 text-xs text-ink-200">
                  {Object.entries(REASON_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-2.5 text-ink-500" />
              </div>
            )}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder={verdict === 'flagged' ? 'What needs fixing?' : 'Note (optional)'}
              className="mb-2.5 w-full resize-none rounded-lg border border-white/10 bg-ink-700 px-2.5 py-2 text-xs text-ink-200 placeholder:text-ink-600" />
            <button onClick={submit} disabled={!clip || saving}
              className="btn-primary w-full justify-center disabled:opacity-40">
              {saving ? 'Saving…' : 'Save & next →'}
            </button>
            {verdict === 'flagged' && <p className="mt-2 flex items-start gap-1.5 text-2xs text-ink-500"><AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" /> Flagging returns this clip to {clip?.annotator ?? 'the annotator'}'s queue as “needs fix”.</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
