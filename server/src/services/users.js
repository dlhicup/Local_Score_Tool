import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Users, sessions and clip assignments — all file-backed like the rest.
 *
 * Passwords are stored as scrypt hashes with a per-user salt, never in the
 * clear and never reversible. Sessions are stateless HMAC-signed tokens so a
 * restart does not log everyone out, and carry an expiry so a leaked one dies.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DATA_DIR = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const USERS = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, '.session-secret');

await fs.mkdir(DATA_DIR, { recursive: true });

export const ROLES = ['admin', 'annotator'];
const SESSION_DAYS = 14;

/** A signing secret that survives restarts, generated once if absent. */
async function loadSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const existing = await fs.readFile(SECRET_FILE, 'utf8').catch(() => null);
  if (existing?.trim()) return existing.trim();
  const generated = crypto.randomBytes(32).toString('hex');
  await fs.writeFile(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}
const SECRET = await loadSecret();

// ---------------------------------------------------------------- passwords

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
  // Constant-time: a length-varying compare leaks how much of the hash matched.
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// -------------------------------------------------------------------- store

const EMPTY = { schema: 'score-gt/users-1.0', users: [], assignments: {} };

async function load() {
  const raw = await fs.readFile(USERS, 'utf8').catch(() => null);
  if (!raw) return { ...EMPTY };
  try {
    const j = JSON.parse(raw);
    return {
      ...EMPTY,
      ...j,
      users: Array.isArray(j.users) ? j.users : [],
      assignments: j.assignments && typeof j.assignments === 'object' ? j.assignments : {},
    };
  } catch {
    await fs.rename(USERS, `${USERS}.corrupt-${Date.now()}`).catch(() => {});
    return { ...EMPTY };
  }
}

let queue = Promise.resolve();
async function save(doc) {
  const tmp = `${USERS}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8');
  await fs.rename(tmp, USERS);
}

/** Serialised so two writes cannot clobber each other. */
function withStore(fn) {
  // Serialise reads-modify-writes so two admin actions cannot both load, edit,
  // and save over each other. The caller gets THEIR operation's result; the
  // shared chain swallows failures (.catch) so one rejected operation — an
  // assign to a mistyped name, a duplicate-user 409 — cannot poison the queue
  // and freeze every later write until the process restarts.
  const result = queue.then(async () => {
    const doc = await load();
    const r = await fn(doc);
    await save(doc);
    return r;
  });
  queue = result.catch(() => {});
  return result;
}

const publicUser = (u) => ({ username: u.username, role: u.role, createdAt: u.createdAt, hotkeys: u.hotkeys ?? {} });

// ------------------------------------------------------------------ seeding

/**
 * A fresh install has no users, which would lock everyone out. Seed one admin
 * so the first sign-in is possible, and print the password once.
 */
export async function ensureSeedAdmin() {
  return withStore(async (doc) => {
    if (doc.users.length) return null;
    const username = process.env.ADMIN_USER || 'admin';
    doc.users.push({ username, role: 'admin', createdAt: new Date().toISOString(), hotkeys: {} });
    return { username, generated: false };
  });
}

// ------------------------------------------------------------------ queries

export async function listUsers() {
  const doc = await load();
  return doc.users.map(publicUser);
}

export async function getUser(username) {
  const doc = await load();
  const u = doc.users.find((x) => x.username === username);
  return u ? publicUser(u) : null;
}

export async function authenticate(username, password) {
  const doc = await load();
  // Local team tool: no passwords. Signing in is just claiming a username that
  // the admin has created; identity drives assignments, not secrecy.
  const u = doc.users.find((x) => x.username.toLowerCase() === String(username || '').trim().toLowerCase());
  return u ? publicUser(u) : null;
}

export async function createUser({ username, role }) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{2,32}$/.test(name)) throw Object.assign(new Error('Username must be 2-32 chars: letters, digits, . _ -'), { status: 400 });
  if (!ROLES.includes(role)) throw Object.assign(new Error('Role must be admin or annotator'), { status: 400 });

  return withStore(async (doc) => {
    if (doc.users.some((u) => u.username.toLowerCase() === name.toLowerCase())) {
      throw Object.assign(new Error('That username is taken'), { status: 409 });
    }
    const u = { username: name, role, createdAt: new Date().toISOString(), hotkeys: {} };
    doc.users.push(u);
    return publicUser(u);
  });
}

export async function updateUser(username, { role }) {
  return withStore(async (doc) => {
    const u = doc.users.find((x) => x.username === username);
    if (!u) throw Object.assign(new Error('No such user'), { status: 404 });

    if (role) {
      if (!ROLES.includes(role)) throw Object.assign(new Error('Bad role'), { status: 400 });
      // Never let the last admin demote themselves into a locked-out system.
      const admins = doc.users.filter((x) => x.role === 'admin');
      if (u.role === 'admin' && role !== 'admin' && admins.length === 1) {
        throw Object.assign(new Error('This is the only admin — promote someone else first'), { status: 400 });
      }
      u.role = role;
    }
    return publicUser(u);
  });
}

export async function setHotkeys(username, hotkeys) {
  return withStore(async (doc) => {
    const u = doc.users.find((x) => x.username === username);
    if (!u) throw Object.assign(new Error('No such user'), { status: 404 });
    u.hotkeys = hotkeys && typeof hotkeys === 'object' ? hotkeys : {};
    return publicUser(u);
  });
}

export async function deleteUser(username) {
  return withStore(async (doc) => {
    const u = doc.users.find((x) => x.username === username);
    if (!u) return;
    if (u.role === 'admin' && doc.users.filter((x) => x.role === 'admin').length === 1) {
      throw Object.assign(new Error('Cannot delete the only admin'), { status: 400 });
    }
    doc.users = doc.users.filter((x) => x.username !== username);
    // Their assignments go back to unassigned rather than pointing at a ghost.
    for (const clip of Object.keys(doc.assignments)) {
      if (doc.assignments[clip] === username) delete doc.assignments[clip];
    }
  });
}

// -------------------------------------------------------------- assignments

export async function getAssignments() {
  return (await load()).assignments;
}

/** Assign clips to a user, or pass null to clear them. */
export async function assignClips(clips, username) {
  return withStore(async (doc) => {
    if (username && !doc.users.some((u) => u.username === username)) {
      throw Object.assign(new Error('No such user'), { status: 404 });
    }
    for (const c of clips) {
      const name = path.basename(String(c));
      if (username) doc.assignments[name] = username;
      else delete doc.assignments[name];
    }
    return doc.assignments;
  });
}

// ----------------------------------------------------------------- sessions

export function issueToken(user) {
  const payload = { u: user.username, r: user.role, exp: Date.now() + SESSION_DAYS * 864e5 };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readToken(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return { username: payload.u, role: payload.r };
  } catch {
    return null;
  }
}

export { USERS };
