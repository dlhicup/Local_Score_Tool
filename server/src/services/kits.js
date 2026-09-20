import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Kit colours, so a team tag can be resolved from a single frame.
 *
 * The team tag is only meaningful if a reader can tell which shirt is home, so
 * the guide pairs every match with a kit line. Here that lives in `kits.json`
 * at the project root, in either of two shapes:
 *
 *   - one match: exactly the object from the guide, used for every clip
 *   - several:   { "clips": { "<clip filename>": {...} }, "default": {...} }
 *
 * The guide allows one kit line per clip where the parent match is unknown,
 * which is what the `clips` map is for.
 *
 * Read-only here. It is authored once per match by whoever prepares the
 * footage, and an annotator guessing at it would defeat the point.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const KITS = path.resolve(ROOT, process.env.KITS_FILE || 'kits.json');

async function loadFile() {
  try {
    const doc = JSON.parse(await fs.readFile(KITS, 'utf8'));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : null;
  } catch {
    return null;
  }
}

/** Everything in the file, for a tool that wants the whole picture. */
export async function allKits() {
  const doc = await loadFile();
  if (!doc) return { present: false, path: KITS, clips: {}, default: null };
  const perClip = doc.clips && typeof doc.clips === 'object' ? doc.clips : {};
  const fallback = doc.default ?? (doc.clips ? null : doc);
  return { present: true, path: KITS, clips: perClip, default: fallback };
}

/**
 * The kit for one clip: its own line if it has one, otherwise the default.
 * Returns null when there is no kit information at all, which the UI shows as
 * "no kit file" rather than inventing colours.
 */
export async function kitForClip(name) {
  const { present, clips, default: fallback } = await allKits();
  if (!present) return null;
  return clips[name] ?? fallback ?? null;
}

/**
 * Which period of the match a timestamp falls in, when the kit file lists
 * periods. Gives the annotator the direction home attacks at that moment,
 * which is the one thing that changes at half time.
 */
export function periodAt(kit, seconds) {
  const periods = Array.isArray(kit?.periods) ? kit.periods : [];
  return periods.find((p) => seconds >= Number(p.start_s) && seconds <= Number(p.end_s)) ?? null;
}

export { KITS };
