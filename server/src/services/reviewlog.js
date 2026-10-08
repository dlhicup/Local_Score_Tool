import { EVENT_LABELS, LABEL_SET } from '../labels.js';
import { toFrame } from './gtfile.js';

/**
 * A clip's review log: one line per review save that changed something.
 *
 * Reviewing is not a separate workflow with its own store — it is opening
 * somebody else's clip and fixing it. What makes it worth recording is the
 * shape of the fix: which labels gained actions, which lost them, and how many
 * surviving actions were moved or re-tagged. That record lives in the clip's
 * own file, beside the actions, so it travels with the hand-off like everything
 * else here.
 *
 * The split of trust matters. `before` is counted from the file about to be
 * overwritten and `after` from the events replacing it: both are the server's
 * own numbers. Which individual actions were added and which removed is matched
 * by event id in the browser, and ids exist nowhere on disk — so this cannot
 * recompute that classification, but it can refuse one that does not add up.
 */

/** How many entries a file keeps. Older ones fall off the front. */
export const REVIEW_LOG_MAX = 50;

/**
 * Bounds on the per-change detail.
 *
 * The log lives above the actions in the clip's own file, and the file is the
 * deliverable — so the detail that says *where* each change happened cannot be
 * allowed to grow without limit. One review keeps at most CHANGES_MAX records,
 * and only the most recent DETAIL_ENTRIES reviews keep their records at all.
 * Older reviews keep their counts, which is what the totals are read from.
 */
export const CHANGES_MAX = 500;
export const DETAIL_ENTRIES = 10;

const CHANGE_KINDS = new Set(['add', 'del', 'time', 'tag']);
const TAG_NAMES = new Set(['team', 'sure', 'body', 'goal', 'ball', 'og']);

/** A frame number as the file would store one. */
const asFrame = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The client's change records, with anything unusable dropped.
 *
 * Rebuilt field by field rather than passed through: these are written into a
 * file other tools read, so nothing arbitrary from a request body gets in.
 */
function cleanChanges(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    if (!CHANGE_KINDS.has(x.c) || !LABEL_SET.has(x.a)) continue;
    const f = asFrame(x.f);
    if (f === null) continue;
    const rec = { c: x.c, a: x.a, f };
    if (x.c === 'time') {
      const f0 = asFrame(x.f0);
      if (f0 === null) continue;
      rec.f0 = f0;
    }
    if (x.c === 'tag') {
      const k = Array.isArray(x.k) ? x.k.filter((t) => TAG_NAMES.has(t)) : [];
      if (!k.length) continue;
      rec.k = k;
    }
    out.push(rec);
  }
  return out;
}

/**
 * Do the change records account for exactly the tallies already settled?
 *
 * The tallies are checked against the two files; the records are checked against
 * the tallies. So a record list that does not reconcile is dropped rather than
 * written, and the entry keeps its counts — a log that says where is only worth
 * having if the where cannot contradict the how many.
 */
function changesReconcile(changes, { added, removed, retimed, retagged }) {
  const a = {};
  const r = {};
  let t = 0;
  let g = 0;
  for (const x of changes) {
    if (x.c === 'add') a[x.a] = (a[x.a] ?? 0) + 1;
    else if (x.c === 'del') r[x.a] = (r[x.a] ?? 0) + 1;
    else if (x.c === 'time') t += 1;
    else g += 1;
  }
  if (t !== retimed || g !== retagged) return false;
  const labels = new Set([...Object.keys(a), ...Object.keys(r), ...Object.keys(added), ...Object.keys(removed)]);
  for (const l of labels) {
    if ((a[l] ?? 0) !== (added[l] ?? 0)) return false;
    if ((r[l] ?? 0) !== (removed[l] ?? 0)) return false;
  }
  return true;
}

/**
 * Trim a log to what a file should carry: the newest REVIEW_LOG_MAX entries,
 * with per-change detail only on the newest DETAIL_ENTRIES of them.
 */
export function pruneLog(log) {
  const kept = (Array.isArray(log) ? log : []).filter((x) => x && typeof x === 'object').slice(-REVIEW_LOG_MAX);
  const firstDetailed = Math.max(0, kept.length - DETAIL_ENTRIES);
  return kept.map((entry, i) => {
    if (i >= firstDetailed || !entry.changes) return entry;
    const { changes, changesOmitted, ...rest } = entry;
    // The counts stay; only the record of where goes.
    return rest;
  });
}

/**
 * Everything about one action that the file actually stores, as a string.
 *
 * Only what is written counts: a timestamp is compared at the frame it lands
 * on, because that is the file's only precision, and anything finer would make
 * a re-save look like a change.
 */
const signature = (e) =>
  [
    toFrame(e?.timestamp),
    e?.type,
    e?.team,
    e?.sure,
    e?.body,
    e?.goal_view,
    e?.ball_xy === undefined ? 'open' : e.ball_xy === null ? 'hidden' : `${e.ball_xy[0]},${e.ball_xy[1]}`,
    e?.own_goal === true ? 'og' : '',
  ].join(':');

/**
 * Do these two sets of actions say the same thing?
 *
 * Sorted, so a difference in the order two actions on one frame happen to be
 * listed in is not mistaken for an edit.
 */
export function sameActions(a, b) {
  if ((a ?? []).length !== (b ?? []).length) return false;
  const left = (a ?? []).map(signature).sort();
  const right = (b ?? []).map(signature).sort();
  return left.every((s, i) => s === right[i]);
}

const countByType = (events) => {
  const out = {};
  for (const e of events ?? []) if (LABEL_SET.has(e?.type)) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
};

/** A client-supplied per-label tally, with anything unusable dropped. */
const cleanTally = (o) => {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o)) {
    const n = Math.trunc(Number(v));
    if (LABEL_SET.has(k) && Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
};

const clamp = (v, max) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};

const orderTally = (o) => {
  const out = {};
  for (const l of EVENT_LABELS) if (o[l]) out[l] = o[l];
  return out;
};

/**
 * Build the log entry for one review save, or null when the reviewer changed
 * nothing — an entry saying "no difference" is noise in a file somebody has to
 * read.
 */
export function reviewEntry({ before, after, claim = {}, by = null, at = new Date() }) {
  const b = countByType(before);
  const a = countByType(after);
  const beforeCount = (before ?? []).length;
  const afterCount = (after ?? []).length;

  let added = cleanTally(claim?.added);
  let removed = cleanTally(claim?.removed);

  // Does the client's classification account for the change in every label?
  const labels = new Set([...Object.keys(b), ...Object.keys(a), ...Object.keys(added), ...Object.keys(removed)]);
  let derived = false;
  for (const l of labels) {
    if ((a[l] ?? 0) !== (b[l] ?? 0) + (added[l] ?? 0) - (removed[l] ?? 0)) { derived = true; break; }
  }
  if (derived) {
    // Fall back to what the two files alone can prove: the per-label change in
    // count. It loses the detail that one action was swapped for another at the
    // same label, but it cannot be wrong.
    added = {};
    removed = {};
    for (const l of labels) {
      const d = (a[l] ?? 0) - (b[l] ?? 0);
      if (d > 0) added[l] = d;
      else if (d < 0) removed[l] = -d;
    }
  }

  // Neither can be checked here, so both are bounded by what is possible: an
  // action can only be moved or re-tagged if it survived the review.
  const survived = Math.min(beforeCount, afterCount);
  const retimed = derived ? 0 : clamp(claim?.retimed, survived);
  const retagged = derived ? 0 : clamp(claim?.retagged, survived);

  const addedTotal = Object.values(added).reduce((n, v) => n + v, 0);
  const removedTotal = Object.values(removed).reduce((n, v) => n + v, 0);
  if (!addedTotal && !removedTotal && !retimed && !retagged) return null;

  // Where each change happened, kept only when it reconciles with the counts
  // above and the counts were the client's to give in the first place.
  const records = derived ? [] : cleanChanges(claim?.changes);
  const usable = records.length && changesReconcile(records, { added, removed, retimed, retagged })
    ? records
    : [];

  const entry = {
    at: (at instanceof Date ? at : new Date(at)).toISOString(),
    by: typeof by === 'string' && by ? by : null,
    before: beforeCount,
    after: afterCount,
  };
  if (addedTotal) entry.added = orderTally(added);
  if (removedTotal) entry.removed = orderTally(removed);
  if (retimed) entry.retimed = retimed;
  if (retagged) entry.retagged = retagged;
  if (usable.length) {
    entry.changes = usable.slice(0, CHANGES_MAX);
    // Said plainly rather than silently: a reader can tell the list is partial.
    if (usable.length > CHANGES_MAX) entry.changesOmitted = usable.length - CHANGES_MAX;
  }
  // Flagged rather than hidden: a reader can tell this line is the count
  // difference between two files, not a reviewer's own account of the edit.
  if (derived) entry.derived = true;
  return entry;
}
