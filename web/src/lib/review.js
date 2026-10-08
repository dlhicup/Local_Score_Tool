import { REPORTING_FPS } from './fps';

/**
 * What a review session changed.
 *
 * A reviewer opens somebody else's clip, fixes what is wrong, and saves. This
 * works out what "fixed" amounted to, so the clip's review file can say it:
 * which action, at which frame, and what about it changed.
 *
 * Matched by event id, which is exact — but only within one session. Ids are
 * not written to the ground-truth file; they are minted when it is read. So the
 * baseline has to be the events this browser loaded, and the diff has to be
 * taken before the save replaces them with a freshly read set.
 *
 * The records here are structured, not worded. The server turns them into the
 * sentences that get written down, after checking them against the file — a log
 * nothing can put words into is worth more than one written closer to the edit.
 */

/** The frame a timestamp lands on, on the same clock the file is written with. */
const frameOf = (e) =>
  Math.max(0, Math.round(Number(((Number(e?.timestamp) || 0) * REPORTING_FPS).toFixed(6))));

/** The tags an action carries, under the short names the log uses. */
const TAGS = [
  ['team', (e) => e?.team],
  ['sure', (e) => e?.sure],
  ['body', (e) => e?.body],
  ['goal', (e) => e?.goal_view],
  ['ball', (e) => (e?.ball_xy === undefined ? 'open' : e.ball_xy === null ? null : e.ball_xy)],
  ['og', (e) => e?.own_goal === true],
];

const same = (a, b) =>
  Array.isArray(a) && Array.isArray(b) ? a[0] === b[0] && a[1] === b[1] : a === b;

/** Which tags differ, as `{ name: [before, after] }`, or null when none do. */
function changedTags(a, b) {
  const out = {};
  for (const [name, read] of TAGS) {
    const from = read(a);
    const to = read(b);
    if (!same(from, to)) out[name] = [from, to];
  }
  return Object.keys(out).length ? out : null;
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
  const changes = [];

  for (const e of events) {
    const before = was.get(e.id);
    if (!before) {
      bump(added, e.type);
      changes.push({ c: 'add', a: e.type, f: frameOf(e), t: e.team });
      continue;
    }
    /**
     * Relabelling counts as a removal of the old label and an addition of the
     * new one — that is what it is in label-count terms, and it keeps the
     * arithmetic the server checks true for every label. It is still one
     * change to read about, so it is one record: "the action was A, but it was
     * updated to B". A relabelled action is not also reported as retimed or
     * re-tagged; it has already been accounted for.
     */
    if (before.type !== e.type) {
      bump(removed, before.type);
      bump(added, e.type);
      changes.push({ c: 'relabel', a: e.type, a0: before.type, f: frameOf(e) });
      continue;
    }
    if (frameOf(before) !== frameOf(e)) {
      retimed += 1;
      changes.push({ c: 'time', a: e.type, f: frameOf(e), f0: frameOf(before) });
    }
    const tags = changedTags(before, e);
    if (tags) {
      retagged += 1;
      changes.push({ c: 'tag', a: e.type, f: frameOf(e), k: tags });
    }
  }
  for (const b of baseline) {
    if (!now.has(b.id)) {
      bump(removed, b.type);
      changes.push({ c: 'del', a: b.type, f: frameOf(b) });
    }
  }

  // Clip order, so the log reads the way the clip plays. A retime is placed
  // where the action was, since that is where a reader would look for it.
  changes.sort((x, y) => (x.c === 'time' ? x.f0 : x.f) - (y.c === 'time' ? y.f0 : y.f));

  const addedTotal = sum(added);
  const removedTotal = sum(removed);
  return {
    added,
    removed,
    retimed,
    retagged,
    changes,
    addedTotal,
    removedTotal,
    before: baseline.length,
    after: events.length,
    /** Nothing to record when this is 0 — the reviewer agreed with the file. */
    touched: addedTotal + removedTotal + retimed + retagged,
  };
}
