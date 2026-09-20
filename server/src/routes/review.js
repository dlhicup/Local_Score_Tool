import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProjects, readProject, writeProject, idForVideo, VIDEO_DIR } from '../services/store.js';
import { getAssignments } from '../services/users.js';
import { isValidLabel } from '../labels.js';
import { requireAdmin } from '../middleware/auth.js';

/**
 * Reviewer workflow: a reviewer judges each labeled clip — approve, or flag
 * with a reason and note. Flagged clips are marked "needs fix" so they surface
 * in the annotator's own queue. Verdicts live on the clip's own record.
 *
 * Judge-only by design: a reviewer does not edit the ground truth. Corrections
 * are the annotator's to make, which keeps authorship clean.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXAM_DIR = path.resolve(ROOT, process.env.EXAM_DIR || 'exam');
const REPORTING_FPS = 25;

const REASONS = ['wrong_label', 'mistimed', 'missed_event', 'extra_event', 'off_taxonomy', 'other'];

/** Clip filename -> original content-hash, from the numbering index. */
let numToHash = null;
async function clipHash(name) {
  if (!numToHash) {
    numToHash = new Map();
    try {
      const idx = JSON.parse(await fs.readFile(path.join(ROOT, 'video_index.json'), 'utf8'));
      for (const c of idx.clips ?? []) numToHash.set(c.name, String(c.original).replace(/\.[^.]+$/, ''));
    } catch { /* index absent: no references, still reviewable */ }
  }
  return numToHash.get(name) ?? null;
}

/** The reference answer for a gold clip, or null. */
async function referenceFor(name) {
  const hash = await clipHash(name);
  if (!hash) return null;
  try {
    const doc = JSON.parse(await fs.readFile(path.join(EXAM_DIR, `${hash}.gt.json`), 'utf8'));
    const rows = Array.isArray(doc) ? doc : doc?.groundtruth ?? [];
    return rows.map((r) => ({ frame: Number(r.frame) || 0, action: String(r.action), seconds: Number(((Number(r.frame) || 0) / REPORTING_FPS).toFixed(2)) }));
  } catch {
    return null;
  }
}

const cleanReview = (r) =>
  r && typeof r === 'object'
    ? { verdict: r.verdict === 'approved' || r.verdict === 'flagged' ? r.verdict : null, reason: r.reason ?? null, note: typeof r.note === 'string' ? r.note : '', reviewer: r.reviewer ?? null, at: r.at ?? null }
    : null;

const router = Router();

/**
 * The review queue: every labeled clip, with its annotator, review verdict and
 * whether it falls in the QC sample (a stable 1-in-10 slice per annotator, so
 * quality can be measured without re-watching the whole corpus).
 */
router.get('/review/queue', requireAdmin, async (_req, res, next) => {
  try {
    const [projects, assignments, names] = await Promise.all([
      listProjects(),
      getAssignments(),
      fs.readdir(VIDEO_DIR).catch(() => []),
    ]);
    const byFile = new Map();
    for (const p of projects) if (p.video?.filename) byFile.set(p.video.filename, p);

    // stable per-annotator sample flag: sort each owner's labeled clips, mark every 10th
    const labeledByOwner = {};
    const rows = [];
    for (const name of names.filter((n) => /\.(mp4|webm|mov|mkv|m4v)$/i.test(n)).sort()) {
      const p = byFile.get(name);
      if (!p || !p.eventCount) continue; // only labeled clips are reviewable
      const owner = assignments[name] ?? null;
      (labeledByOwner[owner] ??= []).push(name);
      rows.push({
        name,
        id: p.id,
        annotator: owner,
        actions: p.eventCount,
        review: cleanReview(p.meta?.review ?? p.review) ?? { verdict: null },
      });
    }
    const sample = new Set();
    for (const list of Object.values(labeledByOwner)) list.forEach((n, i) => { if (i % 10 === 0) sample.add(n); });
    for (const r of rows) r.inSample = sample.has(r.name);

    const verdictOf = (r) => r.review?.verdict ?? 'unreviewed';
    res.json({
      rows,
      reasons: REASONS,
      summary: {
        total: rows.length,
        unreviewed: rows.filter((r) => verdictOf(r) === 'unreviewed').length,
        approved: rows.filter((r) => verdictOf(r) === 'approved').length,
        flagged: rows.filter((r) => verdictOf(r) === 'flagged').length,
        sample: rows.filter((r) => r.inSample).length,
      },
    });
  } catch (err) {
    next(err);
  }
});

/** One clip for review: the annotator's actions, plus the reference if gold. */
router.get('/review/:id', requireAdmin, async (req, res, next) => {
  try {
    const project = await readProject(req.params.id);
    const rows = (project.events ?? [])
      .filter((e) => isValidLabel(e.type))
      .map((e) => ({ action: e.type, seconds: Number((Number(e.timestamp) || 0).toFixed(2)), frame: Math.round((Number(e.timestamp) || 0) * REPORTING_FPS) }))
      .sort((a, b) => a.seconds - b.seconds);
    const reference = await referenceFor(project.video?.filename);
    res.json({
      id: project.id,
      clip: project.video?.filename ?? null,
      annotator: (await getAssignments())[project.video?.filename] ?? null,
      duration: project.video?.duration ?? null,
      actions: rows,
      reference, // null unless this is a gold clip
      review: cleanReview(project.meta?.review ?? project.review) ?? { verdict: null },
    });
  } catch (err) {
    if (err.code === 'ENOENT' || err.status === 404) return res.status(404).json({ error: 'No such clip' });
    next(err);
  }
});

/** Record a verdict. Flagging marks the clip needs-fix for the annotator. */
router.put('/review/:id', requireAdmin, async (req, res, next) => {
  try {
    const { verdict, reason, note } = req.body ?? {};
    if (verdict !== 'approved' && verdict !== 'flagged') return res.status(400).json({ error: 'verdict must be approved or flagged' });
    if (verdict === 'flagged' && reason && !REASONS.includes(reason)) return res.status(400).json({ error: 'unknown reason' });

    const project = await readProject(req.params.id);
    project.meta = project.meta ?? {};
    project.meta.review = {
      verdict,
      reason: verdict === 'flagged' ? reason ?? 'other' : null,
      note: typeof note === 'string' ? note.slice(0, 500) : '',
      reviewer: req.user.username,
      at: new Date().toISOString(),
    };
    // "needs fix" is just the flagged verdict surfaced on the annotator's side;
    // the videos list reads project.meta.review and badges it.
    delete project.review; // migrate any older top-level field
    await writeProject(project);
    res.json({ id: project.id, review: project.meta.review });
  } catch (err) {
    if (err.code === 'ENOENT' || err.status === 404) return res.status(404).json({ error: 'No such clip' });
    next(err);
  }
});

export default router;
