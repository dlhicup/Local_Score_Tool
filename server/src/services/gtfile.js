import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isValidLabel } from '../labels.js';
import { writeFileAtomic } from './atomic.js';

/**
 * The deliverable, written next to the working file on every save.
 *
 * data/<id>.json is the studio's own record — review status, confidence, notes.
 * This is the other half: one file per clip, named after the clip, containing
 * nothing but the frames and actions that get handed off.
 *
 * Frame numbers are on the fixed 25 fps reporting clock, never the source
 * video's own rate.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GT_DIR = path.resolve(ROOT, process.env.GT_DIR || 'groundtruth');

const REPORTING_FPS = 25;

/**
 * Seconds -> reporting frame. toFixed(6) first because 17.9 * 25 evaluates to
 * 447.49999999999994 in float64 and would round down to 447, not 448.
 */
const toFrame = (seconds) =>
  Math.max(0, Math.round(Number(((Number(seconds) || 0) * REPORTING_FPS).toFixed(6))));

/**
 * `Veo - Match 1.mp4` -> `Veo - Match 1.json`: the clip's own name with the
 * extension swapped. The deliverable is identified by the clip it describes,
 * so the name is preserved as-is rather than rewritten into something else.
 *
 * Spaces and ordinary punctuation are legal in a clip name and must survive.
 * An allow-list of [A-Za-z0-9._-] fitted the old numbered corpus (0002.mp4)
 * but silently rejected every real export — "Veo - Match - 1st XI football-clip
 * 1.mp4" produced no file at all. Refuse only what could escape the folder or
 * is not a usable filename.
 */
function fileFor(videoName) {
  // basename() drops any directory part, so what remains cannot point outward.
  const base = path.basename(String(videoName || '')).replace(/\.[^.]+$/, '').trim();
  if (!base || base === '.' || base === '..') return null;
  // Belt and braces: separators (basename only strips "\" on Windows), and the
  // characters no filesystem accepts in a name.
  if (/[\\/\0]/.test(base) || /[<>:"|?*\x00-\x1f]/.test(base)) return null;
  const full = path.join(GT_DIR, `${base}.json`);
  return full.startsWith(GT_DIR + path.sep) ? full : null;
}

/**
 * Write the clip's ground truth. Rejected actions are left out — they were
 * looked at and turned down, so they are not part of the answer.
 */
export async function writeGroundTruth(project) {
  const target = fileFor(project?.video?.filename);
  if (!target) return null;

  const rows = (project.events ?? [])
    .filter((e) => e.status !== 'rejected' && isValidLabel(e.type))
    .map((e) => ({ frame: toFrame(e.timestamp), action: e.type, _t: e.timestamp }))
    // Frame order is the contract; ties keep the order they happened in.
    .sort((a, b) => a.frame - b.frame || a._t - b._t)
    .map(({ frame, action }) => ({ frame, action }));

  // An empty result is still a valid deliverable — emit it cleanly rather than
  // as a bracket pair wrapped around a blank line.
  const body = rows.length
    ? `{"groundtruth":[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]}\n`
    : '{"groundtruth":[]}\n';

  await fs.mkdir(GT_DIR, { recursive: true });
  // Write-then-rename so a crash cannot leave a half-written deliverable.
  await writeFileAtomic(target, body);

  return { path: target, count: rows.length };
}

/** Remove a clip's deliverable when its working file is deleted. */
export async function removeGroundTruth(videoName) {
  const target = fileFor(videoName);
  if (!target) return;
  await fs.unlink(target).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
}

export { GT_DIR };

/**
 * Read a clip's deliverable back as annotate-ready events.
 *
 * The deliverable is normally write-only: data/<id>.json is what the app
 * loads, and this file is the hand-off copy. That asymmetry has one bad
 * failure though - if the working record is lost or reset while the
 * deliverable survives, the annotations are still on disk but the workspace
 * opens empty, and nothing in the app can bring them back.
 *
 * So a clip whose record is missing is seeded from here. Frame numbers are on
 * the 25 fps reporting clock, which is the only precision the file carries;
 * timestamps come back quantised to that grid.
 *
 * Returns [] when there is no deliverable or it cannot be read - never throws,
 * because this runs on the path that opens a clip.
 */
export async function eventsFromGroundTruth(videoName) {
  const target = fileFor(videoName);
  if (!target) return [];
  let doc;
  try {
    doc = JSON.parse(await fs.readFile(target, 'utf8'));
  } catch {
    return []; // absent, or hand-edited into something unparseable
  }
  const rows = Array.isArray(doc) ? doc : doc?.groundtruth ?? [];
  return rows
    .filter((r) => isValidLabel(r?.action) && Number.isFinite(Number(r?.frame)))
    .map((r) => ({
      id: `evt_${crypto.randomBytes(6).toString('hex')}`,
      type: r.action,
      timestamp: Number((Number(r.frame) / REPORTING_FPS).toFixed(3)),
      endTimestamp: 0,
      team: null,
      player: null,
      confidence: 1,
      source: 'human',
      status: 'accepted',
      description: '',
      agreement: 1,
    }));
}

/** Whether a clip's deliverable is on disk right now. */
export async function groundTruthExists(videoName) {
  const target = fileFor(videoName);
  if (!target) return false;
  return fs.access(target).then(() => true, () => false);
}
