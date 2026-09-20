import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard } from 'lucide-react';
import { EVENT_LABELS, LABEL_META, labelTitle } from '../lib/labels';

const GROUPS = [
  {
    title: 'Playback',
    items: [
      ['Space', 'Play / pause'],
      ['← →', 'Step one frame back / forward'],
      ['⇧ ← →', 'Jump one second back / forward'],
      [', .', 'Step one frame (same as ← →)'],
      ['1–5', 'Playback speed'],
    ],
  },
  {
    title: 'Tagging the action',
    items: [
      ['z x c', 'Team: home · away · unknown — read the shirt, not the direction of play'],
      ['b', 'Click the centre of the ball · ⇧B marks it not visible'],
      ['6 7 8', 'Sure: 1.0 clear · 0.7 judgement call · 0.3 would not bet on it'],
      ['v', 'Body: foot → head → hand → other'],
      ['n', 'Goal in view: left → right → none'],
    ],
  },
  {
    title: 'Editing',
    items: [
      ['↑ ↓', 'Previous / next action'],
      ['⇧ drag', 'Select every action in a span'],
      ['+ − 0', 'Zoom picture in, out, reset · wheel over it too · drag to pan'],
      ['Del', 'Delete selected · Esc clears a span'],
      ['[ ]', 'Nudge the selected action'],
      ['⌘/Ctrl Z', 'Undo · ⇧ to redo'],
      ['⌘/Ctrl S', 'Save this clip’s ground truth'],
    ],
  },
];

export default function Shortcuts({ open, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="panel max-h-[85vh] w-full max-w-2xl overflow-y-auto p-6"
          >
            <div className="mb-5 flex items-center gap-2.5">
              <Keyboard size={18} className="text-pitch-400" />
              <h2 className="text-base font-bold text-white">Keyboard shortcuts</h2>
              <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              {GROUPS.map((g) => (
                <div key={g.title}>
                  <p className="label-text mb-2.5">{g.title}</p>
                  <div className="space-y-1.5">
                    {g.items.map(([k, d]) => (
                      <div key={k} className="flex items-center gap-3">
                        <span className="kbd shrink-0">{k}</span>
                        <span className="text-xs text-ink-300">{d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6">
              <p className="label-text mb-1">Label keys</p>
              <p className="mb-3 text-xs text-ink-500">
                Press one to drop that action at the playhead. Right-click the video or timeline for the same list.
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
                {EVENT_LABELS.map((l) => (
                  <div key={l} className="flex items-center gap-2">
                    <span className="kbd shrink-0 uppercase">{LABEL_META[l].key}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LABEL_META[l].color }} />
                    <span className="truncate text-xs text-ink-300">{labelTitle(l)}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
