import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  isValidLabel, isBody, isGoalView, isSure, isBallXY, normaliseTeam,
} from '../labels.js';
import { writeFileAtomic } from './atomic.js';

/**
 * The ground-truth file IS the store.
 *
 * There used to be two files per clip: data/<id>.json, which the app loaded,
 * and groundtruth/<clip>.json, the hand-off copy, written on every save and
 * never read. Nothing kept them in step, and when they disagreed the app
 * believed the wrong one — a clip with 181 actions in its deliverable opened
 * as an empty workspace, with no way inside the product to get the work back.
 *
 * Now there is one file per clip and the app reads and writes it directly, so
 * what the annotator sees and what gets handed off cannot drift apart. The few
 * things the studio keeps beside the actions — who annotated the clip, a
 * review verdict — are sibling keys in the same file, so they travel with it
 * when it is copied somewhere else. There is no second folder to keep in step.
 *
 * Frame numbers are on the fixed 25 fps reporting clock, never the source
 * video's own rate. That clock is the file's only precision: a timestamp read
 * back is quantised to 1/25 s.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GT_DIR = path.resolve(ROOT, process.env.GT_DIR || 'groundtruth');

const REPORTING_FPS = 25;

/**
 * Seconds -> reporting frame. toFixed(6) first because 17.9 * 25 evaluates to
 * 447.49999999999994 in float64 and would round down to 447, not 448.
 */
export const toFrame = (seconds) =>
  Math.max(0, Math.round(Number(((Number(seconds) || 0) * REPORTING_FPS).toFixed(6))));

/** Reporting frame -> the timestamp it denotes. */
export const toSeconds = (frame) => Number((Number(frame) / REPORTING_FPS).toFixed(3));

/**
 * `Veo - Match 1.mp4` -> `Veo - Match 1.json`: the clip's own name with the
 * extension swapped. The file is identified by the clip it describes, so the
 * name is preserved as-is rather than rewritten into something else.
 *
 * Spaces and ordinary punctuation are legal in a clip name and must survive.
 * An allow-list of [A-Za-z0-9._-] fitted the old numbered corpus (0002.mp4)
 * but silently rejected every real export. Refuse only what could escape the
 * folder or is not a usable filename.
 */
export function fileFor(videoName) {
  const base = clipKey(videoName);
  if (!base) return null;
  const full = path.join(GT_DIR, `${base}.json`);
  return full.startsWith(GT_DIR + path.sep) ? full : null;
}

/**
 * The name a clip and its ground truth share: the filename without extension.
 * Returns null for anything that could escape the folder or is not a usable
 * filename.
 */
function clipKey(name) {
  // basename() drops any directory part, so what remains cannot point outward.
  const base = path.basename(String(name || '')).replace(/\.[^.]+$/, '').trim();
  if (!base || base === '.' || base === '..') return null;
  // Belt and braces: separators (basename only strips "\" on Windows), and the
  // characters no filesystem accepts in a name.
  if (/[\\/\0]/.test(base) || /[<>:"|?*\x00-\x1f]/.test(base)) return null;
  return base;
}

/**
 * Where ground truth actually lives.
 *
 * Annotators hand work in however suits them — a folder per person, a bundle
 * with its own video and a nested `groundtruth/` inside it, a zip unpacked in
 * place. Insisting every file sit at the top of groundtruth/ would mean
 * rearranging somebody's hand-in before it could be reviewed, so instead the
 * folder is searched to any reasonable depth and files are matched to clips by
 * name. A file is read and rewritten where it lies; nothing is moved.
 */
const MAX_DEPTH = 6;

/**
 * Review histories live beside the ground truth they describe, as
 * `Review.<clip>.json`. They are not ground truth, so they must never be
 * indexed as a clip — otherwise every reviewed clip grows a phantom sibling
 * called "Review.<clip>" that matches no video and gets reported as an
 * orphaned hand-in. Checked here rather than imported from reviewfile.js,
 * which reads this module.
 */
const REVIEW_FILE = /^review\./i;

async function walkJson(dir, out = [], depth = 0) {
  if (depth > MAX_DEPTH) return out;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walkJson(full, out, depth + 1);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.json') && !REVIEW_FILE.test(e.name)) out.push(full);
  }
  return out;
}

// Files arrive from outside the app — copied in, unzipped — so the index
// cannot be cached for long. A couple of seconds is enough to keep one page
// load from walking the tree once per clip, and short enough that a file
// dropped in shows up on the next refresh.
const INDEX_TTL_MS = 2000;
let indexCache = { at: 0, byKey: new Map() };

export function invalidateGroundTruthIndex() {
  indexCache = { at: 0, byKey: new Map() };
}

export async function groundTruthIndex() {
  if (indexCache.byKey.size && Date.now() - indexCache.at < INDEX_TTL_MS) return indexCache.byKey;

  const files = await walkJson(GT_DIR);
  // Shallowest wins, then alphabetical, so which file is chosen never depends
  // on the order the filesystem happened to return.
  files.sort((a, b) => {
    const da = a.split(path.sep).length;
    const db = b.split(path.sep).length;
    return da - db || a.localeCompare(b);
  });

  const byKey = new Map();
  for (const full of files) {
    const key = clipKey(path.basename(full));
    if (!key) continue;
    const k = key.toLowerCase();
    if (!byKey.has(k)) byKey.set(k, { path: full, rel: path.relative(GT_DIR, full), others: [] });
    // Two annotators can label the same clip. Only one can be opened, but the
    // rest are reported so a duplicate is visible rather than silently ignored.
    else byKey.get(k).others.push(path.relative(GT_DIR, full));
  }
  indexCache = { at: Date.now(), byKey };
  return byKey;
}

/** Where a clip's ground truth is, or null when it has none anywhere. */
export async function findGroundTruth(videoName) {
  const key = clipKey(videoName);
  if (!key) return null;
  return (await groundTruthIndex()).get(key.toLowerCase()) ?? null;
}

/**
 * Where to write a clip's ground truth: back where it already lives, or at the
 * top of groundtruth/ when it is new. A save never relocates somebody's file.
 */
export async function targetFor(videoName) {
  const found = await findGroundTruth(videoName);
  return found ? found.path : fileFor(videoName);
}

const uid = () => `evt_${crypto.randomBytes(6).toString('hex')}`;

// ---------------------------------------------------------------- tag repair

/**
 * Whether an action is marked unsure. `unsure: true` is the tag; an older file
 * says the same thing with a `sure` below 1.0, so that is read as unsure too.
 */
const isUnsure = (src) => src?.unsure === true || (isSure(src?.sure) && Number(src.sure) < 1);

/**
 * The tags an older file carries, kept so a save does not drop them.
 *
 * They are no longer asked for, so a new action never has them. One read from
 * a file that does keeps whichever of them are valid, exactly as they were —
 * none is filled in with a default, because a default written into a file is
 * an answer nobody gave.
 */
function legacyTags(src) {
  const out = {};
  const team = normaliseTeam(src?.team);
  if (team) out.team = team;
  if (src && 'ball_xy' in src && src.ball_xy !== undefined && isBallXY(src.ball_xy)) {
    out.ball_xy = src.ball_xy ? [Number(src.ball_xy[0]), Number(src.ball_xy[1])] : null;
  }
  if (isBody(src?.body)) out.body = src.body;
  if (isGoalView(src?.goal_view)) out.goal_view = src.goal_view;
  return out;
}

/**
 * Force one stored row into a valid event. Deliberately forgiving: these
 * files are hand-edited and arrive from other tools. A row with a bad tag
 * loses the tag, not the event.
 */
function eventFromRow(row) {
  if (!isValidLabel(row?.action) || !Number.isFinite(Number(row?.frame))) return null;
  const ev = { id: uid(), type: row.action, timestamp: toSeconds(row.frame), ...legacyTags(row) };
  if (isUnsure(row)) ev.unsure = true;
  // Only a goal can be an own goal; the tag is meaningless elsewhere.
  if (ev.type === 'goal' && row.own_goal === true) ev.own_goal = true;
  return ev;
}

/** The same repair, applied to an event coming from the client. */
export function sanitiseEvent(e) {
  if (!isValidLabel(e?.type)) return null;
  const t = Number(e.timestamp);
  if (!Number.isFinite(t)) return null;
  const ev = {
    id: typeof e.id === 'string' && e.id ? e.id : uid(),
    type: e.type,
    // Snap to the reporting clock on the way in: that is the only precision
    // the file keeps, so storing anything finer just loses it on reload and
    // makes a save look like it changed something.
    timestamp: toSeconds(toFrame(t)),
    ...legacyTags(e),
  };
  if (isUnsure(e)) ev.unsure = true;
  if (ev.type === 'goal' && e.own_goal === true) ev.own_goal = true;
  return ev;
}

// -------------------------------------------------------------------- read

/**
 * Read a clip's events. Returns [] for a clip with no file, and for one that
 * no longer parses — this runs on the path that opens a clip, so it must not
 * throw and leave the annotator staring at an error.
 *
 * Both shapes are accepted: `{"groundtruth": [...]}` and a bare array.
 */
export async function readEvents(videoName) {
  const found = await findGroundTruth(videoName);
  if (!found) return [];
  const target = found.path;
  let doc;
  try {
    doc = JSON.parse(await fs.readFile(target, 'utf8'));
  } catch {
    return [];
  }
  const rows = Array.isArray(doc) ? doc : doc?.groundtruth ?? [];
  return rows
    .map(eventFromRow)
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** The non-event keys of a clip's file, so a save cannot drop them. */
export async function readSidecarKeys(videoName) {
  const found = await findGroundTruth(videoName);
  if (!found) return {};
  const target = found.path;
  try {
    const doc = JSON.parse(await fs.readFile(target, 'utf8'));
    if (Array.isArray(doc)) return {};
    const { groundtruth, ...rest } = doc ?? {};
    return rest;
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------- write

/**
 * One row as it is stored: the frame and the action, then `unsure` only when it
 * is set. Any tags an older file carried follow, in the order that file used,
 * so a diff between two saves shows what actually changed rather than a
 * reshuffle.
 */
export function rowFor(e) {
  const row = { frame: toFrame(e.timestamp), action: e.type };
  if (e.unsure === true) row.unsure = true;
  Object.assign(row, legacyTags(e));
  if (e.type === 'goal' && e.own_goal === true) row.own_goal = true;
  return row;
}

/**
 * A non-action key's value, formatted for the file.
 *
 * A list gets one entry per line, for the same reason the actions do: letting
 * JSON.stringify indent a 50-entry review log puts every field of every entry
 * on its own line and buries the actions under hundreds of lines of history.
 */
function encodeExtra(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[\n${value.map((x) => '    ' + JSON.stringify(x)).join(',\n')}\n  ]`;
  }
  // A flat object — the review sign-off, say — on one line too. Spread over
  // five it is no clearer, and it pushes the actions further down the file.
  if (
    value && typeof value === 'object'
    && Object.values(value).every((v) => v === null || typeof v !== 'object')
  ) {
    return JSON.stringify(value);
  }
  return JSON.stringify(value, null, 2).split('\n').join('\n  ');
}

/**
 * Write a clip's ground truth: one row per line, frame order, ties keeping the
 * order they were added in. Dense enough to read in a terminal, still one
 * valid JSON document.
 */
export async function writeEvents(videoName, events, extraKeys = {}) {
  const target = await targetFor(videoName);
  if (!target) return null;

  const rows = (events ?? [])
    .filter((e) => isValidLabel(e.type))
    .map((e, i) => ({ row: rowFor(e), i }))
    .sort((a, b) => a.row.frame - b.row.frame || a.i - b.i)
    .map(({ row }) => row);

  // One action per line, whether or not the file carries other keys. Letting
  // JSON.stringify indent the array puts every field of every action on its
  // own line, which turns a readable 500-line file into a 4,000-line one and
  // a diff between two saves into noise.
  const hasExtra = Object.keys(extraKeys).length > 0;
  const rowIndent = hasExtra ? '    ' : '  ';
  const closeIndent = hasExtra ? '  ' : '';
  const list = rows.length
    ? `[\n${rows.map((r) => rowIndent + JSON.stringify(r)).join(',\n')}\n${closeIndent}]`
    : '[]';

  const body = hasExtra
    ? `{\n${Object.entries(extraKeys)
        .map(([k, v]) => `  ${JSON.stringify(k)}: ${encodeExtra(v)}`)
        .join(',\n')},\n  "groundtruth": ${list}\n}\n`
    : `{"groundtruth":${list}}\n`;

  // The clip's file may live in a subfolder somebody handed in; create the
  // folder it belongs to, not just the root.
  await fs.mkdir(path.dirname(target), { recursive: true });
  // Write-then-rename so a crash cannot leave a half-written file.
  await writeFileAtomic(target, body);
  // A brand-new file has to appear in the index straight away, or the save
  // that just created it would be followed by a read that cannot find it.
  invalidateGroundTruthIndex();
  return { path: target, count: rows.length };
}

/** Remove a clip's ground truth when the clip itself is removed. */
export async function removeGroundTruth(videoName) {
  const found = await findGroundTruth(videoName);
  if (!found) return;
  const target = found.path;
  await fs.unlink(target).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
}

/** Whether a clip has a ground-truth file on disk right now. */
export async function groundTruthExists(videoName) {
  const found = await findGroundTruth(videoName);
  if (!found) return false;
  return fs.access(found.path).then(() => true, () => false);
}

export { GT_DIR, REPORTING_FPS };
