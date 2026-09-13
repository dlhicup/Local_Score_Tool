import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ArrowRight, RotateCcw, AlertTriangle, Filter } from 'lucide-react';
import { EVENT_LABELS, LABEL_META, labelTitle } from '../lib/labels';
import { toFrame, REPORTING_FPS } from '../lib/fps';
import { timecode, pct } from '../lib/format';

/**
 * Sanity-check a run before it becomes ground truth.
 *
 * A vision model that cannot resolve the ball tends to emit a plausible-looking
 * football rhythm instead of admitting uncertainty — long pass/pass_received
 * alternations at impossible rates. That output looks fine in a log line and is
 * poison to train on, so the numbers that give it away are computed here.
 */
export function auditRun(events, durationSec) {
  const n = events.length;
  const span = Math.max(1, durationSec || 30);
  const perSec = n / span;

  const counts = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const kinds = Object.keys(counts).length;
  const top2 = Object.values(counts).sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
  const top2Share = n ? top2 / n : 0;

  // Longest run of strictly alternating pass / pass_received.
  let alt = 0;
  let best = 0;
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1].type;
    const b = events[i].type;
    const pair = (a === 'pass' && b === 'pass_received') || (a === 'pass_received' && b === 'pass');
    alt = pair ? alt + 1 : 0;
    best = Math.max(best, alt);
  }

  const flags = [];
  // Even a frantic passage of football does not exceed ~1 discrete action/sec.
  if (perSec > 1.2) flags.push(`${perSec.toFixed(1)} actions per second — real football rarely exceeds ~1`);
  if (n >= 12 && top2Share > 0.85) flags.push(`${Math.round(top2Share * 100)}% of actions are just two labels`);
  if (best >= 8) flags.push(`${best} strictly alternating pass/pass_received in a row`);
  if (n >= 15 && kinds <= 3) flags.push(`only ${kinds} of 15 labels ever used`);

  const meanConf = n ? events.reduce((s, e) => s + (e.confidence ?? 0), 0) / n : 0;
  if (n >= 10 && meanConf > 0.9) flags.push(`mean confidence ${pct(meanConf)} — implausibly certain`);

  return { n, perSec, kinds, top2Share, longestAlternation: best, meanConf, flags, suspicious: flags.length >= 2 };
}

export default function ResultPanel({ result, duration, existingCount, onCommit, onDiscard }) {
  const [filter, setFilter] = useState('');
  const events = result.events ?? [];

  const audit = useMemo(() => auditRun(events, duration), [events, duration]);
  const counts = useMemo(() => {
    const c = {};
    for (const e of events) c[e.type] = (c[e.type] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [events]);

  const shown = filter ? events.filter((e) => e.type === filter) : events;
  const span = Math.max(1, duration || 30);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`panel overflow-hidden ${audit.suspicious ? 'border-amber-500/40' : 'border-pitch-500/25'}`}
    >
      <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
        <CheckCircle2 size={16} className={audit.suspicious ? 'text-amber-400' : 'text-pitch-400'} />
        <h2 className="text-sm font-bold text-white">{events.length} actions extracted</h2>
        <span className="ml-auto font-mono text-2xs text-ink-500">
          {result.stats.raw} raw · {result.stats.analysed} segments · {Math.round(result.stats.elapsed)}s
        </span>
      </div>

      {/* The check that stops bad labels becoming ground truth */}
      {audit.flags.length > 0 && (
        <div className="border-b border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
          <p className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-amber-300">
            <AlertTriangle size={14} /> This output looks unreliable
          </p>
          <ul className="space-y-0.5">
            {audit.flags.map((f) => (
              <li key={f} className="text-2xs leading-relaxed text-amber-200/90">
                · {f}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-2xs leading-relaxed text-amber-200/70">
            A model that cannot resolve the ball tends to invent a plausible rhythm rather than report uncertainty.
            Check a few of these against the video before accepting them.
          </p>
        </div>
      )}

      {/* Where the actions fall across the clip */}
      <div className="border-b border-white/[0.06] px-4 py-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="label-text">Timeline</span>
          <span className="font-mono text-2xs text-ink-600">0–{Math.round(span)}s</span>
        </div>
        <div className="relative h-8 overflow-hidden rounded-lg bg-ink-900/70">
          {events.map((e, i) => (
            <span
              key={i}
              title={`${labelTitle(e.type)} · frame ${toFrame(e.timestamp)} · ${timecode(e.timestamp)}`}
              className="absolute top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-[1px]"
              style={{
                left: `calc(${Math.min(100, (e.timestamp / span) * 100)}% - 1.5px)`,
                background: LABEL_META[e.type]?.color ?? '#94A3B8',
                opacity: filter && e.type !== filter ? 0.15 : 1,
              }}
            />
          ))}
        </div>
      </div>

      {/* Counts double as a filter */}
      <div className="flex flex-wrap gap-1.5 border-b border-white/[0.06] px-4 py-3">
        <button
          onClick={() => setFilter('')}
          className={`rounded-lg border px-2 py-1 text-2xs font-medium transition ${
            filter === '' ? 'border-white/25 bg-white/[0.1] text-white' : 'border-white/[0.07] text-ink-400 hover:text-ink-100'
          }`}
        >
          <Filter size={10} className="mr-1 inline" />
          All {events.length}
        </button>
        {counts.map(([type, n]) => (
          <button
            key={type}
            onClick={() => setFilter(filter === type ? '' : type)}
            className="rounded-lg border px-2 py-1 font-mono text-2xs font-medium transition"
            style={{
              color: filter === type ? '#05070A' : LABEL_META[type].color,
              background: filter === type ? LABEL_META[type].color : `${LABEL_META[type].color}14`,
              borderColor: `${LABEL_META[type].color}44`,
            }}
          >
            {type} {n}
          </button>
        ))}
        {EVENT_LABELS.length - counts.length > 0 && (
          <span className="self-center text-2xs text-ink-600">
            {EVENT_LABELS.length - counts.length} labels unused
          </span>
        )}
      </div>

      {/* The actions themselves, as they will appear in review */}
      <div className="max-h-64 overflow-y-auto px-2 py-1.5">
        {shown.map((e, i) => (
          <div
            key={i}
            className="grid grid-cols-[52px_minmax(0,1fr)_56px_44px] items-center gap-2 rounded px-2 py-1 text-2xs hover:bg-white/[0.03]"
          >
            <span className="font-mono text-pitch-400 tabular">f{toFrame(e.timestamp)}</span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LABEL_META[e.type].color }} />
              <span className="truncate text-ink-200">{labelTitle(e.type)}</span>
              {e.team && <span className="shrink-0 text-ink-600">{e.team}</span>}
            </span>
            <span className="text-right font-mono text-ink-600 tabular">{timecode(e.timestamp)}</span>
            <span
              className={`text-right font-mono tabular ${
                e.confidence > 0.7 ? 'text-pitch-400' : e.confidence > 0.45 ? 'text-amber-400' : 'text-avoid-500'
              }`}
            >
              {pct(e.confidence)}
            </span>
          </div>
        ))}
        {shown.length === 0 && <p className="px-2 py-8 text-center text-xs text-ink-500">No actions.</p>}
      </div>

      <div className="flex gap-2 border-t border-white/[0.06] px-4 py-3">
        <button onClick={() => onCommit('replace')} className={audit.suspicious ? 'btn-ghost flex-1' : 'btn-primary flex-1'}>
          {existingCount ? 'Replace & review' : 'Review these'} <ArrowRight size={14} />
        </button>
        {existingCount > 0 && (
          <button onClick={() => onCommit('append')} className="btn-ghost" title="Keep existing actions">
            Append
          </button>
        )}
        <button onClick={onDiscard} className="btn-ghost" title="Discard this run">
          <RotateCcw size={14} />
        </button>
      </div>

      <p className="px-4 pb-3 text-2xs text-ink-600">
        Frame numbers on the fixed {REPORTING_FPS} fps reporting clock.
      </p>
    </motion.div>
  );
}
