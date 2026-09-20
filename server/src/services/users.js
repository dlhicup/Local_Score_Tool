import { allAnnotators, setAnnotator, listClipNames } from './store.js';

/**
 * Annotators, derived rather than stored.
 *
 * There is no sign-in on this tool and never was any real account: everyone
 * who reaches the server has full access. What the studio actually needs is a
 * name against a clip, so that a reviewer can see whose work they are looking
 * at — and that name now lives in the clip's own ground-truth file, under
 * `annotator`.
 *
 * So the list of people is simply the set of names appearing across the
 * folder. Nothing is written to a user database, because there isn't one: a
 * name comes into existence the moment a clip is assigned to it, and goes when
 * its last clip is reassigned. That is what makes a folder of ground-truth
 * files self-describing — copy someone's file in and their name comes with it.
 */
export const ROLES = ['admin', 'annotator'];

/** The one implicit account. Everyone who reaches the server is this. */
const LOCAL = { username: 'local', role: 'admin', createdAt: null, hotkeys: {} };

/**
 * Everyone named by a clip, plus the local account. Ordered with the busiest
 * first, which is the order the assignment page wants anyway.
 */
export async function listUsers() {
  const byClip = await allAnnotators();
  const counts = {};
  for (const name of Object.values(byClip)) counts[name] = (counts[name] ?? 0) + 1;
  const people = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([username]) => ({ username, role: 'annotator', createdAt: null, hotkeys: {} }));
  return [LOCAL, ...people];
}

export async function getUser(username) {
  return (await listUsers()).find((u) => u.username === username) ?? null;
}

/** No passwords, no accounts — claiming a name is all signing in ever was. */
export async function authenticate(username) {
  const name = String(username || '').trim();
  return name ? { username: name, role: 'admin', createdAt: null, hotkeys: {} } : null;
}

/**
 * There is no user store to add to. A name becomes real when a clip is
 * assigned to it, so this just validates and hands the name back — the
 * assignment page then shows it with nothing against it yet.
 */
export async function createUser({ username, role }) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9._ -]{2,32}$/.test(name)) {
    throw Object.assign(new Error('Name must be 2-32 chars: letters, digits, spaces, . _ -'), { status: 400 });
  }
  if (role && !ROLES.includes(role)) throw Object.assign(new Error('Role must be admin or annotator'), { status: 400 });
  return { username: name, role: role ?? 'annotator', createdAt: null, hotkeys: {} };
}

/** Nothing to update: a name carries no state of its own. */
export async function updateUser(username) {
  return getUser(username);
}

/** Remove a name by releasing every clip that carries it. */
export async function deleteUser(username) {
  const byClip = await allAnnotators();
  for (const [clip, owner] of Object.entries(byClip)) {
    if (owner === username) await setAnnotator(clip, null);
  }
}

/**
 * Hotkeys are a per-person preference on a tool with no accounts, so they
 * belong in the browser, not on the server. The client keeps them; this
 * endpoint stays so an older page does not error, and reports them back.
 */
export async function setHotkeys(username, hotkeys) {
  return { username, role: 'admin', createdAt: null, hotkeys: hotkeys && typeof hotkeys === 'object' ? hotkeys : {} };
}

// ------------------------------------------------------------- assignments

export async function getAssignments() {
  return allAnnotators();
}

/** Assign clips to a name, or pass null to release them. */
export async function assignClips(clips, username) {
  const known = new Set(await listClipNames());
  for (const c of clips ?? []) {
    const name = String(c);
    if (known.has(name)) await setAnnotator(name, username || null);
  }
  return allAnnotators();
}

// ----------------------------------------------------------------- sessions
//
// Kept as no-ops: nothing reads a token (withUser hands every request the same
// local admin), and there is no secret to sign with now that data/ is gone.

export function issueToken(user) {
  return `local.${encodeURIComponent(user?.username ?? 'local')}`;
}

export function readToken() {
  return { username: 'local', role: 'admin' };
}

/** A fresh install needs no seeding: there is no store to seed. */
export async function ensureSeedAdmin() {
  return null;
}
