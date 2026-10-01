import { Router } from 'express';
import {
  EVENT_LABELS, LABEL_DEFINITIONS, TEAMS, SURE_LEVELS, BODY_PARTS, GOAL_VIEWS,
} from '../labels.js';
import { allKits, kitForClip } from '../services/kits.js';
import { actionDefinitions } from '../services/actions.js';

const router = Router();

router.get('/labels', async (_req, res, next) => {
  try {
    // Definitions come from guide.md, which calls itself the source of truth
    // for action names. Falls back to the built-in wording if it is missing.
    const { definitions, notes, source } = await actionDefinitions();
    res.json({
      labels: EVENT_LABELS,
      definitions,
      notes,
      definitionsFrom: source,
      // The tag vocabularies, so a client never has to hardcode them.
      tags: { teams: TEAMS, sure: SURE_LEVELS, body: BODY_PARTS, goalView: GOAL_VIEWS },
    });
  } catch (err) {
    next(err);
  }
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
