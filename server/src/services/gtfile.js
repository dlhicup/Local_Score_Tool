import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  isValidLabel, isTeam, isBody, isGoalView, isSure, isBallXY, EVENT_TAG_DEFAULTS,
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
 * what the annotator sees and what gets handed off cannot drift apart. Per-clip
 * bookkeeping that does not belong in a deliverable (review verdicts,
 * timestamps) lives in a small sidecar; see clips.js.
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
  // basename() drops any directory part, so what remains cannot point outward.
  const base = path.basename(String(videoName || '')).replace(/\.[^.]+$/, '').trim();
  if (!base || base === '.' || base === '..') return null;
  // Belt and braces: separators (basename only strips "\" on Windows), and the
  // characters no filesystem accepts in a name.
  if (/[\\/\0]/.test(base) || /[<>:"|?*\x00-\x1f]/.test(base)) return null;
  const full = path.join(GT_DIR, `${base}.json`);
  return full.startsWith(GT_DIR + path.sep) ? full : null;
}

const uid = () => `evt_${crypto.randomBytes(6).toString('hex')}`;

// ---------------------------------------------------------------- tag repair

/**
 * Force one stored row into a valid event, filling anything missing or
 * unrecognised with the documented default.
 *
 * Deliberately forgiving: these files are hand-edited, arrive from other
 * tools, and predate the tags. A row with a bad `body` should lose the bad
 * body, not the event.
 */
function eventFromRow(row) {
  if (!isValidLabel(row?.action) || !Number.isFinite(Number(row?.frame))) return null;
  const ev = {
    id: uid(),
    type: row.action,
    timestamp: toSeconds(row.frame),
    team: isTeam(row.team) ? row.team : EVENT_TAG_DEFAULTS.team,
    ball_xy: isBallXY(row.ball_xy) && row.ball_xy ? [Number(row.ball_xy[0]), Number(row.ball_xy[1])] : null,
    sure: isSure(row.sure) ? Number(row.sure) : EVENT_TAG_DEFAULTS.sure,
    body: isBody(row.body) ? row.body : EVENT_TAG_DEFAULTS.body,
    goal_view: isGoalView(row.goal_view) ? row.goal_view : EVENT_TAG_DEFAULTS.goal_view,
  };
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
    team: isTeam(e.team) ? e.team : EVENT_TAG_DEFAULTS.team,
    ball_xy: isBallXY(e.ball_xy) && e.ball_xy ? [Number(e.ball_xy[0]), Number(e.ball_xy[1])] : null,
    sure: isSure(e.sure) ? Number(e.sure) : EVENT_TAG_DEFAULTS.sure,
    body: isBody(e.body) ? e.body : EVENT_TAG_DEFAULTS.body,
    goal_view: isGoalView(e.goal_view) ? e.goal_view : EVENT_TAG_DEFAULTS.goal_view,
  };
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
  const target = fileFor(videoName);
  if (!target) return [];
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
  const target = fileFor(videoName);
  if (!target) return {};
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
 * One row as it is stored. Key order is fixed and matches the guide's example,
 * so a diff between two saves shows what actually changed rather than a
 * reshuffle. `own_goal` appears only where it means something.
 */
function rowFor(e) {
  const row = {
    frame: toFrame(e.timestamp),
    action: e.type,
    team: isTeam(e.team) ? e.team : EVENT_TAG_DEFAULTS.team,
    ball_xy: e.ball_xy && isBallXY(e.ball_xy) ? [Number(e.ball_xy[0]), Number(e.ball_xy[1])] : null,
    sure: isSure(e.sure) ? Number(e.sure) : EVENT_TAG_DEFAULTS.sure,
    body: isBody(e.body) ? e.body : EVENT_TAG_DEFAULTS.body,
    goal_view: isGoalView(e.goal_view) ? e.goal_view : EVENT_TAG_DEFAULTS.goal_view,
  };
  if (e.type === 'goal' && e.own_goal === true) row.own_goal = true;
  return row;
}

/**
 * Write a clip's ground truth: one row per line, frame order, ties keeping the
 * order they were added in. Dense enough to read in a terminal, still one
 * valid JSON document.
 */
export async function writeEvents(videoName, events, extraKeys = {}) {
  const target = fileFor(videoName);
  if (!target) return null;

  const rows = (events ?? [])
    .filter((e) => isValidLabel(e.type))
    .map((e, i) => ({ row: rowFor(e), i }))
    .sort((a, b) => a.row.frame - b.row.frame || a.i - b.i)
    .map(({ row }) => row);

  const body = Object.keys(extraKeys).length
    ? `${JSON.stringify({ ...extraKeys, groundtruth: rows }, null, 2)}\n`
    : rows.length
      ? `{"groundtruth":[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]}\n`
      : '{"groundtruth":[]}\n';

  await fs.mkdir(GT_DIR, { recursive: true });
  // Write-then-rename so a crash cannot leave a half-written file.
  await writeFileAtomic(target, body);
  return { path: target, count: rows.length };
}

/** Remove a clip's ground truth when the clip itself is removed. */
export async function removeGroundTruth(videoName) {
  const target = fileFor(videoName);
  if (!target) return;
  await fs.unlink(target).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
}

/** Whether a clip has a ground-truth file on disk right now. */
export async function groundTruthExists(videoName) {
  const target = fileFor(videoName);
  if (!target) return false;
  return fs.access(target).then(() => true, () => false);
}

export { GT_DIR, REPORTING_FPS };
