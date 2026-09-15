import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { EVENT_LABELS } from '../labels.js';
import { writeFileAtomic, sweepTempFiles } from './atomic.js';

// Anchor to the repo root, not process.cwd(): `npm run dev` starts the server
// from server/ while `node server/src/index.js` starts it from the root, and
// ground truth must land in the same place either way.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');

await fs.mkdir(DATA_DIR, { recursive: true });
// Clear anything a hard kill left mid-write, so temp files cannot pile up.
await sweepTempFiles(DATA_DIR);

const safeId = (id) => /^[A-Za-z0-9_-]{1,64}$/.test(id);
const fileFor = (id) => path.join(DATA_DIR, `${id}.json`);

export function newId(prefix = 'gt') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * A clip's ground-truth id, derived from its filename.
 *
 * Deterministic on purpose: two concurrent "open this clip" requests would
 * otherwise both miss the existence check and create two GT files for one
 * video. With a derived id the second write simply lands on the same file.
 */
export function idForVideo(filename) {
  const h = crypto.createHash('sha1').update(String(filename)).digest('hex');
  return `gt_${h.slice(0, 12)}`;
}

export function emptyProject({ name, video }) {
  const now = new Date().toISOString();
  return {
    schema: 'score-gt/1.0',
    id: newId(),
    name: name || video?.filename || 'Untitled match',
    labels: EVENT_LABELS,
    video: {
      filename: video?.filename ?? null,
      duration: video?.duration ?? null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      size: video?.size ?? null,
      // Frame numbers in the exported ground truth are derived from this.
      fps: Number.isFinite(Number(video?.fps)) ? Number(video.fps) : null,
    },
    events: [],
    extraction: null,
    meta: { createdAt: now, updatedAt: now, reviewedAt: null },
  };
}

export async function listProjects() {
  const files = await fs.readdir(DATA_DIR).catch(() => []);
  const out = [];
  for (const f of files) {
    // Only ground-truth records. users.json shares this directory and would
    // otherwise parse cleanly into a "project" with no id and no events.
    if (!f.startsWith('gt_') || !f.endsWith('.json')) continue;
    try {
      const p = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), 'utf8'));
      // Per-label counts let the library show the shape of a file at a glance,
      // not just how many events it holds.
      const byType = {};
      for (const e of p.events ?? []) byType[e.type] = (byType[e.type] ?? 0) + 1;

      // Positions for the timeline strip. Capped so a pathological file cannot
      // bloat a listing of a thousand clips.
      const marks = (p.events ?? [])
        .slice(0, 80)
        .map((e) => ({ t: Number(e.timestamp?.toFixed?.(2) ?? 0), y: e.type }));

      out.push({
        id: p.id,
        name: p.name,
        video: p.video,
        eventCount: p.events?.length ?? 0,
        accepted: p.events?.filter((e) => e.status === 'accepted').length ?? 0,
        pending: p.events?.filter((e) => e.status === 'pending').length ?? 0,
        byType,
        marks,
        duration: p.video?.duration ?? null,
        meta: p.meta,
        review: p.meta?.review ?? p.review ?? null,
      });
    } catch {
      // A hand-edited file that no longer parses should not take down the list.
    }
  }
  out.sort((a, b) => String(b.meta?.updatedAt ?? '').localeCompare(String(a.meta?.updatedAt ?? '')));
  return out;
}

export async function readProject(id) {
  if (!safeId(id)) throw Object.assign(new Error('Bad project id'), { status: 400 });
  try {
    return JSON.parse(await fs.readFile(fileFor(id), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') throw Object.assign(new Error('Project not found'), { status: 404 });
    throw err;
  }
}

export async function writeProject(project) {
  if (!safeId(project?.id)) throw Object.assign(new Error('Bad project id'), { status: 400 });
  project.meta = { ...(project.meta ?? {}), updatedAt: new Date().toISOString() };
  // Write-then-rename so a crash mid-save cannot truncate existing ground truth.
  await writeFileAtomic(fileFor(project.id), JSON.stringify(project, null, 2));
  return project;
}

export async function deleteProject(id) {
  if (!safeId(id)) throw Object.assign(new Error('Bad project id'), { status: 400 });
  await fs.unlink(fileFor(id)).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
}

export { DATA_DIR };
