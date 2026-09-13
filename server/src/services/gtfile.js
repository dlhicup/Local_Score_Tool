import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isValidLabel } from '../labels.js';

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

/** `0002.mp4` -> `0002.json`, refusing anything that could escape the folder. */
function fileFor(videoName) {
  const base = path.basename(String(videoName || '')).replace(/\.[^.]+$/, '');
  if (!base || !/^[A-Za-z0-9._-]+$/.test(base)) return null;
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

  const body = `{"groundtruth":[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]}\n`;

  await fs.mkdir(GT_DIR, { recursive: true });
  // Write-then-rename so a crash cannot leave a half-written deliverable.
  const tmp = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, body, 'utf8');
  await fs.rename(tmp, target);

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

/** Whether a clip's deliverable is on disk right now. */
export async function groundTruthExists(videoName) {
  const target = fileFor(videoName);
  if (!target) return false;
  return fs.access(target).then(() => true, () => false);
}
