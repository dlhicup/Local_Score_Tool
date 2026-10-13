import { api } from './api';

/**
 * The list of clips a person is working through.
 *
 * The Library decides it — whatever its filters show, in the order it shows
 * them — and the workspace walks it with Previous and Next. Filter to "30s
 * clips that need a first review", open one, and Next takes you to the next
 * one of those, not the next file on disk.
 *
 * Kept in sessionStorage: it belongs to this tab and survives a refresh, but a
 * second tab can work a different list. It is a snapshot taken when the clip
 * was opened, which is what a work queue should be — finishing a clip's review
 * moves it out of "needs 1st review", but Previous can still get back to it.
 */
const KEY = 'scoregt.queue';

/** Remember the list the Library is showing. */
export function saveQueue(videos, label = '') {
  try {
    const items = videos.map((v) => ({ name: v.name, n: v.project?.eventCount ?? 0 }));
    sessionStorage.setItem(KEY, JSON.stringify({ label, items }));
  } catch {
    /* storage blocked: Previous and Next fall back to every clip */
  }
}

export function loadQueue() {
  try {
    const q = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return q && Array.isArray(q.items) ? q : null;
  } catch {
    return null;
  }
}

/**
 * A workspace opened straight from a link has no Library list behind it. Every
 * clip, in the Library's own order, is the sensible default.
 */
export async function defaultQueue() {
  const { videos } = await api.listVideos();
  saveQueue(videos, 'All clips');
  return loadQueue();
}

/**
 * Where a clip sits in the list, and its neighbours. In review mode a clip with
 * nothing on it is skipped: there is nothing to review, and landing on it would
 * only mean pressing Next again.
 */
export function neighbours(queue, name, { skipEmpty = false } = {}) {
  const items = queue?.items ?? [];
  const index = items.findIndex((x) => x.name === name);
  const usable = (x) => x && (!skipEmpty || x.n > 0);
  let prev = null;
  let next = null;
  if (index !== -1) {
    for (let i = index - 1; i >= 0; i--) if (usable(items[i])) { prev = items[i]; break; }
    for (let i = index + 1; i < items.length; i++) if (usable(items[i])) { next = items[i]; break; }
  }
  return { index, total: items.length, prev, next, label: queue?.label ?? '' };
}
