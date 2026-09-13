import { Router } from 'express';
import {
  authenticate, issueToken, listUsers, createUser, updateUser, deleteUser,
  setHotkeys, getAssignments, assignClips, getUser, ROLES,
} from '../services/users.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.post('/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {};
    const user = await authenticate(username, password);
    // One message for both cases: saying "no such user" tells an attacker
    // which usernames exist.
    if (!user) return res.status(401).json({ error: 'No such user — ask an admin to create your account' });
    res.json({ token: issueToken(user), user });
  } catch (err) {
    next(err);
  }
});

/** Who am I — used on load to restore a session. */
router.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const user = await getUser(req.user.username);
    if (!user) return res.status(401).json({ error: 'Account no longer exists' });
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

/** Your own hotkeys, so they follow you to any browser. */
router.put('/auth/hotkeys', requireAuth, async (req, res, next) => {
  try {
    res.json({ user: await setHotkeys(req.user.username, req.body?.hotkeys) });
  } catch (err) {
    next(err);
  }
});


// ------------------------------------------------------------ admin only

router.get('/users', requireAdmin, async (_req, res, next) => {
  try {
    res.json({ users: await listUsers(), roles: ROLES });
  } catch (err) {
    next(err);
  }
});

router.post('/users', requireAdmin, async (req, res, next) => {
  try {
    res.status(201).json({ user: await createUser(req.body ?? {}) });
  } catch (err) {
    next(err);
  }
});

router.put('/users/:username', requireAdmin, async (req, res, next) => {
  try {
    res.json({ user: await updateUser(req.params.username, req.body ?? {}) });
  } catch (err) {
    next(err);
  }
});

router.delete('/users/:username', requireAdmin, async (req, res, next) => {
  try {
    if (req.params.username === req.user.username) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    await deleteUser(req.params.username);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/assignments', requireAdmin, async (_req, res, next) => {
  try {
    res.json({ assignments: await getAssignments() });
  } catch (err) {
    next(err);
  }
});

router.put('/assignments', requireAdmin, async (req, res, next) => {
  try {
    const clips = Array.isArray(req.body?.clips) ? req.body.clips : [];
    const username = req.body?.username || null;
    res.json({ assignments: await assignClips(clips, username) });
  } catch (err) {
    next(err);
  }
});

export default router;
