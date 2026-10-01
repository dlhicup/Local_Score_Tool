import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENT_LABELS, LABEL_DEFINITIONS } from '../labels.js';

/**
 * The definition of each action, read from `guide.md`.
 *
 * That file says of itself that it is the source of truth for action names,
 * and it was drifting from the wording the app showed annotators — two copies
 * of the same definitions, kept in step by hand, which is to say not kept in
 * step at all. So the file is now parsed and served, and the copy in labels.js
 * is only a fallback for when it is missing or unreadable.
 *
 * Edit guide.md and the Events guide page follows on the next load.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GUIDE = path.resolve(ROOT, process.env.ACTIONS_GUIDE || 'guide.md');

/**
 * Pull the definitions out of the markdown table. Rows look like
 *
 *   | `pass` | A pass is when a player kicks ... |
 *
 * Anything that is not a two-cell row naming a known label is skipped, so the
 * prose around the table — and the header and separator rows — cost nothing.
 */
export function parseActionGuide(markdown) {
  const out = {};
  const known = new Set(EVENT_LABELS);
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    const cells = t.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    const label = cells[0].replace(/`/g, '').trim();
    const definition = cells[1].replace(/\s+/g, ' ').trim();
    if (known.has(label) && definition) out[label] = definition;
  }
  return out;
}

/** Any note the file carries outside the table, for the page to show. */
export function parseActionNotes(markdown) {
  return String(markdown ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('|') && !l.startsWith('#'))
    .map((l) => l.replace(/\s+/g, ' '));
}

// Re-read when the file changes, so editing guide.md does not need a restart.
let cache = { mtime: 0, definitions: null, notes: [] };

export async function actionDefinitions() {
  const stat = await fs.stat(GUIDE).catch(() => null);
  if (!stat) return { definitions: { ...LABEL_DEFINITIONS }, notes: [], source: null };

  if (cache.definitions && cache.mtime === Math.floor(stat.mtimeMs)) {
    return { definitions: cache.definitions, notes: cache.notes, source: GUIDE };
  }

  const text = await fs.readFile(GUIDE, 'utf8').catch(() => '');
  const parsed = parseActionGuide(text);
  // A label the file does not mention keeps its built-in wording rather than
  // showing nothing — a half-filled guide is worse than a stale one.
  const definitions = { ...LABEL_DEFINITIONS, ...parsed };
  const notes = parseActionNotes(text);

  cache = { mtime: Math.floor(stat.mtimeMs), definitions, notes };
  return { definitions, notes, source: GUIDE, parsed: Object.keys(parsed).length };
}

export { GUIDE };
