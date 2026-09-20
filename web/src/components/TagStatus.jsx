import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Check, ChevronDown } from 'lucide-react';
import { useStore } from '../store/useStore';
import { teamChecks, unknownShare } from '../lib/labels';
import { seconds2 } from '../lib/format';

/**
 * How well tagged this clip is, from the labelling guide's own checks.
 *
 * Two things it watches. The share of events tagged `unknown`, which the guide
 * asks to keep under 30% — a match above that is returned. And the consistency
 * rules in A.4, which catch the team filled in from habit rather than read off
 * the shirt: a reception that changed team, an interception that did not, a
 * duel whose two halves agree.
 *
 * Advisory, never blocking. Clicking a warning jumps to the event it names.
 */
export default function TagStatus() {
  const events = useStore((s) => s.events);
  const seek = useStore((s) => s.seek);
  const select = useStore((s) => s.select);
  const [open, setOpen] = useState(false);

  const { share, checks } = useMemo(
    () => ({ share: unknownShare(events), checks: teamChecks(events) }),
    [events],
  );

  if (!events.length) return null;

  const overUnknown = share > 0.3;
  const clean = !overUnknown && checks.length === 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="Tagging checks from the labelling guide"
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition ${
          clean
            ? 'border-white/10 text-ink-400 hover:text-ink-100'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15'
        }`}
      >
        {clean ? <Check size={13} /> : <AlertTriangle size={13} />}
        <span className="tabular">{Math.round(share * 100)}% unknown</span>
        {checks.length > 0 && <span className="tabular">· {checks.length}</span>}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-full z-50 mt-2 w-[22rem] overflow-hidden rounded-xl border border-white/10 bg-ink-800 shadow-lift"
          >
            <div className="border-b border-white/[0.06] px-3 py-2">
              <p className={`text-xs font-medium ${overUnknown ? 'text-amber-400' : 'text-ink-300'}`}>
                {Math.round(share * 100)}% of actions have an unknown team
              </p>
              <p className="mt-0.5 text-2xs leading-snug text-ink-500">
                {overUnknown
                  ? 'The guide asks for under 30%. Tag from the shirt — never from the direction of play.'
                  : 'Under the 30% the guide asks for.'}
              </p>
            </div>

            {checks.length === 0 ? (
              <p className="px-3 py-3 text-2xs text-ink-500">
                No consistency problems found in the team tags.
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto">
                {checks.map((c, i) => (
                  <button
                    key={`${c.id}-${i}`}
                    onClick={() => { seek(c.at); select(c.id); setOpen(false); }}
                    className="flex w-full items-start gap-2 border-b border-white/[0.04] px-3 py-2 text-left transition last:border-0 hover:bg-white/[0.04]"
                  >
                    <span className="mt-0.5 font-mono text-2xs tabular text-ink-600">{seconds2(c.at)}</span>
                    <span className="flex-1 text-2xs leading-snug text-ink-300">{c.text}</span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
