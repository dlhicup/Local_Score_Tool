import { useMemo } from 'react';
import { ClipboardList, Plus, Minus, Move, Tag } from 'lucide-react';
import { useStore } from '../store/useStore';
import { reviewDiff, tallyTotal } from '../lib/review';
import { LABEL_META, labelTitle } from '../lib/labels';

/**
 * What this review has changed so far, beside the picture.
 *
 * A reviewer is accountable for the edit, so the edit should be visible while
 * it is being made rather than only summarised after the save. These are the
 * same numbers the save writes into the clip's file.
 */

function Tally({ icon: Icon, label, value, tone }) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <Icon size={11} className={tone} />
      <span className={`font-mono text-xs font-semibold tabular ${value ? 'text-ink-100' : 'text-ink-600'}`}>
        {value}
      </span>
      <span className="text-2xs text-ink-500">{label}</span>
    </div>
  );
}

function Breakdown({ title, tally, sign }) {
  const rows = Object.entries(tally ?? {});
  if (!rows.length) return null;
  return (
    <div className="mt-2">
      <p className="label-text mb-1">{title}</p>
      <div className="flex flex-wrap gap-1">
        {rows.map(([type, n]) => (
          <span
            key={type}
            title={`${labelTitle(type)}: ${sign}${n}`}
            className="inline-flex items-center gap-1 rounded border border-white/[0.07] bg-ink-900/60 px-1.5 py-0.5"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: LABEL_META[type]?.color ?? '#94A3B8' }}
            />
            <span className="font-mono text-2xs text-ink-300">{LABEL_META[type]?.short ?? type}</span>
            <span className="font-mono text-2xs font-semibold text-ink-100 tabular">{sign}{n}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ReviewChanges() {
  const events = useStore((s) => s.events);
  const baseline = useStore((s) => s.reviewBaseline);
  const priorCount = useStore((s) => s.project?.meta?.reviews?.length ?? 0);

  const d = useMemo(() => reviewDiff(baseline, events), [baseline, events]);

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center gap-2">
        <ClipboardList size={13} className="text-pitch-400" />
        <h3 className="text-xs font-semibold text-white">Reviewing</h3>
        <span className="ml-auto font-mono text-2xs text-ink-500 tabular">
          {d.before} → {d.after}
        </span>
      </div>

      {d.touched === 0 ? (
        <p className="text-2xs leading-snug text-ink-500">
          Nothing changed yet. Saving now writes the file again and records no review — a review is only
          logged once you have actually changed something.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <Tally icon={Plus} label="added" value={tallyTotal(d.added)} tone="text-pitch-400" />
            <Tally icon={Minus} label="removed" value={tallyTotal(d.removed)} tone="text-avoid-500" />
            <Tally icon={Move} label="retimed" value={d.retimed} tone="text-amber-400" />
            <Tally icon={Tag} label="retagged" value={d.retagged} tone="text-ink-400" />
          </div>
          <Breakdown title="Added" tally={d.added} sign="+" />
          <Breakdown title="Removed" tally={d.removed} sign="−" />
          <p className="mt-2 text-2xs leading-snug text-ink-600">
            Written into the clip's file on save. Changing an action's label counts as one removed and
            one added.
          </p>
        </>
      )}

      {priorCount > 0 && (
        <p className="mt-2 border-t border-white/[0.06] pt-2 text-2xs text-ink-500">
          Reviewed {priorCount} time{priorCount === 1 ? '' : 's'} before.
        </p>
      )}
    </div>
  );
}
