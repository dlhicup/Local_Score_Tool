import fs from 'node:fs/promises';
import path from 'node:path';
import { GT_DIR, findGroundTruth, fileFor } from './gtfile.js';
import { writeFileAtomic } from './atomic.js';

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
 * The history is written as sentences. It exists to be read by a person asking
 * what a reviewer changed, so that is what it says, in those words, with the
 * frame to go and look at.
 */

/** `Review.` + the clip's name. Case-insensitive, since Windows is. */
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
 * A clip with no ground truth yet gets one at the top of groundtruth/.
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

const empty = (videoName) => ({ clip: clipBase(videoName), reviews: [], signedOff: null });

/** A clip's review file, or an empty one. Never throws: this runs on page load. */
export async function readReviewFile(videoName) {
  const target = await reviewPathFor(videoName);
  if (!target) return empty(videoName);
  let doc;
  try {
    doc = JSON.parse(await fs.readFile(target, 'utf8'));
  } catch {
    return empty(videoName);
  }
  return {
    clip: typeof doc?.clip === 'string' ? doc.clip : clipBase(videoName),
    reviews: Array.isArray(doc?.reviews) ? doc.reviews.filter((x) => x && typeof x === 'object') : [],
    signedOff: doc?.signedOff && typeof doc.signedOff === 'object' ? doc.signedOff : null,
    // Anything a later version adds is read back and written out again.
    ...(doc && typeof doc === 'object' ? extraKeys(doc) : {}),
  };
}

/** Whatever else the file carries, so a save never drops it. */
function extraKeys(doc) {
  const { clip, reviews, signedOff, ...rest } = doc;
  return rest;
}

/**
 * How many entries a file keeps. Generous because this file is no longer part
 * of the hand-off, so its size costs nothing but disk.
 */
export const REVIEW_LOG_MAX = 500;

/**
 * Write the file out, or delete it when there is nothing left to say.
 *
 * One change per line: the sentences are the point of the file, and a reader
 * scrolling it should get one per line rather than a reflowed block.
 */
async function persist(videoName, doc) {
  const target = await reviewPathFor(videoName);
  if (!target) return null;

  if (!doc.reviews.length && !doc.signedOff) {
    await fs.unlink(target).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    return { path: target, removed: true };
  }

  const { clip, reviews, signedOff, ...rest } = doc;
  const head = [`  "clip": ${JSON.stringify(clip)}`];
  if (signedOff) head.push(`  "signedOff": ${JSON.stringify(signedOff)}`);
  for (const [k, v] of Object.entries(rest)) head.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);

  const entries = reviews.slice(-REVIEW_LOG_MAX).map((r) => {
    const { changes, ...meta } = r;
    const lines = Object.entries(meta).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    const list = Array.isArray(changes) && changes.length
      ? `[\n${changes.map((c) => `        ${JSON.stringify(c)}`).join(',\n')}\n      ]`
      : '[]';
    lines.push(`      "changes": ${list}`);
    return `    {\n${lines.join(',\n')}\n    }`;
  });

  const body = `{\n${head.join(',\n')},\n  "reviews": [\n${entries.join(',\n')}\n  ]\n}\n`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await writeFileAtomic(target, body);
  return { path: target, count: doc.reviews.length };
}

/** Add one review to a clip's history. */
export async function appendReview(videoName, entry) {
  if (!entry) return null;
  const doc = await readReviewFile(videoName);
  doc.reviews = [...doc.reviews, entry];
  return persist(videoName, doc);
}

/** Record or clear the sign-off. `null` clears it. */
export async function setSignedOff(videoName, value) {
  const doc = await readReviewFile(videoName);
  doc.signedOff = value || null;
  return persist(videoName, doc);
}

/** Just the two things a listing needs, without reading the whole history. */
export async function reviewStatus(videoName) {
  const doc = await readReviewFile(videoName);
  return { signedOff: doc.signedOff, reviewCount: doc.reviews.length };
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
        const key = clip.toLowerCase();
        // Shallowest wins, as with ground truth, so the answer never depends on
        // the order the filesystem happened to return.
        const rel = path.relative(GT_DIR, full);
        const existing = out.get(key);
        if (!existing || rel.split(path.sep).length < existing.rel.split(path.sep).length) {
          out.set(key, { clip, path: full, rel });
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
    const doc = JSON.parse(await fs.readFile(full, 'utf8'));
    return {
      clip: typeof doc?.clip === 'string' ? doc.clip : clipForReviewFile(path.basename(full)),
      reviews: Array.isArray(doc?.reviews) ? doc.reviews.filter((x) => x && typeof x === 'object') : [],
      signedOff: doc?.signedOff && typeof doc.signedOff === 'object' ? doc.signedOff : null,
    };
  } catch {
    return null;
  }
}
