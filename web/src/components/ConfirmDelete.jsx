import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Trash2, X } from 'lucide-react';

/**
 * Deleting ground truth is unrecoverable, so the dialog names exactly what goes
 * and what survives — a bare "are you sure?" tells the analyst nothing they can
 * weigh.
 */
export default function ConfirmDelete({ open, clip, actionCount, busy, onConfirm, onClose }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="panel w-full max-w-md overflow-hidden"
          >
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-5 py-3.5">
              <AlertTriangle size={16} className="text-avoid-500" />
              <h2 className="text-sm font-bold text-white">Delete this ground truth?</h2>
              <button onClick={onClose} className="ml-auto rounded-lg p-1.5 text-ink-400 transition hover:bg-white/10 hover:text-white">
                <X size={15} />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              <p className="text-xs leading-relaxed text-ink-300">
                <span className="font-mono text-ink-100">{clip}</span> has{' '}
                <span className="font-semibold text-white">{actionCount}</span>{' '}
                {actionCount === 1 ? 'action' : 'actions'}. Deleting removes both files:
              </p>

              <ul className="space-y-1 rounded-lg border border-white/[0.06] bg-ink-900/60 px-3 py-2.5 font-mono text-2xs text-ink-400">
                <li>data/&lt;id&gt;.json <span className="text-ink-600">— the working record</span></li>
                <li>groundtruth/{String(clip ?? '').replace(/\.[^.]+$/, '')}.json <span className="text-ink-600">— the deliverable</span></li>
              </ul>

              <p className="text-2xs leading-relaxed text-ink-500">
                The clip itself is not touched — it goes back to the queue as unannotated, so you can start it again
                from scratch. This cannot be undone.
              </p>
            </div>

            <div className="flex gap-2 border-t border-white/[0.06] px-5 py-3.5">
              <button onClick={onConfirm} disabled={busy} className="btn-danger flex-1">
                <Trash2 size={14} /> {busy ? 'Deleting…' : 'Delete ground truth'}
              </button>
              <button onClick={onClose} disabled={busy} className="btn-ghost">
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
