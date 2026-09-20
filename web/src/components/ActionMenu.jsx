import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EVENT_LABELS, LABEL_META, LABEL_GROUPS, labelTitle, TEAM_A, TEAM_B, TEAM_META } from '../lib/labels';
import { useStore } from '../store/useStore';
import { seconds2 } from '../lib/format';

/**
 * Right-click menu for adding an action without touching the keyboard.
 *
 * It carries the time the click happened at, not the time the menu was
 * dismissed at — the video may still be playing while the menu is open, and an
 * action must land where the analyst pointed.
 */
export default function ActionMenu({ open, x, y, atTime, onPick, onClose }) {
  const ref = useRef(null);
  const hotkeyFor = useStore((s) => s.hotkeyFor);
  const [pos, setPos] = useState({ x, y });

  /**
   * Where the menu is mounted.
   *
   * In fullscreen a browser paints only the fullscreen element's subtree, so a
   * menu that lives elsewhere in the tree is simply never drawn — the click
   * registers and nothing appears. Mounting it inside whatever is fullscreen
   * puts it back on screen.
   */
  const [host, setHost] = useState(null);
  useEffect(() => {
    const sync = () => setHost(document.fullscreenElement ?? document.body);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    // Keep the menu on screen when the click lands near an edge.
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth - r.width - 8),
      y: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [open, x, y]);

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open, onClose]);

  if (!host) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.12 }}
          style={{ left: pos.x, top: pos.y }}
          className="fixed z-[95] w-60 overflow-hidden rounded-xl border border-white/10 bg-ink-800/95 shadow-lift backdrop-blur-xl"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="border-b border-white/[0.07] px-3 py-2">
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-500">Add action at</p>
            <p className="font-mono text-sm font-bold text-pitch-400">{seconds2(atTime)}</p>
            <p className="mt-0.5 text-2xs leading-snug text-ink-600">
              Click a row to add it untagged, or pick a side to tag it as you add.
            </p>
          </div>

          <div className="max-h-[340px] overflow-y-auto py-1">
            {LABEL_GROUPS.map((g) => {
              const inGroup = EVENT_LABELS.filter((l) => LABEL_META[l].group === g);
              if (!inGroup.length) return null;
              return (
                <div key={g}>
                  <p className="px-3 pb-0.5 pt-2 text-2xs font-semibold uppercase tracking-wider text-ink-600">{g}</p>
                  {inGroup.map((l) => {
                    const add = (team) => { onPick(l, atTime, team); onClose(); };
                    return (
                      // A row, not a button: the two side buttons sit inside it
                      // and a button cannot legally nest inside another.
                      <div
                        key={l}
                        className="group flex w-full items-center gap-2.5 px-3 py-1.5 transition hover:bg-white/[0.07]"
                      >
                        <button
                          onClick={() => add(undefined)}
                          title={`Add ${labelTitle(l)} with no team yet`}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LABEL_META[l].color }} />
                          <span className="flex-1 truncate text-xs text-ink-100">{labelTitle(l)}</span>
                        </button>

                        {/* The side buttons take the row's width back from the
                            hotkey chip only while the row is hovered, so the
                            menu reads the same as before at rest. */}
                        <span className="flex shrink-0 items-center gap-1">
                          {[TEAM_A, TEAM_B].map((team) => (
                            <button
                              key={team}
                              onClick={() => add(team)}
                              title={`Add ${labelTitle(l)} as ${TEAM_META[team].label}`}
                              className="hidden h-5 w-5 items-center justify-center rounded border text-2xs font-bold transition group-hover:flex hover:brightness-125"
                              style={{
                                color: TEAM_META[team].color,
                                borderColor: `${TEAM_META[team].color}55`,
                                background: `${TEAM_META[team].color}1a`,
                              }}
                            >
                              {TEAM_META[team].short}
                            </button>
                          ))}
                          {hotkeyFor(l) && <span className="kbd uppercase group-hover:hidden">{hotkeyFor(l)}</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    host,
  );
}
