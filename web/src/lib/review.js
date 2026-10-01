import { REPORTING_FPS } from './fps';

/**
 * What a review session changed.
 *
 * A reviewer opens somebody else's clip, fixes what is wrong, and saves. This
 * works out what "fixed" amounted to, so the clip's file can carry a record of
 * it: how many actions of each label were added, how many removed, and how many
 * of the ones that stayed were moved to a different frame or had a tag changed.
 *
 * Matched by event id, which is exact — but only within one session. Ids are
 * not written to the ground-truth file; they are minted when it is read. So the
 * baseline has to be the events this browser loaded, and the diff has to be
 * taken before the save replaces them with a freshly read set.
 */

const TAG_KEYS = ['team', 'sure', 'body', 'goal_view'];

/** The frame a timestamp lands on, on the same clock the file is written with. */
const frameOf = (e) =>
  Math.max(0, Math.round(Number(((Number(e?.timestamp) || 0) * REPORTING_FPS).toFixed(6))));

/** Every tag of an event as one comparable string, ball answer included. */
function tagsOf(e) {
  const ball = e?.ball_xy === undefined ? 'open' : e.ball_xy === null ? 'hidden' : `${e.ball_xy[0]},${e.ball_xy[1]}`;
  return TAG_KEYS.map((k) => String(e?.[k])).join('|') + `|${ball}|${e?.own_goal === true}`;
}

const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

/** The total across a per-label tally like `{pass: 3, shot: 1}`. */
export const tallyTotal = (o) => Object.values(o ?? {}).reduce((n, v) => n + v, 0);
const sum = (o) => Object.values(o).reduce((n, v) => n + v, 0);

export function reviewDiff(baseline = [], events = []) {
  const was = new Map(baseline.map((e) => [e.id, e]));
  const now = new Set(events.map((e) => e.id));
  const added = {};
  const removed = {};
  let retimed = 0;
  let retagged = 0;

  for (const e of events) {
    const before = was.get(e.id);
    if (!before) { bump(added, e.type); continue; }
    /**
     * Changing an action's label is a removal of one and an addition of the
     * other. That is what it is in label-count terms, and it keeps the
     * arithmetic the server checks — before + added - removed === after, for
     * every label — true. A relabelled action is not also counted as retimed
     * or retagged: it has already been accounted for as two changes.
     */
    if (before.type !== e.type) { bump(removed, before.type); bump(added, e.type); continue; }
    if (frameOf(before) !== frameOf(e)) retimed += 1;
    if (tagsOf(before) !== tagsOf(e)) retagged += 1;
  }
  for (const b of baseline) if (!now.has(b.id)) bump(removed, b.type);

  const addedTotal = sum(added);
  const removedTotal = sum(removed);
  return {
    added,
    removed,
    retimed,
    retagged,
    addedTotal,
    removedTotal,
    before: baseline.length,
    after: events.length,
    /** Nothing to record when this is 0 — the reviewer agreed with the file. */
    touched: addedTotal + removedTotal + retimed + retagged,
  };
}
