import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './atomic.js';

/**
 * Per-clip bookkeeping that has no place in a deliverable.
 *
 * The ground-truth file is the label set and nothing else — whatever consumes
 * it downstream should not have to skip past our review verdicts and edit
 * timestamps to find the actions. So those live here, in one small map keyed
 * by clip filename.
 *
 * Losing this file costs nothing that matters: the annotations are all in
 * groundtruth/, and a clip with no entry simply reads as never reviewed.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const CLIPS = path.join(DATA_DIR, 'clips.json');

async function load() {
  try {
    const doc = JSON.parse(await fs.readFile(CLIPS, 'utf8'));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  } catch {
    return {};
  }
}

// Serialised, so two saves cannot both read, edit and write over each other.
let queue = Promise.resolve();
function withStore(fn) {
  const result = queue.then(async () => {
    const doc = await load();
    const before = JSON.stringify(doc);
    const r = await fn(doc);
    if (JSON.stringify(doc) !== before) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await writeFileAtomic(CLIPS, JSON.stringify(doc, null, 2));
    }
    return r;
  });
  queue = result.catch(() => {});
  return result;
}

export async function allClipMeta() {
  return load();
}

export async function readClipMeta(name) {
  const doc = await load();
  return doc[name] ?? null;
}

/** Merge fields into a clip's entry, creating it on first touch. */
export function updateClipMeta(name, patch) {
  return withStore((doc) => {
    const now = new Date().toISOString();
    const prev = doc[name] ?? { createdAt: now };
    doc[name] = { ...prev, ...patch, updatedAt: now };
    return doc[name];
  });
}

export function removeClipMeta(name) {
  return withStore((doc) => {
    delete doc[name];
  });
}

export { CLIPS };
