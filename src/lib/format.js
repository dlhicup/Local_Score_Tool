/** 74.28 -> "1:14.28" — the timecode analysts actually read. */
export function timecode(seconds, { ms = true } = {}) {
  if (!Number.isFinite(seconds)) return ms ? '--:--.--' : '--:--';
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.round((s - Math.floor(s)) * 100);
  const base = `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(sec).padStart(2, '0')}`;
  return ms ? `${sign}${base}.${String(Math.min(cs, 99)).padStart(2, '0')}` : `${sign}${base}`;
}

export function duration(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export const pct = (n) => `${Math.round((n ?? 0) * 100)}%`;

/**
 * Seconds to two decimals — the unit an annotator actually types and checks.
 * 4 fps sampling lands on quarters, so two places is exactly enough to be
 * unambiguous without implying precision the video cannot support.
 */
export const seconds2 = (t) => `${(Number(t) || 0).toFixed(2)}s`;

export function relativeTime(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}
