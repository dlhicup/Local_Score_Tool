import { EVENT_LABELS, LABEL_SET, TEAMS } from '../labels.js';
import { toFrame, REPORTING_FPS } from './gtfile.js';

/**
 * What one review changed, written so a person can read it.
 *
 * The history is kept to answer a question somebody asks out loud — "what did
 * the reviewer change on this clip?" — so each change is a sentence saying
 * where it happened and what it was before. The numbers that used to be the
 * whole record are still there beside each sentence, because a spreadsheet
 * wants columns, but they are no longer the thing a reader has to decode.
 *
 * The sentences are written here, on the server, from records the client sends
 * as structured data. Never from text the client supplies: this file is written
 * to disk and read by people, and a log is only worth having if nothing can put
 * words in it that did not happen.
 *
 * The split of trust: `before` is counted from the file the save is about to
 * replace and `after` from the events replacing it — both the server's own.
 * Which individual actions changed is matched by event id in the browser, and
 * ids are minted when a file is read rather than stored in it, so this cannot
 * recompute that classification. It can refuse one that does not add up, and
 * does.
 */

const CHANGE_KINDS = new Set(['add', 'del', 'relabel', 'time', 'tag']);

/** The tags an action carries, and how to say each one in a sentence. */
const TAG_WORDS = {
  team: 'team',
  sure: 'confidence',
  body: 'body part',
  goal: 'goal in view',
  ball: 'ball position',
  og: 'own-goal flag',
};
const TAG_NAMES = new Set(Object.keys(TAG_WORDS));

const asFrame = (v) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** `1250` -> `0:50.00`, so a frame can be found in a player. */
export function clock(frame) {
  const s = Number(frame) / REPORTING_FPS;
  if (!Number.isFinite(s) || s < 0) return '';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
}

const at = (f) => `frame ${f} (${clock(f)})`;

/** An article that reads right before a label. */
const article = (label) => (/^[aeiou]/.test(label) ? 'an' : 'a');

/**
 * A tag value as a sentence says it. Ball positions are a pair or "not
 * visible"; everything else is its own value.
 */
function tagValue(name, value) {
  if (name === 'ball') {
    if (value === null || value === 'hidden') return 'not visible';
    if (Array.isArray(value) && value.length === 2) return `(${Math.round(value[0])}, ${Math.round(value[1])})`;
    if (value === 'open' || value === undefined) return 'unanswered';
    return String(value);
  }
  if (name === 'og') return value === true || value === 'true' ? 'yes' : 'no';
  return String(value);
}

/** One validated record, as a sentence. */
function sentence(rec) {
  switch (rec.c) {
    case 'add':
      return `At ${at(rec.f)}, ${article(rec.a)} ${rec.a} was added${rec.t ? ` for ${rec.t}` : ''}.`;
    case 'del':
      return `At ${at(rec.f)}, the ${rec.a} was removed.`;
    case 'relabel':
      return `At ${at(rec.f)}, the action was ${rec.a0}, but it was updated to ${rec.a}.`;
    case 'time':
      return `The ${rec.a} at ${at(rec.f0)} was moved to ${at(rec.f)}.`;
    case 'tag': {
      const parts = Object.entries(rec.k).map(([name, [from, to]]) => {
        const word = TAG_WORDS[name];
        return `${word} was updated from ${tagValue(name, from)} to ${tagValue(name, to)}`;
      });
      const joined = parts.length === 1
        ? parts[0]
        : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
      return `At ${at(rec.f)}, the ${rec.a} action's ${joined}.`;
    }
    default:
      return '';
  }
}

/**
 * The client's records, rebuilt field by field. Nothing arbitrary from a
 * request body reaches the file.
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

    if (x.c === 'add' && TEAMS.includes(x.t)) rec.t = x.t;

    if (x.c === 'relabel') {
      if (!LABEL_SET.has(x.a0) || x.a0 === x.a) continue;
      rec.a0 = x.a0;
    }
    if (x.c === 'time') {
      const f0 = asFrame(x.f0);
      if (f0 === null || f0 === f) continue;
      rec.f0 = f0;
    }
    if (x.c === 'tag') {
      if (!x.k || typeof x.k !== 'object' || Array.isArray(x.k)) continue;
      const k = {};
      for (const [name, pair] of Object.entries(x.k)) {
        if (!TAG_NAMES.has(name) || !Array.isArray(pair) || pair.length !== 2) continue;
        // Values are rendered, so only what a tag can actually hold gets in.
        k[name] = [scalar(pair[0]), scalar(pair[1])];
      }
      if (!Object.keys(k).length) continue;
      rec.k = k;
    }
    out.push(rec);
  }
  return out;
}

/** A tag value reduced to something safe to put in a sentence. */
function scalar(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
  if (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(Number(n)))) {
    return [Number(v[0]), Number(v[1])];
  }
  return String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, 40);
}

/** Do the records account for exactly the counts settled against the files? */
function reconcile(changes, { added, removed, retimed, retagged }) {
  const a = {};
  const r = {};
  let t = 0;
  let g = 0;
  const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  for (const x of changes) {
    if (x.c === 'add') bump(a, x.a);
    else if (x.c === 'del') bump(r, x.a);
    else if (x.c === 'relabel') { bump(a, x.a); bump(r, x.a0); }
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

const countByType = (events) => {
  const out = {};
  for (const e of events ?? []) if (LABEL_SET.has(e?.type)) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
};

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

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The one-line headline for a review. Exported so a migration words it the same. */
export function summarise({ before, after, added, removed, retimed, retagged }) {
  const bits = [];
  const a = Object.values(added).reduce((n, v) => n + v, 0);
  const r = Object.values(removed).reduce((n, v) => n + v, 0);
  if (a) bits.push(`${plural(a, 'action')} added`);
  if (r) bits.push(`${plural(r, 'action')} removed`);
  if (retimed) bits.push(`${plural(retimed, 'action')} retimed`);
  if (retagged) bits.push(`${plural(retagged, 'action')} re-tagged`);
  const head = before === after
    ? `${before} actions, unchanged in number`
    : `${before} actions became ${after}`;
  return bits.length ? `${head}: ${bits.join(', ')}.` : `${head}.`;
}

/**
 * Build one review's record, or null when the reviewer changed nothing — an
 * entry saying "no difference" is noise in a file somebody has to read.
 */
export function reviewEntry({ before, after, claim = {}, by = null, when = new Date() }) {
  const b = countByType(before);
  const aft = countByType(after);
  const beforeCount = (before ?? []).length;
  const afterCount = (after ?? []).length;

  let added = cleanTally(claim?.added);
  let removed = cleanTally(claim?.removed);

  const labels = new Set([...Object.keys(b), ...Object.keys(aft), ...Object.keys(added), ...Object.keys(removed)]);
  let derived = false;
  for (const l of labels) {
    if ((aft[l] ?? 0) !== (b[l] ?? 0) + (added[l] ?? 0) - (removed[l] ?? 0)) { derived = true; break; }
  }
  if (derived) {
    added = {};
    removed = {};
    for (const l of labels) {
      const d = (aft[l] ?? 0) - (b[l] ?? 0);
      if (d > 0) added[l] = d;
      else if (d < 0) removed[l] = -d;
    }
  }

  const survived = Math.min(beforeCount, afterCount);
  const retimed = derived ? 0 : clamp(claim?.retimed, survived);
  const retagged = derived ? 0 : clamp(claim?.retagged, survived);

  const addedTotal = Object.values(added).reduce((n, v) => n + v, 0);
  const removedTotal = Object.values(removed).reduce((n, v) => n + v, 0);
  if (!addedTotal && !removedTotal && !retimed && !retagged) return null;

  added = orderTally(added);
  removed = orderTally(removed);

  const records = derived ? [] : cleanChanges(claim?.changes);
  const usable = records.length && reconcile(records, { added, removed, retimed, retagged }) ? records : [];
  usable.sort((x, y) => (x.c === 'time' ? x.f0 : x.f) - (y.c === 'time' ? y.f0 : y.f));

  const entry = {
    at: (when instanceof Date ? when : new Date(when)).toISOString(),
    by: typeof by === 'string' && by ? by : null,
    summary: summarise({ before: beforeCount, after: afterCount, added, removed, retimed, retagged }),
  };

  entry.changes = usable.map((rec) => {
    const row = {
      text: sentence(rec),
      kind: { add: 'added', del: 'removed', relabel: 'relabelled', time: 'retimed', tag: 're-tagged' }[rec.c],
      action: rec.a,
      frame: rec.f,
      time: clock(rec.f),
    };
    if (rec.c === 'relabel') row.wasAction = rec.a0;
    if (rec.c === 'time') { row.fromFrame = rec.f0; row.fromTime = clock(rec.f0); }
    if (rec.c === 'tag') row.tags = Object.keys(rec.k).map((n) => TAG_WORDS[n]).join(', ');
    return row;
  });

  if (!entry.changes.length) {
    // Nothing locatable to say, so say why rather than leaving a bare summary.
    entry.changes = [{
      text: derived
        ? 'The individual changes could not be recorded for this review: the counts above were worked out by comparing the file before and after, because the reviewer\'s own account of the edit did not add up.'
        : 'The individual changes were not recorded for this review.',
      kind: 'note',
    }];
  }

  // Kept for anything adding the log up; the sentences are what it is for.
  entry.counts = { before: beforeCount, after: afterCount };
  if (addedTotal) entry.counts.added = added;
  if (removedTotal) entry.counts.removed = removed;
  if (retimed) entry.counts.retimed = retimed;
  if (retagged) entry.counts.retagged = retagged;
  if (derived) entry.counts.derived = true;

  return entry;
}

/**
 * Everything about one action that the file actually stores, as a string, for
 * deciding whether a save changed anything at all.
 */
const signature = (e) =>
  [
    toFrame(e?.timestamp), e?.type, e?.team, e?.sure, e?.body, e?.goal_view,
    e?.ball_xy === undefined ? 'open' : e.ball_xy === null ? 'hidden' : `${e.ball_xy[0]},${e.ball_xy[1]}`,
    e?.own_goal === true ? 'og' : '',
  ].join(':');

/**
 * Do these two sets of actions say the same thing? Sorted, so a difference in
 * the order two actions on one frame are listed in is not taken for an edit.
 */
export function sameActions(a, b) {
  if ((a ?? []).length !== (b ?? []).length) return false;
  const left = (a ?? []).map(signature).sort();
  const right = (b ?? []).map(signature).sort();
  return left.every((s, i) => s === right[i]);
}
