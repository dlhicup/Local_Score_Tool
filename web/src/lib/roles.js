/**
 * Review admins: accounts promoted to admin so they can see and open every
 * clip for review, but who should NOT manage users or change passwords.
 *
 * The platform's real roles are only 'admin' and 'annotator', and a full admin
 * can reach every admin surface. Hiding the manager tools from these accounts
 * is a view-level restriction, not a server-enforced one — enforcing it would
 * take a dedicated reviewer role on the server. Listed by username until that
 * exists; a future `reviewAll` flag on the user record is honoured too.
 */
export const REVIEW_ADMINS = []; // add usernames here to make them review-only admins

export const isReviewAdmin = (user) =>
  Boolean(user && (user.reviewAll || REVIEW_ADMINS.includes(user.username)));

/** A full admin who may manage users (i.e. an admin who is not review-only). */
export const isManager = (user) => user?.role === 'admin' && !isReviewAdmin(user);
