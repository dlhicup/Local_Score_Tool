import { readToken } from '../services/users.js';

/** Attach the caller to the request, if their token is valid. */
export function withUser(req, _res, next) {
  const header = req.get('authorization') || '';
  // A <video> src cannot carry a header, so streaming passes ?t= instead.
  // It is the same signed token and goes through the same verification.
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query?.t || null;
  req.user = token ? readToken(token) : null;
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
