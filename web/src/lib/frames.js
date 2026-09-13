/**
 * Browser-side frame sampling. There is no ffmpeg in the loop: we seek a hidden
 * <video> element to each timestamp and paint it into a canvas. That keeps the
 * source file on the analyst's machine and makes the whole pipeline installable
 * with nothing but `npm install`.
 */

/** Resolve once the element has actually painted the requested frame. */
function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      // rAF gives the compositor one tick to present the decoded frame before
      // we read it back; without it Safari can hand us the previous frame.
      requestAnimationFrame(() => resolve());
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Could not seek to ${time.toFixed(2)}s`));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out seeking to ${time.toFixed(2)}s`));
    }, 15000);

    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = Math.max(0, time);
  });
}

/** A detached decoder so sampling never disturbs the analyst's own playback. */
export function createSampler(src) {
  const video = document.createElement('video');
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';

  const ready = new Promise((resolve, reject) => {
    const done = () => resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    if (video.readyState >= 2) done();
    video.addEventListener('loadeddata', done, { once: true });
    video.addEventListener('error', () => reject(new Error('This file could not be decoded by the browser.')), {
      once: true,
    });
  });

  return { video, ready, destroy: () => { video.removeAttribute('src'); video.load(); } };
}

/**
 * Grab frames at the given timestamps as JPEG data URLs.
 * @param {HTMLVideoElement} video a sampler video, already loaded
 * @param {number[]} timestamps seconds
 */
export async function grabFrames(video, timestamps, { maxWidth = 640, quality = 0.62, signal, onFrame } = {}) {
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const scale = Math.min(1, maxWidth / vw);
  const w = Math.max(2, Math.round(vw * scale));
  const h = Math.max(2, Math.round(vh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });

  const frames = [];
  for (const t of timestamps) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const frame = { t: Number(t.toFixed(3)), dataUrl };
    frames.push(frame);
    onFrame?.(frame);
  }
  return frames;
}

/**
 * Split a video into overlapping analysis segments.
 *
 * Overlap is deliberate: an event landing on a segment boundary would otherwise
 * be cut in half across two prompts and missed by both. The duplicate detections
 * this creates are collapsed later by the dedupe pass.
 */
export function planSegments({ duration, segmentLength = 6, fps = 2, overlap = 1, start = 0, end = null }) {
  const stop = Math.min(end ?? duration, duration);
  const segments = [];
  const step = Math.max(0.5, segmentLength - overlap);

  for (let s = start; s < stop - 0.05; s += step) {
    const segEnd = Math.min(s + segmentLength, stop);
    const timestamps = [];
    const interval = 1 / fps;
    for (let t = s; t < segEnd - 1e-6; t += interval) {
      timestamps.push(Number(Math.min(t, stop - 0.02).toFixed(3)));
    }
    // Always include the closing instant so an event on the boundary is seen.
    const last = Number(Math.max(s, segEnd - 0.02).toFixed(3));
    if (timestamps[timestamps.length - 1] !== last) timestamps.push(last);

    if (timestamps.length) segments.push({ index: segments.length, start: s, end: segEnd, timestamps });
    if (segEnd >= stop) break;
  }
  return segments;
}

/**
 * Cost signal, so nobody starts a 90-minute run by accident.
 *
 * Image tokens scale with pixel AREA, not width — going 640 -> 960 is 2.25x the
 * tokens, not 1.5x. A flat per-tile figure understates a high-resolution run
 * badly, which is exactly the number a pilot budget decision rests on.
 */
export function estimateRun({ duration, segmentLength, fps, overlap, maxWidth = 640, aspect = 16 / 9 }) {
  const segments = planSegments({ duration: duration || 0, segmentLength, fps, overlap });
  const frames = segments.reduce((n, s) => n + s.timestamps.length, 0);

  const w = maxWidth;
  const h = Math.round(maxWidth / (aspect || 16 / 9));
  // ~1 token per 750px² is the going approximation across the major vision APIs.
  const tokensPerFrame = Math.round((w * h) / 750);

  const framesPerSecond =
    duration > 0 ? frames / duration : fps * (segmentLength / Math.max(0.5, segmentLength - overlap));

  // Per-clip figures drive the model cost comparison, so they are derived from
  // the same sampling plan rather than a separate rule of thumb.
  const framesPer30s = Math.round(framesPerSecond * 30);
  const segmentsPer30s = Math.max(1, Math.round(30 / Math.max(0.5, segmentLength - overlap)));

  return {
    segments: segments.length,
    frames,
    tokensPerFrame,
    approxImageTokens: frames * tokensPerFrame,
    // Pilots are planned in clips, not seconds.
    framesPer30s,
    segmentsPer30s,
    tokensPer30sClip: framesPer30s * tokensPerFrame,
    resolution: `${w}x${h}`,
  };
}
