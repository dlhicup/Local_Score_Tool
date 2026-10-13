#!/usr/bin/env node
/**
 * Sort the videos loose at the top of video/ into their type folders.
 *
 *   npm run sort-videos            move them
 *   npm run sort-videos -- --dry-run   show what would move, move nothing
 *
 * Also runs after every `npm run build`, so a machine that pulls the project and
 * builds ends up with the same layout as every other: the videos themselves are
 * not in git, so the layout cannot travel with it, but this rule can.
 *
 * A clip's type in the Library is the folder it sits in (see
 * src/services/category.js). This only decides where a clip goes when it is
 * loose; it never touches a file that is already in a folder, so a clip moved by
 * hand to another type stays where it was put. Nothing is ever overwritten or
 * deleted, and a file that cannot be moved is reported and left alone. It never
 * fails the build: a clip left loose still works, it just shows as Unsorted.
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VIDEO_DIR = path.resolve(ROOT, process.env.VIDEO_DIR || 'video');
const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;
const DRY = process.argv.includes('--dry-run') || process.argv.includes('-n');

/**
 * Which folder a loose clip belongs in, from its name.
 *
 *   0001.mp4 … 1050.mp4                 -> 30s clips   (digits only)
 *   009067472_8f16bc….mp4, gt_0092….mp4 -> gt          (an ID: digits_hex, gt_ optional)
 *   anything else                        -> Full match  (text-named matches)
 */
function folderFor(name) {
  const base = name.replace(/\.[^.]+$/, '').trim();
  if (/^\d+$/.test(base)) return '30s clips';
  if (/^(gt_)?\d+_[0-9a-f]+$/i.test(base)) return 'gt';
  return 'Full match';
}

async function main() {
  let entries;
  try {
    entries = await fs.readdir(VIDEO_DIR, { withFileTypes: true });
  } catch {
    console.log(`sort-videos: no video folder at ${VIDEO_DIR} — nothing to sort.`);
    return;
  }

  const loose = entries.filter((e) => e.isFile() && VIDEO_RE.test(e.name)).map((e) => e.name).sort();
  if (!loose.length) {
    console.log('sort-videos: every video is already in a folder.');
    return;
  }

  const moved = {};
  const skipped = [];
  const failed = [];

  for (const name of loose) {
    const folder = folderFor(name);
    const from = path.join(VIDEO_DIR, name);
    const to = path.join(VIDEO_DIR, folder, name);

    // Never overwrite: a same-named clip already in the folder is a duplicate
    // somebody has to look at, not something to resolve by guessing.
    if (await fs.access(to).then(() => true, () => false)) {
      skipped.push(`${name} (a ${folder}/${name} already exists)`);
      continue;
    }
    if (DRY) {
      moved[folder] = (moved[folder] ?? 0) + 1;
      continue;
    }
    try {
      await fs.mkdir(path.join(VIDEO_DIR, folder), { recursive: true });
      await fs.rename(from, to);
      moved[folder] = (moved[folder] ?? 0) + 1;
    } catch (err) {
      // On Windows a clip open in somebody's browser cannot be renamed. It is
      // left loose and still works; the next build or run picks it up.
      failed.push(`${name} (${err.code ?? err.message})`);
    }
  }

  const total = Object.values(moved).reduce((n, v) => n + v, 0);
  const verb = DRY ? 'would move' : 'moved';
  console.log(`sort-videos: ${verb} ${total} of ${loose.length} loose video${loose.length === 1 ? '' : 's'} in ${VIDEO_DIR}`);
  for (const [folder, n] of Object.entries(moved)) console.log(`  ${String(n).padStart(5)}  -> ${folder}/`);
  if (skipped.length) {
    console.log(`  left alone, would overwrite (${skipped.length}):`);
    for (const s of skipped) console.log(`    ${s}`);
  }
  if (failed.length) {
    console.log(`  could not move — probably open somewhere; run again later (${failed.length}):`);
    for (const f of failed) console.log(`    ${f}`);
  }
}

// Whatever happens, never fail the build over it.
main().catch((err) => {
  console.warn(`sort-videos: skipped — ${err.message}`);
});
