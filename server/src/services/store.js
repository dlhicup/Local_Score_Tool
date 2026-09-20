import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EVENT_LABELS } from '../labels.js';
import {
  readEvents, writeEvents, readSidecarKeys, removeGroundTruth, groundTruthExists,
  fileFor, toFrame, GT_DIR,
} from './gtfile.js';
import { probeVideo } from './media.js';
import { sweepTempFiles } from './atomic.js';

/**
 * One folder, one file per clip, and nothing else.
 *
 * `groundtruth/<clip name>.json` holds the actions and everything the studio
 * knows about the clip. There is no second folder of bookkeeping to keep in
 * step, which means reviewing somebody else's work is just copying their file
 * in beside the video — no import step, nothing to register.
 *
 * What used to live in data/ went one of three ways:
 *   - review verdict and annotator: sibling keys in the clip's own file, so
 *     they travel with it when it is copied
 *   - created/updated times: the file's own mtime
 *   - duration and frame size: asked of the video, which is where they live
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const VIDEO_DIR = path.resolve(ROOT, process.env.VIDEO_DIR || 'video');
const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;

await fs.mkdir(GT_DIR, { recursive: true });
// Clear anything a hard kill left mid-write, so temp files cannot pile up.
await sweepTempFiles(GT_DIR);

export function newId(prefix = 'gt') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * A clip's id, derived from its filename. Deterministic on purpose: an
 * annotate URL is then a permanent handle to a clip rather than to a record.
 */
export function idForVideo(filename) {
  const h = crypto.createHash('sha1').update(String(filename)).digest('hex');
  return `gt_${h.slice(0, 12)}`;
}

/** Every clip currently in the shared folder. */
export async function listClipNames() {
  const names = await fs.readdir(VIDEO_DIR).catch(() => []);
  return names.filter((n) => VIDEO_RE.test(n)).sort((a, b) => a.localeCompare(b));
}

/** id -> clip filename, or null when the id names no clip we have. */
export async function clipForId(id) {
  const names = await listClipNames();
  return names.find((n) => idForVideo(n) === id) ?? null;
}

/** When a clip's ground truth was written, from the file itself. */
async function fileTimes(filename) {
  const target = fileFor(filename);
  if (!target) return { createdAt: null, updatedAt: null };
  const stat = await fs.stat(target).catch(() => null);
  if (!stat) return { createdAt: null, updatedAt: null };
  return {
    // birthtime is unreliable on some filesystems; fall back to mtime rather
    // than reporting an epoch date nobody can interpret.
    createdAt: new Date(stat.birthtimeMs || stat.mtimeMs).toISOString(),
    updatedAt: new Date(stat.mtimeMs).toISOString(),
  };
}

export function emptyProject({ name, video }) {
  return {
    schema: 'score-gt/2.0',
    id: video?.filename ? idForVideo(video.filename) : newId(),
    name: name || video?.filename || 'Untitled match',
    labels: EVENT_LABELS,
    video: {
      filename: video?.filename ?? null,
      duration: video?.duration ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      size: video?.size ?? null,
      fps: null,
    },
    events: [],
    meta: { createdAt: null, updatedAt: null, review: null, annotator: null },
  };
}

/**
 * The whole record for a clip: its actions, whatever else its file carries,
 * the file's timestamps and the video's own dimensions.
 */
export async function projectForClip(filename) {
  const [events, extra, times, media] = await Promise.all([
    readEvents(filename),
    readSidecarKeys(filename),
    fileTimes(filename),
    probeVideo(filename),
  ]);
  return {
    ...emptyProject({ name: filename, video: { filename, ...media } }),
    events,
    meta: {
      ...times,
      review: extra.review ?? null,
      annotator: typeof extra.annotator === 'string' ? extra.annotator : null,
    },
  };
}

export async function listProjects() {
  const names = await listClipNames();
  const out = [];
  for (const name of names) {
    const [events, extra] = await Promise.all([readEvents(name), readSidecarKeys(name)]);
    // A clip with no file and nothing recorded has no project yet.
    if (!events.length && !Object.keys(extra).length) continue;

    const byType = {};
    let unknownTeam = 0;
    for (const e of events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (e.team === 'unknown') unknownTeam += 1;
    }
    const [times, media] = await Promise.all([fileTimes(name), probeVideo(name)]);

    out.push({
      id: idForVideo(name),
      name,
      video: { filename: name, ...media },
      eventCount: events.length,
      // Everything in a ground-truth file is, by definition, kept.
      accepted: events.length,
      pending: 0,
      byType,
      // Positions for the timeline strip, capped so a pathological file
      // cannot bloat a listing of a thousand clips.
      marks: events.slice(0, 80).map((e) => ({ t: Number(e.timestamp.toFixed(2)), y: e.type })),
      unknownTeam,
      duration: media.duration,
      meta: { ...times, review: extra.review ?? null, annotator: extra.annotator ?? null },
      review: extra.review ?? null,
      annotator: extra.annotator ?? null,
    });
  }
  out.sort((a, b) => String(b.meta?.updatedAt ?? '').localeCompare(String(a.meta?.updatedAt ?? '')));
  return out;
}

export async function readProject(id) {
  const filename = await clipForId(id);
  if (!filename) throw Object.assign(new Error('Project not found'), { status: 404 });
  return projectForClip(filename);
}

/**
 * Write a clip's file: the actions, plus the few non-action keys the studio
 * keeps beside them. Anything already in the file that we do not understand is
 * read back and preserved, so a field another tool added is never dropped.
 */
export async function writeProject(project) {
  const filename = project?.video?.filename;
  if (!filename) throw Object.assign(new Error('Project has no clip'), { status: 400 });

  const existing = await readSidecarKeys(filename);
  const extra = { ...existing };

  const { review, annotator } = project.meta ?? {};
  if (review !== undefined) {
    if (review === null) delete extra.review;
    else extra.review = review;
  }
  if (annotator !== undefined) {
    if (!annotator) delete extra.annotator;
    else extra.annotator = annotator;
  }

  const written = await writeEvents(filename, project.events ?? [], extra);
  return { project: await projectForClip(filename), written };
}

export async function deleteProject(id) {
  const filename = await clipForId(id);
  if (!filename) return;
  await removeGroundTruth(filename);
}

/** Set (or clear) who a clip belongs to, in the clip's own file. */
export async function setAnnotator(filename, annotator) {
  const extra = await readSidecarKeys(filename);
  if (annotator) extra.annotator = annotator;
  else delete extra.annotator;
  await writeEvents(filename, await readEvents(filename), extra);
  return annotator ?? null;
}

/** Clip -> annotator, for every clip that names one. */
export async function allAnnotators() {
  const names = await listClipNames();
  const out = {};
  for (const n of names) {
    const extra = await readSidecarKeys(n);
    if (typeof extra.annotator === 'string' && extra.annotator) out[n] = extra.annotator;
  }
  return out;
}

export { VIDEO_DIR, VIDEO_RE, toFrame, groundTruthExists };
