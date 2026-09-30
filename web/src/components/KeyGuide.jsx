import { PanelRightClose, PanelRightOpen, Keyboard } from 'lucide-react';
import { useStore } from '../store/useStore';
import {
  EVENT_LABELS, LABEL_META, LABEL_GROUPS, labelTitle,
  TEAMS, TEAM_META, SURE_LEVELS,
} from '../lib/labels';

/**
 * The key for every action, always on screen.
 *
 * Fifteen labels is more than anyone holds in their head on day one, and the
 * shortcuts dialog covers the video — exactly what you need to see while
 * deciding which key to press. This sits in its own column instead, so the
 * picture is never obscured, only narrowed. Collapsing it gives the width back.
 */
export default function KeyGuide({ open, onToggle }) {
  const hotkeyFor = useStore((s) => s.hotkeyFor);

  if (!open) {
    return (
      <button
        onClick={onToggle}
        title="Show the action keys"
        className="flex h-full w-full flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-ink-800/60 py-3 text-ink-500 transition hover:border-white/15 hover:text-ink-200"
      >
        <PanelRightOpen size={15} />
        <span className="[writing-mode:vertical-rl] text-2xs font-semibold uppercase tracking-wider">Keys</span>
      </button>
    );
  }

  return (
    <div className="panel">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Keyboard size={13} className="text-ink-500" />
        <span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-ink-400">Action keys</span>
        <button
          onClick={onToggle}
          title="Hide, and give the width back to the picture"
          className="rounded p-1 text-ink-500 transition hover:bg-white/10 hover:text-ink-100"
        >
          <PanelRightClose size={14} />
        </button>
      </div>

      <div className="px-2 py-1.5">
        {LABEL_GROUPS.map((g) => {
          const inGroup = EVENT_LABELS.filter((l) => LABEL_META[l].group === g);
          if (!inGroup.length) return null;
          return (
            <div key={g} className="mb-1.5 last:mb-0">
              <p className="px-1 pb-0.5 pt-1 text-2xs font-semibold uppercase tracking-wider text-ink-600">{g}</p>
              {inGroup.map((l) => (
                <div key={l} className="flex items-center gap-2 rounded px-1 py-[3px]">
                  <kbd className="w-5 shrink-0 rounded border border-white/10 bg-ink-700 text-center font-mono text-2xs uppercase text-ink-200">
                    {hotkeyFor(l) || '·'}
                  </kbd>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: LABEL_META[l].color }} />
                  <span className="flex-1 truncate text-2xs text-ink-300">{labelTitle(l)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* The five tags share this column: they are pressed just as often. */}
      <div className="border-t border-white/[0.06] px-2 py-1.5">
        <p className="px-1 pb-0.5 pt-1 text-2xs font-semibold uppercase tracking-wider text-ink-600">Tag the action</p>

        <div className="flex items-center gap-2 rounded px-1 py-[3px]">
          <span className="flex shrink-0 gap-0.5">
            {TEAMS.map((t) => (
              <kbd
                key={t}
                title={TEAM_META[t].label}
                className="w-5 rounded border text-center font-mono text-2xs uppercase"
                style={{
                  color: TEAM_META[t].color,
                  borderColor: `${TEAM_META[t].color}55`,
                  background: `${TEAM_META[t].color}1a`,
                }}
              >
                {TEAM_META[t].key}
              </kbd>
            ))}
          </span>
          <span className="flex-1 truncate text-2xs text-ink-300">Team A · B · unknown</span>
        </div>

        <div className="flex items-center gap-2 rounded px-1 py-[3px]">
          <kbd className="w-5 shrink-0 rounded border border-amber-500/40 bg-amber-500/15 text-center font-mono text-2xs uppercase text-amber-400">b</kbd>
          <span className="flex-1 truncate text-2xs text-ink-300">
            Click the ball · <span className="text-ink-500">⇧B not visible</span>
          </span>
        </div>

        <div className="flex items-center gap-2 rounded px-1 py-[3px]">
          <span className="flex shrink-0 gap-0.5">
            {SURE_LEVELS.map((l) => (
              <kbd
                key={l.key}
                title={l.hint}
                className="w-5 rounded border border-white/10 bg-ink-700 text-center font-mono text-2xs text-ink-200"
              >
                {l.key}
              </kbd>
            ))}
          </span>
          <span className="flex-1 truncate text-2xs text-ink-300">Sure 1.0 · 0.7 · 0.3</span>
        </div>

        <div className="flex items-center gap-2 rounded px-1 py-[3px]">
          <kbd className="w-5 shrink-0 rounded border border-white/10 bg-ink-700 text-center font-mono text-2xs text-ink-200">v</kbd>
          <span className="flex-1 truncate text-2xs text-ink-300">Body: foot → head → hand → other</span>
        </div>

        <div className="flex items-center gap-2 rounded px-1 py-[3px]">
          <kbd className="w-5 shrink-0 rounded border border-white/10 bg-ink-700 text-center font-mono text-2xs text-ink-200">n</kbd>
          <span className="flex-1 truncate text-2xs text-ink-300">Goal in view: left → right → none</span>
        </div>
      </div>

      <p className="border-t border-white/[0.06] px-3 py-1.5 text-2xs text-ink-600">
        <kbd className="rounded border border-white/10 bg-ink-700 px-1 font-mono text-2xs">?</kbd> for playback and
        editing keys
      </p>
    </div>
  );
}
