import { Router } from 'express';
import fs from 'node:fs/promises';
import { listProjects, readProject, writeProject, deleteProject, emptyProject, newId, idForVideo } from '../services/store.js';
import { VIDEO_DIR } from './videos.js';
import { summarise } from '../services/merge.js';
import { writeGroundTruth, removeGroundTruth, groundTruthExists, GT_DIR } from '../services/gtfile.js';
import { getAssignments } from '../services/users.js';
import { requireAuth } from '../middleware/auth.js';

/** A project is reachable only if its clip is. */
async function mayTouch(user, project) {
  if (user?.role === 'admin') return true;
  const clip = project?.video?.filename;
  if (!clip) return true;
  const assignments = await getAssignments();
  return assignments[clip] === user?.username;
}
import { EVENT_LABELS, isValidLabel } from '../labels.js';

const router = Router();

/** Guard the ground-truth contract at the write boundary, not just at import. */
function sanitiseEvent(e) {
  if (!isValidLabel(e?.type)) return null;
  const t = Number(e.timestamp);
  if (!Number.isFinite(t)) return null;
  return {
    id: typeof e.id === 'string' && e.id ? e.id : newId('evt'),
    type: e.type,
    timestamp: Number(t.toFixed(3)),
    endTimestamp: Number.isFinite(Number(e.endTimestamp)) ? Number(Number(e.endTimestamp).toFixed(3)) : null,
    team: e.team === 'home' || e.team === 'away' ? e.team : null,
    player: typeof e.player === 'string' ? e.player.slice(0, 80) : null,
    confidence: Number.isFinite(Number(e.confidence)) ? Math.min(1, Math.max(0, Number(e.confidence))) : 0.5,
    source: e.source === 'human' ? 'human' : 'ai',
    status: ['pending', 'accepted', 'rejected', 'edited'].includes(e.status) ? e.status : 'pending',
    description: typeof e.description === 'string' ? e.description.slice(0, 240) : '',
    agreement: Number.isFinite(Number(e.agreement)) ? Number(e.agreement) : 1,
  };
}

router.get('/projects', requireAuth, async (req, res, next) => {
  try {
    const all = await listProjects();
    if (req.user.role === 'admin') return res.json({ projects: all });
    const assignments = await getAssignments();
    res.json({ projects: all.filter((p) => assignments[p.video?.filename] === req.user.username) });
  } catch (err) {
    next(err);
  }
});

router.post('/projects', requireAuth, async (req, res, next) => {
  try {
    const project = emptyProject({ name: req.body?.name, video: req.body?.video });
    await writeProject(project);
    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

/**
 * A project id is a hash of its clip's filename, so an annotate URL is a
 * permanent handle to a clip — not to a stored record. The record is absent in
 * two perfectly ordinary situations: the clip has never been annotated, and its
 * ground truth was just deleted. Neither should read as a dead link, so a miss
 * is resolved back to the clip it names and a fresh session is opened on it.
 *
 * Only a hash matching no clip at all is genuinely not found.
 */
async function resolveProject(id) {
  try {
    return Object.assign(await readProject(id), { $stored: true });
  } catch (err) {
    if (err.status !== 404) throw err;
    const names = await fs.readdir(VIDEO_DIR).catch(() => []);
    const filename = names.find((n) => idForVideo(n) === id);
    if (!filename) throw err;
    const project = { ...emptyProject({ name: filename, video: { filename } }), id };
    await writeProject(project);
    // Written so the URL keeps working, but nothing has been saved yet: there
    // is no ground truth here for a delete to remove.
    return Object.assign(project, { $stored: false });
  }
}

router.get('/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!(await mayTouch(req.user, project))) return res.status(403).json({ error: 'This clip is not assigned to you' });
    const { $stored, ...clean } = project;
    // Delete is only meaningful once a save has actually put both halves on
    // disk — the working record and the deliverable next to it.
    const saved = $stored && (await groundTruthExists(project.video?.filename));
    res.json({ project: clean, summary: summarise(project.events ?? []), saved });
  } catch (err) {
    next(err);
  }
});

router.put('/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await readProject(req.params.id);
    if (!(await mayTouch(req.user, existing))) return res.status(403).json({ error: 'This clip is not assigned to you' });
    const incoming = req.body?.project ?? {};

    const events = Array.isArray(incoming.events)
      ? incoming.events.map(sanitiseEvent).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp)
      : existing.events;

    const project = {
      ...existing,
      name: typeof incoming.name === 'string' && incoming.name.trim() ? incoming.name.trim() : existing.name,
      // The label list is ours, never the client's.
      labels: EVENT_LABELS,
      video: incoming.video ?? existing.video,
      extraction: incoming.extraction ?? existing.extraction,
      events,
      meta: { ...existing.meta, ...(incoming.meta ?? {}) },
    };
    // Re-saving a flagged clip means the annotator has addressed it — clear the
    // review so it leaves their "needs fix" list and returns to the reviewer's
    // queue as unreviewed. (Clients never set meta.review; only /review does.)
    if (existing.meta?.review && !incoming.meta?.review) {
      project.meta = { ...project.meta, review: null };
    }

    await writeProject(project);
    // The deliverable is written in the same request as the working file, so
    // the two can never disagree about what was saved.
    const gt = await writeGroundTruth(project).catch((err) => {
      console.error('ground-truth file write failed:', err.message);
      return null;
    });

    res.json({
      project,
      summary: summarise(project.events),
      groundTruthFile: gt ? { path: gt.path, count: gt.count } : null,
      saved: Boolean(gt),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/projects/:id', requireAuth, async (req, res, next) => {
  try {
    // Read the clip name before the record goes, so its file can go with it.
    const existing = await readProject(req.params.id).catch(() => null);
    if (existing && !(await mayTouch(req.user, existing))) {
      return res.status(403).json({ error: 'This clip is not assigned to you' });
    }
    await deleteProject(req.params.id);
    if (existing?.video?.filename) await removeGroundTruth(existing.video.filename).catch(() => {});
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * The reporting clock is fixed at 25 fps by the scoring system — NOT the rate
 * the footage was shot at. A 30s clip is 750 frames here even if it is 30 fps
 * video. Mixing the two clocks is what makes ground truth line up with nothing.
 */
const REPORTING_FPS = 25;

/**
 * Seconds -> reporting frame. Mirrors web/src/lib/fps.js; keep them in step.
 *
 * toFixed(6) first: 17.9 * 25 is 447.49999999999994 in float64, which rounds
 * DOWN to 447 when the answer should be 448.
 */
const toFrame = (seconds, fps = REPORTING_FPS) =>
  Math.max(0, Math.round(Number(((Number(seconds) || 0) * (fps || REPORTING_FPS)).toFixed(6))));

/**
 * Download endpoint. Emits the delivered ground-truth shape by default —
 * frame numbers and action names — or the detailed working record with
 * `?detailed=1`.
 */
router.get('/projects/:id/export', requireAuth, async (req, res, next) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!(await mayTouch(req.user, project))) return res.status(403).json({ error: 'This clip is not assigned to you' });
    const onlyAccepted = req.query.accepted === '1';
    const detailed = req.query.detailed === '1';
    // ?fps= remains an escape hatch, but never the video's own rate.
    const fps = Number(req.query.fps) || REPORTING_FPS;

    const events = (project.events ?? [])
      .filter((e) => (onlyAccepted ? e.status === 'accepted' : e.status !== 'rejected'))
      .map((e) => ({ ...e, frame: toFrame(e.timestamp, fps) }))
      .sort((a, b) => a.frame - b.frame || a.timestamp - b.timestamp);

    const payload = detailed
      ? {
          schema: 'score-gt/1.1',
          id: project.id,
          name: project.name,
          labels: EVENT_LABELS,
          video: { ...project.video, fps },
          groundtruth: events.map((e) => ({
            frame: e.frame,
            action: e.type,
            timestamp: e.timestamp,
            team: e.team ?? null,
            player: e.player ?? null,
            confidence: e.confidence,
            source: e.source,
            status: e.status,
            description: e.description ?? '',
          })),
          meta: { ...project.meta, exportedAt: new Date().toISOString(), fps },
        }
      : { groundtruth: events.map((e) => ({ frame: e.frame, action: e.type })) };
    const safeName = String(project.name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'ground_truth'}.json"`);
    // One action per line: dense enough to scan, still a valid single JSON doc.
    res.send(
      detailed
        ? JSON.stringify(payload, null, 2)
        : `{"groundtruth":[\n${payload.groundtruth.map((e) => `  ${JSON.stringify(e)}`).join(',\n')}\n]}`,
    );
  } catch (err) {
    next(err);
  }
});

export default router;
