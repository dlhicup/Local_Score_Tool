import { Router } from 'express';
import {
  listProjects, readProject, writeProject, deleteProject, projectForClip, clipForId,
} from '../services/store.js';
import { summarise } from '../services/merge.js';
import { sanitiseEvent, rowFor, groundTruthExists, toFrame, REPORTING_FPS } from '../services/gtfile.js';
import { getAssignments } from '../services/users.js';
import { reviewEntry, sameActions } from '../services/reviewlog.js';
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

/**
 * Take a review mark off again: `?stage=2` the second, `?stage=1` the first —
 * and with it the second, which cannot stand alone. With no stage, the
 * highest one the clip has.
 *
 * Its own route rather than a flag on the save, because clearing a mark is
 * about the clip's status and not its actions: a reviewer who has unsaved edits
 * on screen must be able to drop a mark without those edits being written
 * along with it. The file is rewritten with the actions it already holds.
 */
router.delete('/projects/:id/reviewed', requireAuth, async (req, res, next) => {
  try {
    const project = await resolveProject(req.params.id);
    if (!(await mayTouch(req.user, project))) return res.status(403).json({ error: 'This clip is not assigned to you' });
    const level = project.meta?.reviewLevel ?? 0;
    if (!level) return res.json({ reviewLevel: 0, changed: false });
    const asked = Number(req.query.stage);
    const stage = asked === 1 || asked === 2 ? asked : level;
    if (stage > level) return res.json({ reviewLevel: level, changed: false });
    const stages = stage === 1 ? { first: null, second: null } : { second: null };
    const { project: stored } = await writeProject(project, { stages });
    res.json({
      reviewLevel: stored.meta?.reviewLevel ?? 0,
      firstReview: stored.meta?.firstReview ?? null,
      secondReview: stored.meta?.secondReview ?? null,
      changed: true,
    });
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

    /**
     * A save made from the review page records what the review changed. The
     * counts are taken here rather than trusted from the request: `before` is
     * the file this write is about to replace, `after` is what replaces it.
     * Nothing is appended when the reviewer changed nothing.
     */
    const entry = req.body?.review
      ? reviewEntry({
          before: existing.events,
          after: events,
          claim: req.body.review,
          by: req.user?.username ?? null,
        })
      : null;

    /**
     * Two reviews, in order. Finishing signs the next one: the first on an
     * unreviewed clip, the second on a clip that has had its first, and the
     * second again on a clip that has had both.
     *
     * What a change to the actions clears depends on where it came from.
     *
     * From the review page, the edit is part of the review in progress — the
     * second reviewer is expected to fix things — so it keeps every stage
     * below the one being worked on. Clearing the first review the moment the
     * second reviewer touched anything would make the second review
     * impossible to finish. A clip that had passed both is being reviewed
     * again, so it loses its second until that is finished again.
     *
     * From the annotating page, a change to a reviewed clip happened outside
     * any review, so both marks go. The boxes are a claim about the file as it
     * stands; a clip showing two passed reviews over actions nobody reviewed
     * would be worse than showing none.
     */
    const finishing = req.body?.finishReview === true;
    const reviewing = req.body?.reviewing === true || finishing;
    const changed = !sameActions(existing.events, events);
    const level = existing.meta?.reviewLevel ?? 0;
    const stamp = () => ({ by: req.user?.username ?? null, at: new Date().toISOString(), actions: events.length });

    let stages; // undefined: leave the review marks as they are
    if (finishing) stages = level === 0 ? { first: stamp(), second: null } : { second: stamp() };
    else if (changed && !reviewing) stages = level ? { first: null, second: null } : undefined;
    else if (changed && level === 2) stages = { second: null };

    const { project: stored, written } = await writeProject(project, { logEntry: entry, stages });

    res.json({
      project: stored,
      summary: summarise(stored.events),
      groundTruthFile: written ? { path: written.path, count: written.count } : null,
      saved: Boolean(written),
      review: entry,
      reviewLevel: stored.meta?.reviewLevel ?? 0,
      firstReview: stored.meta?.firstReview ?? null,
      secondReview: stored.meta?.secondReview ?? null,
      // Which stage this save signed, if it signed one, so the toast can say.
      signedStage: finishing ? (level === 0 ? 1 : 2) : null,
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
 * Download endpoint. Emits the clip's ground truth in the shape the file on
 * disk holds: `{frame, action}`, `unsure` where set, and any tags an older file
 * still carries. `?plain=1` gives the bare `{frame, action}` rows only.
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
        if (plain) return { frame: toFrame(e.timestamp), action: e.type };
        return rowFor(e);
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
