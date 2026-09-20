import { Router } from 'express';
import {
  listProjects, readProject, writeProject, deleteProject, projectForClip, clipForId,
} from '../services/store.js';
import { summarise } from '../services/merge.js';
import { sanitiseEvent, groundTruthExists, toFrame, REPORTING_FPS } from '../services/gtfile.js';
import { getAssignments } from '../services/users.js';
import { requireAuth } from '../middleware/auth.js';
import { EVENT_LABELS } from '../labels.js';

/** A project is reachable only if its clip is. */
async function mayTouch(user, project) {
  if (user?.role === 'admin') return true;
  const clip = project?.video?.filename;
  if (!clip) return true;
  const assignments = await getAssignments();
  return assignments[clip] === user?.username;
}

const router = Router();

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

/**
 * A project id is a hash of its clip's filename, so an annotate URL is a
 * permanent handle to a clip rather than to a stored record. A clip that has
 * never been annotated simply has no ground-truth file yet — that is an empty
 * workspace, not a dead link. Only an id matching no clip at all is a 404.
 */
async function resolveProject(id) {
  const filename = await clipForId(id);
  if (!filename) throw Object.assign(new Error('Project not found'), { status: 404 });
  return projectForClip(filename);
}

router.get('/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!(await mayTouch(req.user, project))) return res.status(403).json({ error: 'This clip is not assigned to you' });
    // One file per clip now, so "saved" is simply whether it exists.
    const saved = await groundTruthExists(project.video?.filename);
    res.json({ project, summary: summarise(project.events ?? []), saved });
  } catch (err) {
    next(err);
  }
});

router.put('/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await resolveProject(req.params.id);
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
      video: { ...existing.video, ...(incoming.video ?? {}) },
      events,
      meta: { ...existing.meta, ...(incoming.meta ?? {}) },
    };
    // Re-saving a flagged clip means the annotator has addressed it — clear the
    // review so it leaves their "needs fix" list and returns to the reviewer's
    // queue as unreviewed. (Clients never set meta.review; only /review does.)
    if (existing.meta?.review && !incoming.meta?.review) {
      project.meta = { ...project.meta, review: null };
    }

    const { project: stored, written } = await writeProject(project);

    res.json({
      project: stored,
      summary: summarise(stored.events),
      groundTruthFile: written ? { path: written.path, count: written.count } : null,
      saved: Boolean(written),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const existing = await resolveProject(req.params.id).catch(() => null);
    if (existing && !(await mayTouch(req.user, existing))) {
      return res.status(403).json({ error: 'This clip is not assigned to you' });
    }
    await deleteProject(req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

/**
 * Download endpoint. Emits the clip's ground truth exactly as it is stored —
 * which is now the same shape the file on disk holds, tags and all. `?plain=1`
 * drops back to the bare `{frame, action}` rows for a consumer that predates
 * the tags.
 */
router.get('/projects/:id/export', requireAuth, async (req, res, next) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!(await mayTouch(req.user, project))) return res.status(403).json({ error: 'This clip is not assigned to you' });
    const plain = req.query.plain === '1';

    const rows = (project.events ?? [])
      .map((e, i) => ({ e, i }))
      .sort((a, b) => toFrame(a.e.timestamp) - toFrame(b.e.timestamp) || a.i - b.i)
      .map(({ e }) => {
        const row = { frame: toFrame(e.timestamp), action: e.type };
        if (plain) return row;
        Object.assign(row, {
          team: e.team,
          ball_xy: e.ball_xy ?? null,
          sure: e.sure,
          body: e.body,
          goal_view: e.goal_view,
        });
        if (e.type === 'goal' && e.own_goal) row.own_goal = true;
        return row;
      });

    const safeName = String(project.name).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 80);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'ground_truth'}.json"`);
    // One action per line: dense enough to scan, still a valid single JSON doc.
    res.send(
      rows.length
        ? `{"groundtruth":[\n${rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n]}\n`
        : '{"groundtruth":[]}\n',
    );
  } catch (err) {
    next(err);
  }
});

export { REPORTING_FPS };
export default router;
