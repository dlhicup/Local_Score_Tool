import { useMemo, useState } from 'react';
import { ClipboardList, Plus, Minus, Move, Tag, CheckCircle2, Loader2, XCircle, Download } from 'lucide-react';
import { useStore } from '../store/useStore';
import { reviewDiff, tallyTotal } from '../lib/review';
import { LABEL_META, labelTitle } from '../lib/labels';
import { relativeTime } from '../lib/format';
import { api } from '../lib/api';

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

/** One review stage: its box, and who passed it when — or that it has not been. */
function StageLine({ n, stamp, blocked }) {
  const name = n === 1 ? '1st review' : '2nd review';
  return (
    <div className="flex items-center gap-2 text-2xs">
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded font-mono text-[10px] font-bold ${
          stamp ? 'bg-pitch-500 text-ink-950' : 'border border-white/15 text-ink-600'
        }`}
      >
        {n}
      </span>
      {stamp ? (
        <span className="text-ink-300">
          {name} passed{stamp.at ? ` ${relativeTime(stamp.at)}` : ''}
          {typeof stamp.actions === 'number' ? ` over ${stamp.actions} actions` : ''}
        </span>
      ) : (
        <span className="text-ink-600">{name} {blocked ? 'comes after the 1st' : 'not yet'}</span>
      )}
    </div>
  );
}

export default function ReviewChanges() {
  const events = useStore((s) => s.events);
  const baseline = useStore((s) => s.reviewBaseline);
  // A count since the log was flattened into one list, not an array of
  // reviews — reading `.length` off it gave undefined, so this line never
  // appeared.
  const priorCount = useStore((s) => Number(s.project?.meta?.reviews) || 0);
  const level = useStore((s) => s.project?.meta?.reviewLevel ?? 0);
  const first = useStore((s) => s.project?.meta?.firstReview ?? null);
  const second = useStore((s) => s.project?.meta?.secondReview ?? null);
  const clip = useStore((s) => s.project?.video?.filename ?? null);
  const finishReview = useStore((s) => s.finishReview);
  const clearReviewed = useStore((s) => s.clearReviewed);
  const [finishing, setFinishing] = useState(false);
  const [clearing, setClearing] = useState(false);

  const d = useMemo(() => reviewDiff(baseline, events), [baseline, events]);

  // Which review finishing would sign: the 1st on an unreviewed clip, the
  // 2nd once the 1st has passed.
  const nextStage = level === 0 ? 1 : 2;
  // Both passed, and nothing touched since: nothing left to do on this clip.
  const settled = level === 2 && d.touched === 0;

  const finish = async () => {
    setFinishing(true);
    try {
      await finishReview();
    } catch {
      /* the store has already said why */
    } finally {
      setFinishing(false);
    }
  };

  const unreview = async () => {
    setClearing(true);
    try {
      await clearReviewed();
    } catch {
      /* already reported */
    } finally {
      setClearing(false);
    }
  };

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

      <div className="mt-3 border-t border-white/[0.06] pt-3">
        {/* Signing off and saving are one request: a sign-off must not be able
            to land without the actions it signs off on. */}
        <div className="flex gap-1.5">
          <button
            onClick={finish}
            disabled={finishing || clearing}
            title={
              settled
                ? 'Both reviews have passed. Press to sign the 2nd off again.'
                : nextStage === 1
                  ? 'Save the clip and pass its 1st review'
                  : level === 2
                    ? 'Save the clip and sign its 2nd review off again, with the changes you have just made'
                    : 'Save the clip and pass its 2nd review'
            }
            className={
              settled
                ? 'flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-pitch-500/40 bg-pitch-500/[0.10] px-3 py-1.5 text-xs font-semibold text-pitch-400 transition hover:bg-pitch-500/20 disabled:opacity-50'
                : 'btn-primary flex-1 justify-center'
            }
          >
            {finishing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {finishing ? 'Finishing…' : settled ? 'Both reviews passed' : `Finish ${nextStage === 1 ? '1st' : '2nd'} review`}
          </button>

          {/* Only offered when there is a mark to take off. Takes off the
              highest one and nothing else: edits on screen stay unsaved. */}
          {level > 0 && (
            <button
              onClick={unreview}
              disabled={finishing || clearing}
              title={`Take the ${level === 2 ? '2nd' : '1st'} review mark off this clip. Its actions are not touched.`}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-ink-400 transition hover:border-avoid-500/40 hover:bg-avoid-500/10 hover:text-avoid-500 disabled:opacity-50"
            >
              {clearing ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
              Unmark {level === 2 ? '2nd' : '1st'}
            </button>
          )}
          </div>

        <div className="mt-2 space-y-1">
          <StageLine n={1} stamp={first} />
          <StageLine n={2} stamp={second} blocked={!first} />
        </div>
        {/* Edits made here are part of the review in progress, so they keep
            the 1st review while the 2nd happens. Only a clip that has passed
            both loses something, and it should say so before the save. */}
        {level === 2 && d.touched > 0 && (
          <p className="mt-1.5 text-2xs leading-snug text-amber-400">
            Saving these changes takes the 2nd review off until you finish it again.
          </p>
        )}

        {priorCount > 0 && (
          <p className="mt-1.5 flex items-center gap-1.5 text-2xs text-ink-600">
            <span>{priorCount} earlier review{priorCount === 1 ? '' : 's'} on record.</span>
            {clip && (
              <a
                href={api.reviewLogUrl({ clip, format: 'txt' })}
                download
                title="Download this clip's review log, written out in full"
                className="inline-flex items-center gap-1 font-semibold text-ink-400 underline decoration-dotted transition hover:text-pitch-400"
              >
                <Download size={10} /> Log
              </a>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
