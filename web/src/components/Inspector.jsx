import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Crosshair, Minus, Plus, Tags, ChevronDown, User } from 'lucide-react';
import { useStore } from '../store/useStore';
import { EVENT_LABELS, LABEL_META, LABEL_GROUPS, labelTitle } from '../lib/labels';
import { timecode, seconds2 } from '../lib/format';
import { toFrame, toSeconds, frameStep, DEFAULT_FPS } from '../lib/fps';

/**
 * Relabelling expands in place rather than floating above the panel.
 *
 * An absolutely-positioned popover inside a scrolling column gets clipped by
 * that column on a short window, and no amount of flip-up maths fixes it
 * reliably. Expanding inline means the column simply scrolls to reveal it.
 */
function Relabel({ current, onPick }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className="btn-ghost w-full text-xs">
        <Tags size={14} /> Change label
        <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="overflow-hidden"
          >
            <div className="space-y-2.5 pt-2.5">
              {LABEL_GROUPS.map((g) => {
                const inGroup = EVENT_LABELS.filter((l) => LABEL_META[l].group === g);
                if (!inGroup.length) return null;
                return (
                  <div key={g}>
                    <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-600">{g}</p>
                    <div className="flex flex-wrap gap-1">
                      {inGroup.map((l) => {
                        const on = l === current;
                        return (
                          <button
                            key={l}
                            onClick={() => {
                              onPick(l);
                              setOpen(false);
                            }}
                            className="rounded-lg border px-2 py-1 font-mono text-2xs font-medium transition hover:brightness-125"
                            style={{
                              color: on ? '#05070A' : LABEL_META[l].color,
                              background: on ? LABEL_META[l].color : `${LABEL_META[l].color}14`,
                              borderColor: on ? LABEL_META[l].color : `${LABEL_META[l].color}38`,
                            }}
                          >
                            {l}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Inspector() {
  const events = useStore((s) => s.events);
  const selectedId = useStore((s) => s.selectedId);
  const updateEvent = useStore((s) => s.updateEvent);
  const deleteEvent = useStore((s) => s.deleteEvent);
  const nudge = useStore((s) => s.nudge);
  const seek = useStore((s) => s.seek);
  const currentTime = useStore((s) => s.currentTime);
  const project = useStore((s) => s.project);

  const [showDetails, setShowDetails] = useState(false);
  const step = useStore((s) => s.settings.nudgeStep) || frameStep(DEFAULT_FPS);
  const ev = events.find((e) => e.id === selectedId);

  // Nothing selected means nothing to inspect. Rendering an empty panel just
  // steals height from the list, which is where the work happens.
  if (!ev) return null;

  const color = LABEL_META[ev.type].color;

  return (
    <motion.div layout className="panel">
      {/* Identity */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold leading-tight text-white">{labelTitle(ev.type)}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-2xs text-ink-500">
            {seconds2(ev.timestamp)} · frame {toFrame(ev.timestamp)}
            <User size={10} className="text-sky-500" />
          </p>
        </div>
        <button
          onClick={() => deleteEvent(ev.id)}
          title="Delete (Del)"
          className="shrink-0 rounded-lg p-2 text-ink-500 transition hover:bg-avoid-500/15 hover:text-avoid-500"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* Timing */}
      <div className="flex items-center gap-1.5 px-4">
        <button onClick={() => nudge(ev.id, -step)} title="−1 frame  ([)" className="btn-ghost px-2.5 py-2">
          <Minus size={14} />
        </button>
        <div className="relative flex-1">
          <input
            type="number"
            step={0.01}
            min={0}
            value={ev.timestamp.toFixed(2)}
            onChange={(e) => updateEvent(ev.id, { timestamp: Math.max(0, Number(e.target.value) || 0) })}
            className="field w-full py-2 pr-6 text-center font-mono text-sm"
            title="Time in seconds — the frame number is derived from this"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-500">
            s
          </span>
        </div>
        <button onClick={() => nudge(ev.id, step)} title="+1 frame  (])" className="btn-ghost px-2.5 py-2">
          <Plus size={14} />
        </button>
        <button onClick={() => seek(ev.timestamp)} title="Jump to this event" className="btn-ghost px-2.5 py-2">
          <Crosshair size={14} />
        </button>
      </div>

      <button
        onClick={() => updateEvent(ev.id, { timestamp: Number(currentTime.toFixed(3)) })}
        className="mx-4 mt-1.5 w-[calc(100%-2rem)] rounded-lg py-1.5 text-2xs font-medium text-ink-500 transition hover:bg-white/[0.04] hover:text-ink-100"
      >
        Snap to playhead ({seconds2(currentTime)})
      </button>

      {/* Relabel */}
      <div className="mt-2 px-4">
        <Relabel current={ev.type} onPick={(l) => updateEvent(ev.id, { type: l })} />
      </div>

      {/* Details, folded away by default */}
      <div className="mt-2 px-4 pb-4">
        <button
          onClick={() => setShowDetails((v) => !v)}
          className="flex w-full items-center gap-1.5 py-1 text-2xs font-semibold uppercase tracking-wider text-ink-500 transition hover:text-ink-200"
        >
          <ChevronDown size={12} className={`transition-transform ${showDetails ? 'rotate-180' : ''}`} />
          Team, player &amp; notes
        </button>

        <AnimatePresence initial={false}>
          {showDetails && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="space-y-2 pt-2">
                <div className="grid grid-cols-3 gap-1.5">
                  {[['home', 'Home'], ['away', 'Away'], [null, 'Unknown']].map(([v, l]) => (
                    <button
                      key={l}
                      onClick={() => updateEvent(ev.id, { team: v })}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                        ev.team === v
                          ? 'border-white/25 bg-white/[0.1] text-white'
                          : 'border-white/[0.07] text-ink-400 hover:border-white/15 hover:text-ink-100'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <input
                  value={ev.player ?? ''}
                  onChange={(e) => updateEvent(ev.id, { player: e.target.value || null })}
                  placeholder="Player (optional)"
                  className="field py-2 text-xs"
                />
                <textarea
                  value={ev.description ?? ''}
                  onChange={(e) => updateEvent(ev.id, { description: e.target.value })}
                  placeholder="Notes…"
                  rows={2}
                  className="field resize-none py-2 text-xs"
                />
                {ev.agreement > 1 && (
                  <p className="text-2xs text-ink-500">
                    Seen in {ev.agreement} overlapping segments — independent agreement.
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
