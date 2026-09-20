import { Router } from 'express';
import {
  EVENT_LABELS, LABEL_DEFINITIONS, TEAMS, SURE_LEVELS, BODY_PARTS, GOAL_VIEWS,
} from '../labels.js';
import { allKits, kitForClip } from '../services/kits.js';

const router = Router();

router.get('/labels', (_req, res) => {
  res.json({
    labels: EVENT_LABELS,
    definitions: LABEL_DEFINITIONS,
    // The tag vocabularies, so a client never has to hardcode them.
    tags: { teams: TEAMS, sure: SURE_LEVELS, body: BODY_PARTS, goalView: GOAL_VIEWS },
  });
});

/** The whole kit file, and whether there is one at all. */
router.get('/kits', async (_req, res, next) => {
  try {
    res.json(await allKits());
  } catch (err) {
    next(err);
  }
});

/** The kit that applies to one clip — its own line, or the default. */
router.get('/kits/:name', async (req, res, next) => {
  try {
    res.json({ kit: await kitForClip(req.params.name) });
  } catch (err) {
    next(err);
  }
});

export default router;
