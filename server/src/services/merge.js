import { EVENT_LABELS } from '../labels.js';

/**
 * Segments overlap on purpose so an event near a boundary is seen twice. That
 * means the same real-world event can arrive from two calls; collapse those.
 *
 * Two events are the same occurrence when they share a type and sit within
 * `window` seconds of each other. We keep the higher-confidence copy and nudge
 * its timestamp toward the confidence-weighted mean of the duplicates.
 *
 * The window is deliberately under a second. Real football contains distinct
 * same-type events less than a second apart — a one-two is two passes roughly
 * 0.9s apart — and a wider window would fuse them into one, systematically
 * deleting rapid exchanges from the ground truth.
 */
export function dedupeEvents(events, window = 0.6) {
  const byType = new Map();
  for (const e of events) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type).push(e);
  }

  const out = [];
  for (const [, list] of byType) {
    list.sort((a, b) => a.timestamp - b.timestamp);
    let cluster = [];

    const flush = () => {
      if (!cluster.length) return;
      const best = cluster.reduce((a, b) => (b.confidence > a.confidence ? b : a));
      const wsum = cluster.reduce((s, e) => s + e.confidence, 0) || cluster.length;
      const t = cluster.reduce((s, e) => s + e.timestamp * (e.confidence || 1), 0) / wsum;
      out.push({
        ...best,
        timestamp: Number(t.toFixed(3)),
        // Agreement across overlapping segments is real evidence — reward it,
        // but never let a merge manufacture certainty above the best single call.
        confidence: Number(Math.min(1, best.confidence + 0.05 * (cluster.length - 1)).toFixed(3)),
        agreement: cluster.length,
      });
      cluster = [];
    };

    for (const e of list) {
      if (!cluster.length || e.timestamp - cluster[cluster.length - 1].timestamp <= window) {
        cluster.push(e);
      } else {
        flush();
        cluster.push(e);
      }
    }
    flush();
  }

  out.sort((a, b) => a.timestamp - b.timestamp || a.type.localeCompare(b.type));
  return out;
}

export function summarise(events) {
  const counts = Object.fromEntries(EVENT_LABELS.map((l) => [l, 0]));
  let confSum = 0;
  for (const e of events) {
    if (counts[e.type] !== undefined) counts[e.type] += 1;
    confSum += e.confidence ?? 0;
  }
  return {
    total: events.length,
    byType: counts,
    meanConfidence: events.length ? Number((confSum / events.length).toFixed(3)) : 0,
    lowConfidence: events.filter((e) => (e.confidence ?? 0) < 0.5).length,
  };
}
