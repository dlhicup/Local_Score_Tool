#!/usr/bin/env node
/**
 * Set a password from the terminal, so nobody is ever locked out of the UI.
 *
 *   node server/scripts/set-password.mjs <username> <password> [role]
 *
 * Creates the account if it does not exist. Run it with the server stopped, or
 * restart afterwards — the store is read fresh on each request, so a running
 * server picks the change up immediately either way.
 */
import { createUser, updateUser, listUsers } from '../src/services/users.js';

const [, , username, password, role] = process.argv;

if (!username || !password) {
  const users = await listUsers();
  console.log('Usage: node server/scripts/set-password.mjs <username> <password> [admin|annotator]');
  console.log('');
  console.log(users.length ? 'Existing accounts:' : 'No accounts yet.');
  for (const u of users) console.log(`  ${u.username}  (${u.role})`);
  process.exit(1);
}

const existing = (await listUsers()).find((u) => u.username === username);

try {
  if (existing) {
    await updateUser(username, { password, role: role || undefined });
    console.log(`Password updated for "${username}" (${role || existing.role}).`);
  } else {
    await createUser({ username, password, role: role || 'admin' });
    console.log(`Created "${username}" as ${role || 'admin'}.`);
  }
} catch (err) {
  console.error('Failed:', err.message);
  process.exit(1);
}
