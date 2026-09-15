import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Browser-safe proxies.
 *
 * Match footage from Veo (and most phones) is H.265/HEVC. Chrome and Edge on
 * Windows cannot decode HEVC, so the <video> element reads the container fine —
 * duration, timeline, playhead all work — but shows a black picture. The fix is
 * the same one the hosted platform uses: keep an H.264 proxy next to each clip
 * and serve that. This module builds those proxies with ffmpeg.
 *
 * A proxy is written to a temp name and renamed into place, so a file that
 * exists in the proxy folder is always complete and the video route can trust
 * its mere presence.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const VIDEO_DIR = path.resolve(ROOT, process.env.VIDEO_DIR || 'video');
const PROXY_DIR = path.resolve(ROOT, process.env.PROXY_DIR || 'video-proxy');
// ffmpeg is expected on PATH; FFMPEG_PATH overrides for an unusual install.
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

const VIDEO_RE = /\.(mp4|webm|mov|mkv|m4v)$/i;
const exists = (p) => fs.access(p).then(() => true, () => false);

/**
 * In-flight and failed encodes, keyed by clip filename. A finished proxy is not
 * tracked here — its existence on disk is the record. State is one of
 * 'encoding' | 'failed'; a clip absent from the map with no proxy is 'none'.
 */
const jobs = new Map();

/** Cached one-shot probe: is ffmpeg actually runnable on this host? */
let ffmpegProbe = null;
export function ffmpegAvailable() {
  if (!ffmpegProbe) {
    ffmpegProbe = new Promise((resolve) => {
      const p = spawn(FFMPEG, ['-version'], { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0));
    });
  }
  return ffmpegProbe;
}


// ---------------------------------------------------------------- playability

// ffprobe sits beside ffmpeg; follow FFMPEG_PATH if that was overridden.
const FFPROBE =
  process.env.FFPROBE_PATH ||
  (FFMPEG === 'ffmpeg' ? 'ffprobe' : path.join(path.dirname(FFMPEG), `ffprobe${path.extname(FFMPEG)}`));

/**
 * What a browser can actually decode. Anything outside these sets plays as a
 * black picture with a correct timeline, which is the bug annotators report.
 *
 * The pixel format matters as much as the codec: browsers decode 8-bit 4:2:0
 * only, so 10-bit or 4:2:2 H.264 — common from proper cameras — is just as
 * black as HEVC. The container matters too: Matroska and most .mov payloads
 * are not reliably supported even when the video stream inside is fine.
 */
const PLAYABLE_CONTAINER = /\.(mp4|m4v|webm)$/i;
const PLAYABLE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const PLAYABLE_PIXFMT = new Set(['yuv420p', 'yuvj420p']);
const PLAYABLE_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis']);

/** Keyed by name:size:mtime, so a probe is paid once per clip, not per listing. */
const probeCache = new Map();

function runFfprobe(file) {
  return new Promise((resolve) => {
    const args = ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,pix_fmt', '-of', 'json', file];
    const p = spawn(FFPROBE, args);
    let out = '';
    p.on('error', () => resolve(null)); // ffprobe not installed
    p.stdout.on('data', (d) => {
      out += d;
      if (out.length > 1_000_000) p.kill();
    });
    p.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

/**
 * Can the browser play this file exactly as it sits on disk?
 *
 * Returns true/false, or null when we cannot tell (no ffprobe). A null is
 * treated as "leave it alone": without ffprobe we cannot transcode either, so
 * guessing would only convert clips that were already fine.
 */
export async function isBrowserPlayable(name) {
  const file = path.join(VIDEO_DIR, path.basename(name));
  const stat = await fs.stat(file).catch(() => null);
  if (!stat) return null;

  const key = `${path.basename(name)}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
  if (probeCache.has(key)) return probeCache.get(key);

  let verdict;
  if (!PLAYABLE_CONTAINER.test(file)) {
    verdict = false; // .mkv / .mov: repackage even when the streams are fine
  } else {
    const info = await runFfprobe(file);
    if (!info) {
      verdict = null;
    } else {
      const streams = info.streams ?? [];
      const v = streams.find((s) => s.codec_type === 'video');
      const a = streams.find((s) => s.codec_type === 'audio');
      verdict = Boolean(
        v &&
          PLAYABLE_VIDEO.has(v.codec_name) &&
          PLAYABLE_PIXFMT.has(v.pix_fmt) &&
          (!a || PLAYABLE_AUDIO.has(a.codec_name)),
      );
    }
  }
  probeCache.set(key, verdict);
  return verdict;
}

function proxyPathFor(name) {
  const safe = path.basename(String(name || ''));
  if (!VIDEO_RE.test(safe)) return null;
  return path.join(PROXY_DIR, safe);
}

/** Parse ffmpeg's `HH:MM:SS.xx` timestamps into seconds. */
function hmsToSeconds(hms) {
  const m = /(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(hms);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * The actual encode. Resolves when the proxy is on disk, rejects on failure.
 * Reports 0..1 progress through `onProgress`. 720p H.264 + AAC, 8-bit yuv420p
 * for the widest decode support, faststart so the player can seek immediately.
 */
function runEncode(name, onProgress) {
  const proxyPath = proxyPathFor(name);
  if (!proxyPath) return Promise.reject(new Error('Not a video filename'));
  const input = path.join(VIDEO_DIR, path.basename(name));
  const tmp = `${proxyPath}.encoding`;

  return (async () => {
    await fs.mkdir(PROXY_DIR, { recursive: true });
    await fs.unlink(tmp).catch(() => {});

    await new Promise((resolve, reject) => {
      const args = [
        '-y',
        '-i', input,
        // Cap the long side at 720p (never upscale a smaller clip); keep width even.
        '-vf', 'scale=-2:min(720\\,ih)',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        '-f', 'mp4',
        tmp,
      ];
      const ff = spawn(FFMPEG, args);
      let total = 0;
      let stderr = '';
      ff.on('error', reject); // e.g. ffmpeg not installed
      ff.stderr.on('data', (chunk) => {
        const s = String(chunk);
        stderr += s;
        if (stderr.length > 8000) stderr = stderr.slice(-8000); // keep only the tail
        if (!total) {
          const d = /Duration:\s*(\d+:\d\d:\d\d\.\d+)/.exec(s);
          if (d) total = hmsToSeconds(d[1]) || 0;
        }
        const t = /time=(\d+:\d\d:\d\d\.\d+)/.exec(s);
        if (t && total) {
          const done = hmsToSeconds(t[1]) || 0;
          onProgress?.(Math.max(0, Math.min(1, done / total)));
        }
      });
      ff.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`));
      });
    });

    await fs.rename(tmp, proxyPath); // atomic: only a complete proxy ever appears
    onProgress?.(1);
  })().catch(async (err) => {
    await fs.unlink(tmp).catch(() => {});
    throw err;
  });
}

/**
 * The current playback state of a clip:
 *   ready       — an H.264 proxy exists; the video route serves it
 *   encoding    — a proxy is being built (with `pct`)
 *   failed      — the last encode failed (with `error`)
 *   unavailable — ffmpeg is not installed, so no proxy can be built
 *   none        — no proxy and no job; the original is served as-is
 */
export async function proxyState(name) {
  const proxyPath = proxyPathFor(name);
  if (!proxyPath) return { state: 'none' };
  if (await exists(proxyPath)) return { state: 'ready' };
  const job = jobs.get(path.basename(name));
  if (job) return { state: job.state, pct: job.pct ?? null, error: job.error ?? null };
  // No proxy and no job — so does this clip even need one?
  return { state: (await isBrowserPlayable(name)) === false ? 'needed' : 'none' };
}

/**
 * Make sure a browser-safe proxy exists for this clip, building one if needed.
 * Idempotent and non-blocking: it kicks the encode off in the background and
 * returns the state right away, so callers poll `proxyState` for progress. If
 * ffmpeg is missing it reports 'unavailable' and starts nothing.
 */
export async function ensureProxy(name) {
  const proxyPath = proxyPathFor(name);
  if (!proxyPath) return { state: 'none' };
  const key = path.basename(name);

  if (await exists(proxyPath)) return { state: 'ready' };
  const running = jobs.get(key);
  if (running?.state === 'encoding') return { state: 'encoding', pct: running.pct };

  // Already playable as it sits: serving the original is correct, and a
  // transcode would burn an hour of CPU on a clip that was never broken. A
  // null verdict (no ffprobe) counts as playable — without it we could not
  // transcode either, so guessing would only convert healthy clips.
  if ((await isBrowserPlayable(name)) !== false) return { state: 'none' };

  if (!(await ffmpegAvailable())) return { state: 'unavailable' };

  const job = { state: 'encoding', pct: 0, error: null };
  jobs.set(key, job);
  runEncode(name, (pct) => { job.pct = pct; })
    .then(() => { jobs.delete(key); })
    .catch((err) => {
      console.error(`proxy encode failed for ${key}:`, err.message);
      job.state = 'failed';
      job.error = err.message;
    });
  return { state: 'encoding', pct: 0 };
}

/** Build a proxy and wait for it — for the bulk script, not request handlers. */
export async function encodeProxyBlocking(name, onProgress) {
  const proxyPath = proxyPathFor(name);
  if (proxyPath && (await exists(proxyPath))) return 'ready';
  if (!(await ffmpegAvailable())) throw new Error('ffmpeg is not installed or not on PATH');
  await runEncode(name, onProgress);
  return 'encoded';
}

/** Drop a clip's proxy, called when the clip itself is removed. */
export async function removeProxy(name) {
  const proxyPath = proxyPathFor(name);
  if (proxyPath) await fs.unlink(proxyPath).catch(() => {});
  jobs.delete(path.basename(name));
}

export { PROXY_DIR };
