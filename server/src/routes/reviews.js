import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { groundTruthIndex, GT_DIR, REPORTING_FPS } from '../services/gtfile.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * The review log, for downloading.
 *
 * Every clip's file carries its own review history — who corrected it, when,
 * and which actions they added, removed, retimed or re-tagged. That is the
 * right place for it to live: it travels with the file. It is the wrong place
 * to *read* it from when the question is about the corpus rather than one clip,
 * which is what this is for: one request, every clip's history, as a table.
 *
 * CSV is one row per change, because the question people ask of this is "what
 * changed where" and a spreadsheet answers that. JSON is the log as stored, for
 * anything that would rather parse than read.
 */
const router = Router();

/** A frame on the reporting clock -> the timestamp it denotes. */
const seconds = (frame) => Number((Number(frame) / REPORTING_FPS).toFixed(2));

/** mm:ss.ss, for reading against a video player. */
function clock(frame) {
  const s = Number(frame) / REPORTING_FPS;
  if (!Number.isFinite(s) || s < 0) return '';
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, '0')}`;
}

/** What one change record says, in words. */
const KIND = { add: 'added', del: 'removed', time: 'retimed', tag: 'retagged' };

/**
 * Read every clip's review history.
 *
 * Reads the files directly rather than going through listProjects(), which
 * probes each clip's video — none of which this needs, and which would make a
 * download of the log wait on ffprobe.
 */
async function collect(onlyClip = null) {
  const index = await groundTruthIndex();
  const out = [];
  for (const [, entry] of index) {
    const clip = path.basename(entry.rel).replace(/\.json$/i, '');
    if (onlyClip && clip.toLowerCase() !== onlyClip.toLowerCase()) continue;
    let doc;
    try {
      doc = JSON.parse(await fs.readFile(entry.path, 'utf8'));
    } catch {
      continue; // a file that no longer parses has no history to report
    }
    if (Array.isArray(doc)) continue;
    const reviews = Array.isArray(doc?.reviews) ? doc.reviews.filter((x) => x && typeof x === 'object') : [];
    const reviewed = doc?.reviewed && typeof doc.reviewed === 'object' ? doc.reviewed : null;
    if (!reviews.length && !reviewed) continue;
    out.push({
      clip,
      file: entry.rel,
      annotator: typeof doc?.annotator === 'string' ? doc.annotator : null,
      actions: Array.isArray(doc?.groundtruth) ? doc.groundtruth.length : null,
      reviewed,
      reviews,
    });
  }
  out.sort((a, b) => a.clip.localeCompare(b.clip));
  return out;
}

const esc = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.split('"').join('""')}"` : s;
};

const COLUMNS = [
  'clip', 'file', 'annotator', 'reviewed_at', 'reviewed_by',
  'review_at', 'review_by', 'review_index', 'actions_before', 'actions_after',
  'detail', 'change', 'action', 'frame', 'time', 'mmss',
  'from_frame', 'from_time', 'tags_changed', 'count', 'note',
];

/**
 * One row per change, with a summary row standing in wherever the per-change
 * detail is not on file — an older review whose detail has aged out, or one the
 * server had to work out from the two files alone. The `detail` column says
 * which it is, so a total taken from this table is never silently wrong.
 */
function toRows(clips) {
  const rows = [];
  for (const c of clips) {
    const base = {
      clip: c.clip,
      file: c.file,
      annotator: c.annotator,
      reviewed_at: c.reviewed?.at ?? '',
      reviewed_by: c.reviewed?.by ?? '',
    };
    if (!c.reviews.length) {
      rows.push({ ...base, detail: 'none', note: 'signed off with no review on record' });
      continue;
    }
    c.reviews.forEach((r, i) => {
      const head = {
        ...base,
        review_at: r.at ?? '',
        review_by: r.by ?? '',
        review_index: i + 1,
        actions_before: r.before ?? '',
        actions_after: r.after ?? '',
      };
      if (Array.isArray(r.changes) && r.changes.length) {
        for (const x of r.changes) {
          rows.push({
            ...head,
            detail: 'exact',
            change: KIND[x.c] ?? x.c,
            action: x.a,
            frame: x.f,
            time: seconds(x.f),
            mmss: clock(x.f),
            from_frame: x.c === 'time' ? x.f0 : '',
            from_time: x.c === 'time' ? seconds(x.f0) : '',
            tags_changed: x.c === 'tag' ? (x.k ?? []).join(' ') : '',
            count: 1,
          });
        }
        if (r.changesOmitted) {
          rows.push({ ...head, detail: 'summary', change: 'omitted', count: r.changesOmitted, note: 'change list was capped' });
        }
      } else {
        // Counts only. Emit one row per label so the table still adds up.
        for (const [label, n] of Object.entries(r.added ?? {})) {
          rows.push({ ...head, detail: 'summary', change: 'added', action: label, count: n });
        }
        for (const [label, n] of Object.entries(r.removed ?? {})) {
          rows.push({ ...head, detail: 'summary', change: 'removed', action: label, count: n });
        }
        if (r.retimed) rows.push({ ...head, detail: 'summary', change: 'retimed', count: r.retimed });
        if (r.retagged) rows.push({ ...head, detail: 'summary', change: 'retagged', count: r.retagged });
        if (r.derived) {
          rows.push({ ...head, detail: 'summary', change: 'note', note: "counts taken from the files, not the reviewer's own account" });
        }
      }
    });
  }
  return rows;
}

const toCsv = (rows) =>
  [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((k) => esc(r[k])).join(','))].join('\r\n') + '\r\n';

/** A filename a download can land under without being mistaken for another. */
function filename(ext, clip) {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const who = clip ? clip.replace(/[^A-Za-z0-9._-]+/g, '_') : 'all-clips';
  return `review-log_${who}_${stamp}.${ext}`;
}

router.get('/reviews', requireAuth, async (req, res, next) => {
  try {
    const clip = typeof req.query.clip === 'string' && req.query.clip.trim()
      ? path.basename(req.query.clip.trim()).replace(/\.(json|mp4|webm|mov|mkv|m4v)$/i, '')
      : null;
    const clips = await collect(clip);
    const csv = String(req.query.format ?? '').toLowerCase() === 'csv';
    // `download` is what makes the browser save it rather than show it; without
    // it this is just as useful to read in a tab.
    const attach = req.query.download !== '0';

    if (csv) {
      const rows = toRows(clips);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      if (attach) res.setHeader('Content-Disposition', `attachment; filename="${filename('csv', clip)}"`);
      // Excel reads a UTF-8 CSV as the system codepage unless it sees a BOM,
      // which turns every clip name with an accent in it into mojibake.
      return res.send('﻿' + toCsv(rows));
    }

    const body = {
      generatedAt: new Date().toISOString(),
      dir: GT_DIR,
      clips,
      totals: {
        clips: clips.length,
        reviews: clips.reduce((n, c) => n + c.reviews.length, 0),
        signedOff: clips.filter((c) => c.reviewed).length,
      },
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (attach) res.setHeader('Content-Disposition', `attachment; filename="${filename('json', clip)}"`);
    res.send(JSON.stringify(body, null, 2));
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
      reviews: clips.reduce((n, c) => n + c.reviews.length, 0),
      changes: clips.reduce(
        (n, c) => n + c.reviews.reduce((m, r) => m + (Array.isArray(r.changes) ? r.changes.length : 0), 0),
        0,
      ),
      signedOff: clips.filter((c) => c.reviewed).length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
