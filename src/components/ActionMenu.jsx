import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../store';
import { EVENT_LABELS, LABEL_META, labelTitle } from '../lib/labels';

/** Right-click menu: add an action at the exact time of the click. */
export default function ActionMenu() {
  const menu = useStore((s) => s.menu);
  const closeMenu = useStore((s) => s.closeMenu);
  const addEvent = useStore((s) => s.addEvent);
  const ref = useRef(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) closeMenu(); };
    const esc = (e) => e.key === 'Escape' && closeMenu();
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [menu, closeMenu]);

  return (
    <AnimatePresence>
      {menu && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.12 }}
          style={{ left: pos.x, top: pos.y }}
          className="fixed z-[95] w-56 overflow-hidden rounded-xl border border-white/10 bg-ink-800/95 shadow-lift backdrop-blur-xl"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="border-b border-white/[0.07] px-3 py-2">
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-500">Add action at</p>
            <p className="font-mono text-sm font-bold text-pitch-400">{menu.t.toFixed(2)}s</p>
          </div>
          <div className="max-h-80 overflow-auto p-1.5">
            {EVENT_LABELS.map((l) => (
              <button key={l} onClick={() => { addEvent(l, menu.t); closeMenu(); }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-white/[0.07]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: LABEL_META[l].color }} />
                <span className="flex-1 text-ink-100">{labelTitle(l)}</span>
                <span className="kbd">{LABEL_META[l].key}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
