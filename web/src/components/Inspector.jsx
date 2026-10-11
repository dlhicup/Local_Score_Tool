import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Crosshair, Minus, Plus, Tags, ChevronDown } from 'lucide-react';
import { useStore } from '../store/useStore';
import { EVENT_LABELS, LABEL_META, LABEL_GROUPS, labelTitle, UNSURE_KEY } from '../lib/labels';
import { seconds2 } from '../lib/format';
import { toFrame, frameStep, DEFAULT_FPS } from '../lib/fps';

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
                            onClick={() => { onPick(l); setOpen(false); }}
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

  const step = useStore((s) => s.settings.nudgeStep) || frameStep(DEFAULT_FPS);
  const ev = events.find((e) => e.id === selectedId);

  // Nothing selected means nothing to inspect. Rendering an empty panel just
  // steals height from the list, which is where the work happens.
  if (!ev) return null;

  const color = LABEL_META[ev.type].color;
  const set = (patch) => updateEvent(ev.id, patch);

  return (
    <motion.div layout className="panel">
      {/* Identity */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold leading-tight text-white">{labelTitle(ev.type)}</h2>
          <p className="mt-0.5 font-mono text-2xs text-ink-500">
            {seconds2(ev.timestamp)} · frame {toFrame(ev.timestamp)}
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
            step={0.04}
            min={0}
            value={ev.timestamp.toFixed(2)}
            onChange={(e) => set({ timestamp: Math.max(0, Number(e.target.value) || 0) })}
            className="field w-full py-2 pr-6 text-center font-mono text-sm"
            title="Time in seconds — the frame number is derived from this"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-500">s</span>
        </div>
        <button onClick={() => nudge(ev.id, step)} title="+1 frame  (])" className="btn-ghost px-2.5 py-2">
          <Plus size={14} />
        </button>
        <button onClick={() => seek(ev.timestamp)} title="Jump to this event" className="btn-ghost px-2.5 py-2">
          <Crosshair size={14} />
        </button>
      </div>

      <button
        onClick={() => set({ timestamp: Number(currentTime.toFixed(3)) })}
        className="mx-4 mt-1.5 w-[calc(100%-2rem)] rounded-lg py-1.5 text-2xs font-medium text-ink-500 transition hover:bg-white/[0.04] hover:text-ink-100"
      >
        Snap to playhead ({seconds2(currentTime)})
      </button>

      {/* The one tag. Off means sure, and nothing is written for it. */}
      <div className="mt-3 px-4">
        <label
          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition ${
            ev.unsure
              ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
              : 'border-white/[0.07] text-ink-300 hover:border-white/15'
          }`}
          title="Tick when the label or the frame is a judgement call. Doubt about whether it happened at all means: do not label it."
        >
          <input
            type="checkbox"
            checked={ev.unsure === true}
            onChange={(e) => {
              set({ unsure: e.target.checked ? true : undefined });
              // A focused input switches the shortcuts off; hand focus back so
              // the next label key still marks an action.
              e.target.blur();
            }}
            className="accent-amber-500"
          />
          Unsure
          <span className="kbd ml-auto uppercase">{UNSURE_KEY}</span>
        </label>
      </div>

      {/* Relabel */}
      <div className="mt-3 px-4 pb-4">
        <Relabel current={ev.type} onPick={(l) => set({ type: l })} />
      </div>
    </motion.div>
  );
}
