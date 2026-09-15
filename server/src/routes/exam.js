import { Router } from 'express';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidLabel } from '../labels.js';
import { requireAuth } from '../middleware/auth.js';

/**
 * The reference set: worked examples of ground truth, each beside the clip it
 * describes.
 *
 * Read-only, and open to every signed-in user: these are what an annotator
 * learns the conventions from — when a pass becomes a clearance, how tightly
 * to time a tackle — so withholding them would only make the corpus less
 * consistent.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXAM_DIR = path.resolve(ROOT, process.env.EXAM_DIR || 'exam');
const REPORTING_FPS = 25;

/** Hashes name these files; nothing else is allowed near the folder. */
function resolveExam(hash, ext) {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(String(hash || ''))) return null;
  const full = path.join(EXAM_DIR, `${hash}${ext}`);
  return full.startsWith(EXAM_DIR + path.sep) ? full : null;
}

/** The clip numbers the studio uses, so an exam entry can be named familiarly. */
let numbering = null;
async function clipNumbers() {
  if (numbering) return numbering;
  numbering = new Map();
  try {
    const idx = JSON.parse(await fs.readFile(path.join(ROOT, 'video_index.json'), 'utf8'));
    for (const c of idx.clips ?? []) {
      if (c.original) numbering.set(String(c.original).replace(/\.[^.]+$/, ''), c.name);
    }
  } catch {
    // Without the index the exam set still reads fine, just without numbers.
  }
  return numbering;
}

const read = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));

/** Both shapes are accepted: a bare array, or {"groundtruth": [...]}. */
const rowsOf = (doc) => (Array.isArray(doc) ? doc : doc?.groundtruth ?? []);

const router = Router();

router.get('/exam', requireAuth, async (_req, res, next) => {
  try {
    const names = await fs.readdir(EXAM_DIR).catch(() => []);
    const nums = await clipNumbers();
    const entries = [];
    for (const n of names) {
      if (!n.endsWith('.gt.json')) continue;
      const hash = n.slice(0, -'.gt.json'.length);
      const [doc, vstat] = await Promise.all([
        read(path.join(EXAM_DIR, n)).catch(() => null),
        fs.stat(path.join(EXAM_DIR, `${hash}.mp4`)).catch(() => null),
      ]);
      const rows = rowsOf(doc);
      const byType = {};
      for (const r of rows) if (isValidLabel(r?.action)) byType[r.action] = (byType[r.action] ?? 0) + 1;
      entries.push({
        hash,
        clip: nums.get(hash) ?? null,
        events: rows.length,
        offTaxonomy: rows.filter((r) => !isValidLabel(r?.action)).length,
        lastFrame: rows.reduce((m, r) => Math.max(m, Number(r?.frame) || 0), 0),
        byType,
        hasVideo: Boolean(vstat),
        size: vstat?.size ?? null,
      });
    }
    entries.sort((a, b) => String(a.clip ?? a.hash).localeCompare(String(b.clip ?? b.hash)));
    res.json({
      entries,
      dir: EXAM_DIR,
      fps: REPORTING_FPS,
      summary: {
        clips: entries.length,
        events: entries.reduce((s, e) => s + e.events, 0),
        withVideo: entries.filter((e) => e.hasVideo).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/exam/:hash', requireAuth, async (req, res, next) => {
  const file = resolveExam(req.params.hash, '.gt.json');
  if (!file) return res.status(400).json({ error: 'Bad exam id' });
  try {
    const rows = rowsOf(await read(file)).map((r) => ({
      frame: Number(r?.frame) || 0,
      action: String(r?.action ?? ''),
      seconds: Number(((Number(r?.frame) || 0) / REPORTING_FPS).toFixed(2)),
      valid: isValidLabel(r?.action),
    }));
    rows.sort((a, b) => a.frame - b.frame);
    const nums = await clipNumbers();
    res.json({ hash: req.params.hash, clip: nums.get(req.params.hash) ?? null, fps: REPORTING_FPS, rows });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'No such exam entry' });
    next(err);
  }
});

router.get('/exam/:hash/video', requireAuth, async (req, res, next) => {
  const file = resolveExam(req.params.hash, '.mp4');
  if (!file) return res.status(400).json({ error: 'Bad exam id' });
  try {
    const stat = await fs.stat(file);
    const etag = `"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    const lastMod = new Date(stat.mtimeMs).toUTCString();
    // Cached the same way the annotate route caches clips, and for the same
    // reason: max-age=0/must-revalidate sent every range request to the
    // network, and a revalidation carrying a Range is answered with bytes,
    // never 304 - so the browser could reuse nothing it already held and each
    // frame step paid a round trip. That is what made stepping here feel
    // sluggish next to the workspace.
    const base = {
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      ETag: etag,
      'Last-Modified': lastMod,
      'Cache-Control': 'private, max-age=3600',
    };

    // A bare revalidation may be answered "unchanged". A *range* request may
    // not: the player is asking for bytes it does not have, and a bodyless 304
    // leaves it with nothing to play.
    if (!req.headers.range && req.headers['if-none-match'] === etag) {
      res.writeHead(304, base);
      return res.end();
    }

    const send = (opts) => {
      const s = createReadStream(file, opts);
      // .pipe() forwards neither source errors nor client aborts, so an
      // unhandled read error would take the process down and every abandoned
      // seek would leak a file descriptor.
      s.on('error', (e) => {
        if (!res.headersSent) res.status(500);
        res.end();
        if (e.code !== 'ENOENT') console.error('exam video read failed:', e.message);
      });
      res.on('close', () => s.destroy());
      s.pipe(res);
    };

    // A resume is only valid against the same bytes; if the file changed under
    // the client, ignore the range and send the whole thing afresh.
    const ifRange = req.headers['if-range'];
    const rangeOk = !ifRange || ifRange === etag || ifRange === lastMod;
    const range = rangeOk ? req.headers.range : null;
    if (!range) {
      res.writeHead(200, { ...base, 'Content-Length': stat.size });
      return send();
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m || (!m[1] && !m[2])) {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    let start, end;
    if (!m[1]) {
      start = stat.size - Math.min(Number(m[2]), stat.size);
      end = stat.size - 1;
    } else {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    }
    if (!Number.isFinite(start) || start >= stat.size || start > end) {
      res.writeHead(416, { ...base, 'Content-Range': `bytes */${stat.size}` });
      return res.end();
    }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    send({ start, end });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'No video for this exam entry' });
    next(err);
  }
});

export default router;
