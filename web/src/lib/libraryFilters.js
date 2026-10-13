/**
 * The Library's filters and search, remembered for this tab.
 *
 * While the Library is open its filters live in its address, which is what
 * keeps them through a refresh or the browser's Back. This copy keeps them
 * through every other way back from a clip: the rail's Library link and the
 * logo go to `libraryPath()`, and a Library opened at a bare address takes
 * them from here.
 *
 * The page is deliberately not kept. Coming back from a clip starts at the
 * first page, which is where whatever is still to do is.
 *
 * sessionStorage, like the work queue: it belongs to this tab and survives a
 * refresh, while a second tab can keep filters of its own.
 */
const KEY = 'scoregt.library';

/** The address params that are filters. The search stays out of the address. */
export const FILTER_PARAMS = ['cat', 'st', 'rev'];

/** What was last set, as `{cat, st, rev, q}`; anything left at "all" is absent. */
export function recallLibraryFilters() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY));
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

export function rememberLibraryFilters({ cat, st, rev, q }) {
  const keep = {};
  for (const [k, v] of Object.entries({ cat, st, rev })) if (v && v !== 'all') keep[k] = v;
  if (q) keep.q = q;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(keep));
  } catch {
    /* storage blocked: the filters just don't carry over */
  }
}

/** On sign-out, so whoever signs in next in this tab starts with the full list. */
export function forgetLibraryFilters() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}

/** The Library's address with the filters it was left with, on its first page. */
export function libraryPath() {
  const saved = recallLibraryFilters();
  const params = new URLSearchParams();
  for (const k of FILTER_PARAMS) if (saved[k]) params.set(k, saved[k]);
  const search = params.toString();
  return search ? `/?${search}` : '/';
}
