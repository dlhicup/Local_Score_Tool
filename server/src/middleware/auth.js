import { readToken } from '../services/users.js';

/** Attach the caller to the request, if their token is valid. */
export function withUser(req, _res, next) {
  // No sign-in on the local team tool: everyone who reaches the server is a
  // local admin with full access. Assignments still label who owns a clip;
  // they no longer gate visibility.
  req.user = { username: 'local', role: 'admin' };
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
  next();
}
