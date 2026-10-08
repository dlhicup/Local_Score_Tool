import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { groundTruthIndex, GT_DIR } from '../services/gtfile.js';
import { reviewFileIndex, readReviewFileAt } from '../services/reviewfile.js';
import { requireAuth } from '../middleware/auth.js';
import { zipSync, safeEntryName } from '../services/zip.js';

/**
 * The review history, for downloading.
 *
 * Each clip keeps its own history in `Review.<clip>.json` beside its ground
 * truth, written as sentences. That is the right place for it to live: it
 * travels with the hand-in, and a person can open it and read it. It is the
 * wrong place to read it from when the question is about the corpus rather than
 * one clip, which is what this is for — one request, every clip, as a table.
 */
const router = Router();

/** Excel reads a UTF-8 CSV as the system codepage without this. */
const BOM = '﻿';

/**
 * Every clip's history. Walks the review files, then looks up the ground truth
 * beside each one for the annotator's name and the action count — neither of
 * which the history itself should be duplicating.
 */
async function collect(onlyClip = null) {
  const [reviewFiles, clips] = await Promise.all([reviewFileIndex(), groundTruthIndex()]);
  const out = [];
  for (const [key, entry] of reviewFiles) {
    if (onlyClip && key !== onlyClip.toLowerCase()) continue;
    const doc = await readReviewFileAt(entry.path);
    if (!doc || (!doc.changes.length && !doc.notes.length && !doc.signedOff)) continue;

    let annotator = null;
    let actions = null;
    const gt = clips.get(key);
    if (gt) {
      try {
        const clipDoc = JSON.parse(await fs.readFile(gt.path, 'utf8'));
        if (!Array.isArray(clipDoc)) {
          annotator = typeof clipDoc?.annotator === 'string' ? clipDoc.annotator : null;
          actions = Array.isArray(clipDoc?.groundtruth) ? clipDoc.groundtruth.length : null;
        } else {
          actions = clipDoc.length;
        }
      } catch { /* a clip file that no longer parses still has a history */ }
    }

    out.push({
      clip: entry.clip,
      logFile: entry.rel,
      groundTruthFile: gt ? gt.rel : null,
      annotator,
      actions,
      signedOff: doc.signedOff,
      reviews: doc.reviews,
      summary: doc.summary ?? null,
      totals: doc.totals,
      changes: doc.changes,
      notes: doc.notes,
    });
  }
  out.sort((a, b) => a.clip.localeCompare(b.clip));
  return out;
}

const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.split('"').join('""')}"` : s;
};

/**
 * The sentence comes first, because that is what the log is for. The numbers
 * follow for anything that wants to sort or total them.
 */
const COLUMNS = [
  'clip', 'change', 'kind', 'action', 'frame', 'time',
  'was_action', 'from_frame', 'from_time', 'tags', 'recorded_at',
  'annotator', 'signed_off_by', 'signed_off_at', 'actions_now', 'log_file',
];

function toRows(clips) {
  const rows = [];
  for (const c of clips) {
    const base = {
      clip: c.clip,
      annotator: c.annotator,
      signed_off_by: c.signedOff?.by ?? '',
      signed_off_at: c.signedOff?.at ?? '',
      actions_now: c.actions,
      log_file: c.logFile,
    };
    for (const x of c.changes) {
      rows.push({
        ...base,
        change: x.text ?? '',
        kind: x.kind ?? '',
        action: x.action ?? '',
        frame: x.frame ?? '',
        time: x.time ?? '',
        was_action: x.wasAction ?? '',
        from_frame: x.fromFrame ?? '',
        from_time: x.fromTime ?? '',
        tags: x.tags ?? '',
        recorded_at: x.at ?? '',
      });
    }
    // Whatever could not be recorded, so a total taken from this is not
    // silently short.
    for (const n of c.notes) rows.push({ ...base, change: n, kind: 'note' });
    if (!c.changes.length && !c.notes.length) {
      rows.push({ ...base, change: 'Signed off with no review on record.', kind: 'note' });
    }
  }
  return rows;
}

const toCsv = (rows) =>
  [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((k) => esc(r[k])).join(','))].join('\r\n') + '\r\n';

/**
 * One clip's history as plain text — the sentences and nothing else. This is
 * the form the log was asked for: openable, readable, no decoding.
 */
/**
 * One clip's history as plain text: a short header, then every correction in
 * the order the clip plays. Not split by sitting — the corrections are what
 * somebody walks through against the video, and chopping them into blocks put
 * a heading between two changes a second apart.
 */
function toText(c) {
  const lines = [`Review log — ${c.clip}`];
  if (c.annotator) lines.push(`Annotated by ${c.annotator}`);
  if (c.actions !== null) lines.push(`${c.actions} actions in the ground truth now`);
  if (c.summary) lines.push(c.summary);
  if (c.signedOff) {
    lines.push(`Signed off on ${String(c.signedOff.at ?? '').slice(0, 16).replace('T', ' ')}`);
  } else {
    lines.push('Not signed off');
  }
  lines.push('');

  if (!c.changes.length && !c.notes.length) {
    lines.push('No reviews on record.');
  }
  for (const x of c.changes) lines.push(`  - ${x.text ?? ''}`);
  if (c.notes.length) {
    lines.push('');
    for (const n of c.notes) lines.push(`  (${n})`);
  }
  return lines.join('\r\n');
}

const INDEX_COLUMNS = [
  'clip', 'annotator', 'actions_now', 'reviews', 'changes_recorded',
  'signed_off_by', 'signed_off_at', 'log_file',
];

function indexCsv(clips, names) {
  const rows = clips.map((c, i) => ({
    clip: c.clip,
    annotator: c.annotator,
    actions_now: c.actions,
    reviews: c.reviews,
    changes_recorded: c.changes.length,
    signed_off_by: c.signedOff?.by ?? '',
    signed_off_at: c.signedOff?.at ?? '',
    log_file: names[i],
  }));
  const head = INDEX_COLUMNS.join(',');
  const body = rows.map((r) => INDEX_COLUMNS.map((k) => esc(r[k])).join(','));
  return BOM + [head, ...body].join('\r\n') + '\r\n';
}

/**
 * Every clip's log as its own pair of files, in one download.
 *
 * A file per clip because that is how the work is organised: one reviewer goes
 * through one video. Both forms, because both get asked for — the .txt to read,
 * the .csv to sort. `_index.csv` says what is in the archive.
 */
function toZip(clips, at) {
  const used = new Map();
  const names = clips.map((c) => {
    let name = safeEntryName(c.clip, { ext: 'csv' });
    const seen = used.get(name.toLowerCase()) ?? 0;
    used.set(name.toLowerCase(), seen + 1);
    if (seen) name = safeEntryName(`${c.clip} (${seen + 1})`, { ext: 'csv' });
    return name;
  });
  const entries = [];
  clips.forEach((c, i) => {
    entries.push({ name: `csv/${names[i]}`, data: BOM + toCsv(toRows([c])) });
    entries.push({ name: `text/${names[i].replace(/\.csv$/, '.txt')}`, data: toText(c) });
  });
  entries.unshift({ name: '_index.csv', data: indexCsv(clips, names) });
  return zipSync(entries, { at });
}

function filename(ext, clip) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const who = clip ? clip.replace(/[^A-Za-z0-9._-]+/g, '_') : 'all-clips';
  const what = ext === 'zip' ? 'review-logs_per-clip' : 'review-log';
  return `${what}_${who}_${stamp}.${ext}`;
}

router.get('/reviews', requireAuth, async (req, res, next) => {
  try {
    const clip = typeof req.query.clip === 'string' && req.query.clip.trim()
      ? path.basename(req.query.clip.trim()).replace(/\.(json|mp4|webm|mov|mkv|m4v)$/i, '')
      : null;
    const clips = await collect(clip);
    const format = String(req.query.format ?? '').toLowerCase();
    const attach = req.query.download !== '0';

    if (format === 'zip') {
      res.setHeader('Content-Type', 'application/zip');
      if (attach) res.setHeader('Content-Disposition', `attachment; filename="${filename('zip', clip)}"`);
      return res.send(toZip(clips, new Date()));
    }

    if (format === 'txt') {
      const body = clips.map(toText).join('\r\n\r\n');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      if (attach) res.setHeader('Content-Disposition', `attachment; filename="${filename('txt', clip)}"`);
      return res.send(body || 'No reviews on record.\r\n');
    }

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      if (attach) res.setHeader('Content-Disposition', `attachment; filename="${filename('csv', clip)}"`);
      return res.send(BOM + toCsv(toRows(clips)));
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (attach) res.setHeader('Content-Disposition', `attachment; filename="${filename('json', clip)}"`);
    res.send(JSON.stringify({
      generatedAt: new Date().toISOString(),
      dir: GT_DIR,
      clips,
      totals: {
        clips: clips.length,
        reviews: clips.reduce((n, c) => n + c.reviews, 0),
        changes: clips.reduce((n, c) => n + c.changes.length, 0),
        signedOff: clips.filter((c) => c.signedOff).length,
      },
    }, null, 2));
  } catch (err) {
    next(err);
  }
});

/** How much there is to download, for a button that should say so. */
router.get('/reviews/summary', requireAuth, async (_req, res, next) => {
  try {
    const clips = await collect();
    res.json({
      clips: clips.length,
      reviews: clips.reduce((n, c) => n + c.reviews, 0),
      changes: clips.reduce((n, c) => n + c.changes.length, 0),
      signedOff: clips.filter((c) => c.signedOff).length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
