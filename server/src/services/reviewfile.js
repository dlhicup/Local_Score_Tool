import fs from 'node:fs/promises';
import path from 'node:path';
import { GT_DIR, findGroundTruth, fileFor } from './gtfile.js';
import { writeFileAtomic } from './atomic.js';
import { EVENT_LABELS } from '../labels.js';

/**
 * A clip's review history, in its own file.
 *
 * `Review.<clip>.json`, beside the ground truth it describes. It used to be two
 * keys inside the clip's own file, which put review bookkeeping into the thing
 * that gets handed off — the deliverable should be the actions and nothing else.
 * Beside it rather than in a folder of its own so that copying a hand-in still
 * brings its history along, which is the whole reason this project keeps one
 * file per clip.
 *
 * One flat list of changes, not one block per save. Everybody reviewing here is
 * the same person, so splitting the list by who did it and in which sitting
 * divided it along the one axis nobody needs, and buried the thing people
 * actually want: the corrections, in the order the clip plays, so they can be
 * walked through against the video.
 */

const PREFIX = 'Review.';
export const isReviewFileName = (basename) =>
  String(basename ?? '').toLowerCase().startsWith(PREFIX.toLowerCase());

/** The clip a review file belongs to, or null if it is not one. */
export function clipForReviewFile(basename) {
  const name = path.basename(String(basename ?? ''));
  if (!isReviewFileName(name)) return null;
  const inner = name.slice(PREFIX.length).replace(/\.json$/i, '');
  return inner || null;
}

const clipBase = (videoName) => path.basename(String(videoName ?? '')).replace(/\.[^.]+$/, '');

/**
 * Where a clip's review file goes: next to its ground truth, wherever that
 * lies, so a hand-in kept in a subfolder keeps its history in the same place.
 */
export async function reviewPathFor(videoName) {
  const base = clipBase(videoName);
  if (!base) return null;
  const found = await findGroundTruth(videoName);
  const dir = found ? path.dirname(found.path) : path.dirname(fileFor(videoName) ?? '');
  if (!dir) return null;
  const full = path.join(dir, `${PREFIX}${base}.json`);
  return full.startsWith(GT_DIR + path.sep) ? full : null;
}

const emptyDoc = (videoName) => ({
  clip: clipBase(videoName),
  reviews: 0,
  actions: null,
  totals: { added: {}, removed: {}, retimed: 0, retagged: 0 },
  changes: [],
  notes: [],
  firstReview: null,
  secondReview: null,
  ignored: null,
});

/**
 * A clip passes two reviews, in order. Each is a sign-off — who, when, over
 * how many actions — and the second cannot stand without the first: a file
 * that claims one without the other is read as having neither past the first.
 *
 * 0  not reviewed
 * 1  first review passed, waiting for the second
 * 2  both passed
 */
export const reviewLevel = (doc) => (doc?.firstReview ? (doc.secondReview ? 2 : 1) : 0);

const asStamp = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const asArr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
const asNum = (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0);

/** A clip's review file, or an empty one. Never throws: this runs on page load. */
export async function readReviewFile(videoName) {
  const target = await reviewPathFor(videoName);
  if (!target) return emptyDoc(videoName);
  try {
    return normalise(JSON.parse(await fs.readFile(target, 'utf8')), videoName);
  } catch {
    return emptyDoc(videoName);
  }
}

function normalise(doc, videoName) {
  const totals = asObj(doc?.totals);
  // `signedOff` is what a single review was called before there were two.
  // It was a first review in all but name, so it reads as one.
  const first = asStamp(doc?.firstReview) || asStamp(doc?.signedOff);
  return {
    clip: typeof doc?.clip === 'string' ? doc.clip : clipBase(videoName),
    summary: typeof doc?.summary === 'string' ? doc.summary : null,
    reviews: asNum(doc?.reviews),
    actions: doc?.actions && typeof doc.actions === 'object'
      ? { first: asNum(doc.actions.first), now: asNum(doc.actions.now) }
      : null,
    totals: {
      added: asObj(totals.added),
      removed: asObj(totals.removed),
      retimed: asNum(totals.retimed),
      retagged: asNum(totals.retagged),
    },
    changes: asArr(doc?.changes),
    notes: Array.isArray(doc?.notes) ? doc.notes.filter((x) => typeof x === 'string') : [],
    firstReview: first,
    secondReview: first ? asStamp(doc?.secondReview) : null,
    // Set aside as too poor to work on: who, when and why. Independent of the
    // review marks, which it leaves as they are.
    ignored: asStamp(doc?.ignored),
  };
}

/** How many changes a file keeps. Generous: it is no longer part of the hand-off. */
export const CHANGES_MAX = 20000;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const tallyTotal = (o) => Object.values(o ?? {}).reduce((n, v) => n + asNum(v), 0);

/** One line describing everything the clip has been through. */
function summarise(doc) {
  // A clip can pass a review without anybody changing a thing, and a review
  // recorded by hand has no edits behind it at all. Neither is "reviewed once".
  if (!doc.reviews) return 'No changes recorded.';
  const { added, removed, retimed, retagged } = doc.totals;
  const bits = [];
  if (tallyTotal(added)) bits.push(`${tallyTotal(added)} added`);
  if (tallyTotal(removed)) bits.push(`${tallyTotal(removed)} removed`);
  if (retimed) bits.push(`${retimed} retimed`);
  if (retagged) bits.push(`${retagged} re-tagged`);

  const over = doc.reviews > 1 ? ` over ${plural(doc.reviews, 'review')}` : '';
  const head = doc.actions
    ? (doc.actions.first === doc.actions.now
      ? `${doc.actions.now} actions, unchanged in number${over}`
      : `${doc.actions.first} actions became ${doc.actions.now}${over}`)
    : `Reviewed${over || ' once'}`;
  return bits.length ? `${head}: ${bits.join(', ')}.` : `${head}.`;
}

const orderTally = (o) => {
  const out = {};
  for (const l of EVENT_LABELS) if (asNum(o[l])) out[l] = asNum(o[l]);
  return out;
};

/**
 * Write the file out, or delete it when there is nothing left to say.
 *
 * One change per line: the sentences are the point of the file, and a reader
 * scrolling it wants one per line rather than a reflowed block.
 */
async function persist(videoName, doc) {
  const target = await reviewPathFor(videoName);
  if (!target) return null;

  if (!doc.changes.length && !doc.notes.length && !doc.firstReview && !doc.reviews && !doc.ignored) {
    await fs.unlink(target).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    return { path: target, removed: true };
  }

  // Clip order, so the list reads the way the clip plays. A change recorded
  // later but earlier in the clip belongs where a reader would look for it.
  doc.changes.sort((a, b) => asNum(a.frame) - asNum(b.frame));
  doc.totals.added = orderTally(doc.totals.added);
  doc.totals.removed = orderTally(doc.totals.removed);

  const head = [
    `  "clip": ${JSON.stringify(doc.clip)}`,
    `  "summary": ${JSON.stringify(summarise(doc))}`,
    `  "reviews": ${doc.reviews}`,
  ];
  if (doc.actions) head.push(`  "actions": ${JSON.stringify(doc.actions)}`);
  head.push(`  "totals": ${JSON.stringify(doc.totals)}`);
  if (doc.firstReview) head.push(`  "firstReview": ${JSON.stringify(doc.firstReview)}`);
  if (doc.firstReview && doc.secondReview) head.push(`  "secondReview": ${JSON.stringify(doc.secondReview)}`);
  if (doc.ignored) head.push(`  "ignored": ${JSON.stringify(doc.ignored)}`);
  if (doc.notes.length) {
    head.push(`  "notes": [\n${doc.notes.map((n) => `    ${JSON.stringify(n)}`).join(',\n')}\n  ]`);
  }

  const kept = doc.changes.slice(-CHANGES_MAX);
  const list = kept.length
    ? `[\n${kept.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]`
    : '[]';

  const body = `{\n${head.join(',\n')},\n  "changes": ${list}\n}\n`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, body);
  return { path: target, count: kept.length };
}

/**
 * Fold one review into the clip's history.
 *
 * `entry` is what reviewlog.js produced: the changes as sentences, the counts
 * behind them, and a note when there was nothing locatable to record.
 */
export async function appendReview(videoName, entry) {
  if (!entry) return null;
  const doc = await readReviewFile(videoName);

  doc.reviews += 1;
  const before = asNum(entry.counts?.before);
  const now = asNum(entry.counts?.after);
  doc.actions = { first: doc.actions ? doc.actions.first : before, now };

  for (const [label, n] of Object.entries(asObj(entry.counts?.added))) {
    doc.totals.added[label] = asNum(doc.totals.added[label]) + asNum(n);
  }
  for (const [label, n] of Object.entries(asObj(entry.counts?.removed))) {
    doc.totals.removed[label] = asNum(doc.totals.removed[label]) + asNum(n);
  }
  doc.totals.retimed += asNum(entry.counts?.retimed);
  doc.totals.retagged += asNum(entry.counts?.retagged);

  doc.changes = [...doc.changes, ...(entry.changes ?? [])];
  if (entry.note) doc.notes = [...doc.notes, entry.note];

  return persist(videoName, doc);
}

/**
 * Set or clear review stages. Each key: undefined leaves it, null clears it,
 * a stamp sets it. Clearing the first clears the second with it, since the
 * second cannot stand alone.
 */
export async function setReviewStages(videoName, { first, second } = {}) {
  const doc = await readReviewFile(videoName);
  if (first !== undefined) doc.firstReview = first || null;
  if (second !== undefined) doc.secondReview = second || null;
  if (!doc.firstReview) doc.secondReview = null;
  return persist(videoName, doc);
}

/**
 * Set a clip aside as too poor to work on, or take that back with null. The
 * stamp says who, when and why. The review marks stay as they are, so a clip
 * that is taken back picks up exactly where it was.
 */
export async function setIgnored(videoName, stamp) {
  const doc = await readReviewFile(videoName);
  doc.ignored = stamp || null;
  return persist(videoName, doc);
}

/** Just what a listing needs, without carrying the whole history around. */
export async function reviewStatus(videoName) {
  const doc = await readReviewFile(videoName);
  return {
    level: reviewLevel(doc),
    firstReview: doc.firstReview,
    secondReview: doc.secondReview,
    reviewCount: doc.reviews,
    changeCount: doc.changes.length,
    ignored: doc.ignored,
  };
}

/**
 * Every review file under groundtruth/, by the clip it describes.
 *
 * Walked rather than derived from the clip index, so a history whose ground
 * truth has since been deleted still turns up — the record of what a reviewer
 * did should not vanish with the thing they did it to.
 */
export async function reviewFileIndex() {
  const out = new Map();
  const walk = async (dir, depth = 0) => {
    if (depth > 6) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.json') && isReviewFileName(e.name)) {
        const clip = clipForReviewFile(e.name);
        if (!clip) continue;
        const rel = path.relative(GT_DIR, full);
        const existing = out.get(clip.toLowerCase());
        if (!existing || rel.split(path.sep).length < existing.rel.split(path.sep).length) {
          out.set(clip.toLowerCase(), { clip, path: full, rel });
        }
      }
    }
  };
  await walk(GT_DIR);
  return out;
}

/** Read a review file by its own path, for listings that already found it. */
export async function readReviewFileAt(full) {
  try {
    return normalise(JSON.parse(await fs.readFile(full, 'utf8')), path.basename(full).slice(PREFIX.length));
  } catch {
    return null;
  }
}
