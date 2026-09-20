import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Crosshair, Minus, Plus, Tags, ChevronDown, Target, XCircle } from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  EVENT_LABELS, LABEL_META, LABEL_GROUPS, labelTitle, ballAnswered,
  TEAMS, TEAM_META, TEAM_A, TEAM_B, SURE_LEVELS, BODY_PARTS, GOAL_VIEWS,
} from '../lib/labels';
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

/** A labelled row of mutually exclusive choices. */
function Choice({ label, hint, options, value, onPick }) {
  return (
    <div>
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-ink-600" title={hint}>{label}</p>
      <div className="flex gap-1">
        {options.map((o) => {
          const on = o.value === value;
          const tint = o.color ?? '#94A3B8';
          return (
            <button
              key={String(o.value)}
              onClick={() => onPick(o.value)}
              title={o.hint}
              className="flex-1 rounded-lg border px-1.5 py-1.5 text-xs font-medium transition hover:brightness-125"
              style={{
                color: on ? '#05070A' : tint,
                background: on ? tint : `${tint}14`,
                borderColor: on ? tint : `${tint}38`,
              }}
            >
              {o.label}
              {o.key && <span className="ml-1 font-mono text-2xs opacity-60">{o.key}</span>}
            </button>
          );
        })}
      </div>
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
  const kit = useStore((s) => s.kit);
  const ballPick = useStore((s) => s.ballPick);
  const setBallPick = useStore((s) => s.setBallPick);

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

      {/* The five tags. Every event carries all of them. */}
      <div className="mt-3 space-y-2.5 px-4">
        <Choice
          label="Team"
          hint="The team of the player whose contact defines this frame — read the shirt, do not infer from the direction of play"
          value={ev.team}
          onPick={(v) => set({ team: v })}
          options={TEAMS.map((t) => ({
            value: t, label: TEAM_META[t].label, key: TEAM_META[t].key, color: TEAM_META[t].color,
          }))}
        />

        {/* Which shirt is which, so the tag can be read off a single frame. */}
        {kit && (
          <div className="-mt-1 flex items-center gap-3 rounded-lg border border-white/[0.06] px-2.5 py-1.5">
            {/* kits.json keys its sides the same way the tag does. */}
            {[TEAM_A, TEAM_B].map((team) => {
              const side = TEAM_META[team].kitKey;
              return (
                <span key={team} className="flex min-w-0 items-center gap-1.5 text-2xs text-ink-400">
                  <span
                    className="h-3 w-3 shrink-0 rounded-sm border border-white/25"
                    style={{ background: kit[side]?.shirt || 'transparent' }}
                    title={kit[side]?.shirt ?? 'shirt colour not given'}
                  />
                  <span className="truncate">
                    <b className="text-ink-300">{TEAM_META[team].label}</b>
                    {kit[side]?.name ? ` · ${kit[side].name}` : ''}
                  </span>
                  {kit[side]?.shirt && <span className="text-ink-600">{kit[side].shirt}</span>}
                </span>
              );
            })}
            {kit.kits_similar && (
              <span className="ml-auto shrink-0 text-2xs text-amber-400" title="The two shirts are close in brightness">
                similar kits
              </span>
            )}
          </div>
        )}

        {/* Ball position: one click on the centre of the ball. */}
        <div>
          <p className="mb-1 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-ink-600">
            Ball at this frame
            {!ballAnswered(ev) && (
              <span className="rounded bg-amber-500/15 px-1.5 py-px text-2xs font-semibold text-amber-400">
                needed
              </span>
            )}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setBallPick(!ballPick)}
              className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                ballPick
                  ? 'border-pitch-500 bg-pitch-500 text-ink-900'
                  : 'border-white/[0.07] text-ink-400 hover:border-white/15 hover:text-ink-100'
              }`}
              title="Click the centre of the ball in the picture (b)"
            >
              <Target size={12} className="mr-1 inline" />
              {ballPick ? 'Click the ball…' : ev.ball_xy ? `${ev.ball_xy[0]}, ${ev.ball_xy[1]}` : 'Set position'}
            </button>
            <button
              onClick={() => { set({ ball_xy: null }); setBallPick(false); }}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                ev.ball_xy === null
                  ? 'border-white/25 bg-white/[0.1] text-white'
                  : 'border-white/[0.07] text-ink-400 hover:border-white/15 hover:text-ink-100'
              }`}
              title="The ball is hidden or out of the picture at this frame — a valid answer, not a skipped field"
            >
              <XCircle size={12} className="mr-1 inline" />
              Not visible
            </button>
          </div>
        </div>

        <Choice
          label="Sure"
          hint="Doubt about the class or the timing. Doubt about whether it happened at all means: do not label it."
          value={ev.sure}
          onPick={(v) => set({ sure: v })}
          options={SURE_LEVELS.map((l) => ({ value: l.value, label: l.label, key: l.key, hint: l.hint }))}
        />

        <Choice
          label="Body"
          hint="The body part making the contact that defines this frame"
          value={ev.body}
          onPick={(v) => set({ body: v })}
          options={BODY_PARTS.map((b) => ({ value: b, label: b }))}
        />

        <Choice
          label="Goal in view"
          hint="Which goal mouth is in the picture at this frame — not where play is going"
          value={ev.goal_view}
          onPick={(v) => set({ goal_view: v })}
          options={GOAL_VIEWS.map((g) => ({ value: g, label: g }))}
        />

        {ev.type === 'goal' && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.07] px-2.5 py-2 text-xs text-ink-300 transition hover:border-white/15">
            <input
              type="checkbox"
              checked={ev.own_goal === true}
              onChange={(e) => set({ own_goal: e.target.checked ? true : undefined })}
              className="accent-pitch-500"
            />
            Own goal
            <span className="ml-auto text-2xs text-ink-600">team stays the credited side</span>
          </label>
        )}
      </div>

      {/* Relabel */}
      <div className="mt-3 px-4 pb-4">
        <Relabel current={ev.type} onPick={(l) => set({ type: l })} />
      </div>
    </motion.div>
  );
}
