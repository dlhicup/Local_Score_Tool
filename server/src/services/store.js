import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EVENT_LABELS } from '../labels.js';
import { sweepTempFiles } from './atomic.js';
import {
  readEvents, writeEvents, readSidecarKeys, removeGroundTruth, groundTruthExists, toFrame,
} from './gtfile.js';
import { allClipMeta, readClipMeta, updateClipMeta, removeClipMeta } from './clips.js';

// Anchor to the repo root, not process.cwd(): `npm run dev` starts the server
// from server/ while `node server/src/index.js` starts it from the root, and
// ground truth must land in the same place either way.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const VIDEO_DIR = path.resolve(ROOT, process.env.VIDEO_DIR || 'video');
const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;

await fs.mkdir(DATA_DIR, { recursive: true });
// Clear anything a hard kill left mid-write, so temp files cannot pile up.
await sweepTempFiles(DATA_DIR);

export function newId(prefix = 'gt') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * A clip's id, derived from its filename.
 *
 * Deterministic on purpose: an annotate URL is then a permanent handle to a
 * clip rather than to a stored record, and two concurrent opens of the same
 * clip cannot produce two records.
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

export function emptyProject({ name, video }) {
  const now = new Date().toISOString();
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
      fps: Number.isFinite(Number(video?.fps)) ? Number(video.fps) : null,
    },
    events: [],
    meta: { createdAt: now, updatedAt: now, reviewedAt: null },
  };
}

/**
 * Assemble the in-app project for a clip out of its ground-truth file and its
 * sidecar entry. Nothing else is stored, so this is the whole record.
 */
export async function projectForClip(filename) {
  const [events, meta, stat] = await Promise.all([
    readEvents(filename),
    readClipMeta(filename),
    fs.stat(path.join(VIDEO_DIR, filename)).catch(() => null),
  ]);
  const base = emptyProject({
    name: filename,
    video: { filename, size: stat?.size ?? null, ...(meta?.video ?? {}) },
  });
  return {
    ...base,
    events,
    meta: {
      ...base.meta,
      ...(meta ?? {}),
      // The sidecar's own `video` block is folded in above, not left to
      // masquerade as metadata.
      video: undefined,
    },
  };
}

export async function listProjects() {
  const [names, metas] = await Promise.all([listClipNames(), allClipMeta()]);
  const out = [];
  for (const name of names) {
    const events = await readEvents(name);
    if (!events.length && !metas[name]) continue; // untouched clip: no record yet

    const byType = {};
    let unknownTeam = 0;
    for (const e of events) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (e.team === 'unknown') unknownTeam += 1;
    }
    // Positions for the timeline strip. Capped so a pathological file cannot
    // bloat a listing of a thousand clips.
    const marks = events.slice(0, 80).map((e) => ({ t: Number(e.timestamp.toFixed(2)), y: e.type }));

    out.push({
      id: idForVideo(name),
      name,
      video: { filename: name, ...(metas[name]?.video ?? {}) },
      eventCount: events.length,
      // Everything in a ground-truth file is, by definition, kept.
      accepted: events.length,
      pending: 0,
      byType,
      marks,
      unknownTeam,
      duration: metas[name]?.video?.duration ?? null,
      meta: metas[name] ?? null,
      review: metas[name]?.review ?? null,
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
 * Persist a project: its actions to the ground-truth file, everything else to
 * the sidecar. Any non-event keys already in the file (a kit block someone
 * added by hand, say) are read back and preserved.
 */
export async function writeProject(project) {
  const filename = project?.video?.filename;
  if (!filename) throw Object.assign(new Error('Project has no clip'), { status: 400 });

  const extra = await readSidecarKeys(filename);
  const written = await writeEvents(filename, project.events ?? [], extra);

  const { review, reviewedAt } = project.meta ?? {};
  await updateClipMeta(filename, {
    video: {
      duration: project.video?.duration ?? null,
      width: project.video?.width ?? null,
      height: project.video?.height ?? null,
      fps: project.video?.fps ?? null,
    },
    ...(review !== undefined ? { review } : {}),
    ...(reviewedAt !== undefined ? { reviewedAt } : {}),
  });

  return { project: await projectForClip(filename), written };
}

export async function deleteProject(id) {
  const filename = await clipForId(id);
  if (!filename) return;
  await removeGroundTruth(filename);
  await removeClipMeta(filename);
}

/**
 * One-time migration off the old two-file layout.
 *
 * data/gt_<hash>.json used to be the record the app loaded, with
 * groundtruth/<clip>.json as a write-only copy. Anything the old record holds
 * that the ground-truth file does not is moved across, then the old file is
 * parked with a .migrated suffix rather than deleted — if this gets something
 * wrong, the original is still there to look at.
 */
export async function migrateLegacyRecords() {
  const files = (await fs.readdir(DATA_DIR).catch(() => []))
    .filter((f) => f.startsWith('gt_') && f.endsWith('.json'));
  if (!files.length) return { moved: 0 };

  let moved = 0;
  for (const f of files) {
    const full = path.join(DATA_DIR, f);
    let old;
    try {
      old = JSON.parse(await fs.readFile(full, 'utf8'));
    } catch {
      continue;
    }
    const filename = old?.video?.filename;
    if (!filename) continue;

    const existing = await readEvents(filename);
    const legacy = (old.events ?? []).filter((e) => e.type);
    // The ground-truth file wins unless it has strictly less in it: it is the
    // format we are keeping, and on a healthy install the two already agree.
    if (legacy.length > existing.length) {
      await writeEvents(
        filename,
        legacy.map((e) => ({ ...e, timestamp: Number(e.timestamp) })),
        await readSidecarKeys(filename),
      );
      console.log(`migrated ${legacy.length} actions for ${filename} into its ground-truth file`);
    }
    if (old.meta) {
      await updateClipMeta(filename, {
        createdAt: old.meta.createdAt,
        review: old.meta.review ?? null,
        reviewedAt: old.meta.reviewedAt ?? null,
        video: old.video ?? {},
      });
    }
    await fs.rename(full, `${full}.migrated`).catch(() => {});
    moved += 1;
  }
  if (moved) console.log(`migrated ${moved} legacy record(s); originals kept as data/*.json.migrated`);
  return { moved };
}

export { DATA_DIR, VIDEO_DIR, VIDEO_RE, toFrame, groundTruthExists };
