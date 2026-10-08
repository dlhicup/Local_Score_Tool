import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EVENT_LABELS } from '../labels.js';
import {
  readEvents, writeEvents, readSidecarKeys, removeGroundTruth, groundTruthExists,
  findGroundTruth, groundTruthIndex, toFrame, GT_DIR,
} from './gtfile.js';
import { probeVideo } from './media.js';
import { pruneLog } from './reviewlog.js';
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

/**
 * Every clip in the shared folder, at any depth.
 *
 * A clip is known by its filename alone, not by where it sits — that is what
 * lets a ground-truth file handed in inside somebody's folder be matched to a
 * video sitting at the top of video/. Two clips with the same filename in
 * different subfolders would be the same clip to this tool, so the shallowest
 * wins and the rest are ignored; that is reported by `duplicateClips()`.
 */
const MAX_DEPTH = 6;

async function walkVideos(dir, out = [], depth = 0) {
  if (depth > MAX_DEPTH) return out;
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walkVideos(full, out, depth + 1);
    else if (e.isFile() && VIDEO_RE.test(e.name)) out.push(full);
  }
  return out;
}

const VIDEO_TTL_MS = 2000;
let videoCache = { at: 0, byName: new Map() };

export function invalidateVideoIndex() {
  videoCache = { at: 0, byName: new Map() };
}

/** name -> { path, rel, others[] } for every clip under video/. */
export async function videoIndex() {
  if (videoCache.byName.size && Date.now() - videoCache.at < VIDEO_TTL_MS) return videoCache.byName;
  const files = await walkVideos(VIDEO_DIR);
  files.sort((a, b) => {
    const da = a.split(path.sep).length;
    const db = b.split(path.sep).length;
    return da - db || a.localeCompare(b);
  });
  const byName = new Map();
  for (const full of files) {
    const name = path.basename(full);
    if (!byName.has(name)) byName.set(name, { path: full, rel: path.relative(VIDEO_DIR, full), others: [] });
    else byName.get(name).others.push(path.relative(VIDEO_DIR, full));
  }
  videoCache = { at: Date.now(), byName };
  return byName;
}

/** The file behind a clip name, or null when we have no such clip. */
export async function videoPath(name) {
  const hit = (await videoIndex()).get(path.basename(String(name || '')));
  return hit ? hit.path : null;
}

export async function listClipNames() {
  return [...(await videoIndex()).keys()].sort((a, b) => a.localeCompare(b));
}

/** id -> clip filename, or null when the id names no clip we have. */
export async function clipForId(id) {
  const names = await listClipNames();
  return names.find((n) => idForVideo(n) === id) ?? null;
}

/** When a clip's ground truth was written, from the file itself. */
async function fileTimes(filename) {
  const found = await findGroundTruth(filename);
  if (!found) return { createdAt: null, updatedAt: null };
  const stat = await fs.stat(found.path).catch(() => null);
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
    videoPath(filename).then(probeVideo),
  ]);
  return {
    ...emptyProject({ name: filename, video: { filename, ...media } }),
    events,
    meta: {
      ...times,
      review: extra.review ?? null,
      annotator: typeof extra.annotator === 'string' ? extra.annotator : null,
      // What past reviews changed, oldest first. Read-only to the client; the
      // server is the only thing that appends to it.
      reviews: Array.isArray(extra.reviews) ? extra.reviews.filter((x) => x && typeof x === 'object') : [],
      reviewed: extra.reviewed && typeof extra.reviewed === 'object' ? extra.reviewed : null,
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
    const [times, media] = await Promise.all([fileTimes(name), videoPath(name).then(probeVideo)]);

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
      reviewed: extra.reviewed && typeof extra.reviewed === 'object' ? extra.reviewed : null,
      // Just the count: a row needs to know whether there is a log to offer,
      // not what is in it.
      reviewCount: Array.isArray(extra.reviews) ? extra.reviews.filter((x) => x && typeof x === 'object').length : 0,
      annotator: extra.annotator ?? null,
    });
  }
  out.sort((a, b) => String(b.meta?.updatedAt ?? '').localeCompare(String(a.meta?.updatedAt ?? '')));
  return out;
}

/**
 * Ground-truth files that match no clip we have.
 *
 * A hand-in whose video never made it into video/ would otherwise just not
 * appear — the work is on disk and invisible, which is the failure this whole
 * folder layout exists to avoid. Reported so the Library can say so.
 */
export async function unmatchedGroundTruth() {
  const [index, names] = await Promise.all([groundTruthIndex(), listClipNames()]);
  const haveClip = new Set(names.map((n) => n.replace(/\.[^.]+$/, '').toLowerCase()));
  const out = [];
  for (const [key, entry] of index) {
    if (!haveClip.has(key)) out.push({ rel: entry.rel, name: path.basename(entry.rel) });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
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
 *
 * `appendReview` adds one line to the clip's review log — see reviewlog.js.
 * The log is capped, oldest first, so a clip that is reviewed every week does
 * not end up with more history above its actions than actions.
 *
 * `reviewed` is the clip's sign-off: who finished reviewing it and when.
 * Passing an object records one; passing `null` clears it. It is cleared
 * whenever the actions change, so "reviewed" keeps meaning "signed off, and
 * nothing has happened to it since" rather than "signed off once, long ago".
 */
export async function writeProject(project, { appendReview = null, reviewed } = {}) {
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

  if (appendReview) {
    const log = Array.isArray(existing.reviews) ? existing.reviews.filter((x) => x && typeof x === 'object') : [];
    extra.reviews = pruneLog([...log, appendReview]);
  }

  if (reviewed !== undefined) {
    if (reviewed) extra.reviewed = reviewed;
    else delete extra.reviewed;
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
