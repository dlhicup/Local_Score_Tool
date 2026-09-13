import { Router } from 'express';
import { EVENT_LABELS, LABEL_DEFINITIONS } from '../labels.js';

const router = Router();

router.get('/labels', (_req, res) => {
  res.json({ labels: EVENT_LABELS, definitions: LABEL_DEFINITIONS });
});

export default router;
