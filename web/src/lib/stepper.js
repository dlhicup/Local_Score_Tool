import { getVideoEl } from './videoRef';
import { REPORTING_FPS } from './fps';

/**
 * Hold-to-step: move the picture one frame at a time, as fast as frames can
 * actually be shown, for as long as a key is held.
 *
 * The keyboard used to drive the seeks directly. OS key repeat fires about
 * thirty keydowns a second whatever the decoder is doing, and setting
 * currentTime on a <video> while an earlier seek is still in flight abandons
 * that earlier seek. Held for a second and a half, that gave 30 seeks started,
 * 1 finished, and nothing on screen until the key came up — the picture froze,
 * then jumped. Even when seeks did finish, two completing inside one vsync were
 * painted once.
 *
 * So the keyboard no longer seeks. A held key starts this stepper, which issues
 * one seek, waits until that frame has been *presented* — requestVideoFrameCallback
 * is the only signal that a frame reached the screen; `seeked` is the fallback —
 * and only then issues the next. Every frame shown is a real frame, the picture
 * keeps moving for as long as the key is held, and it stops on the last frame
 * shown: no backlog to drain, no overshoot after release.
 *
 * Frames are counted on the 25 fps reporting clock, the same grid the ground
 * truth is written on, so a step always lands exactly on a frame number.
 */

/** Never faster than this between steps. OS repeat is about this rate, so
 *  holding a key feels the way it always did — it just shows every frame. */
const MIN_INTERVAL_MS = 33;

/** A seek that has produced neither a frame nor `seeked` by then is treated as
 *  done, so a decoder stall cannot wedge the stepper with the key held. */
const STALL_MS = 400;

let held = null;      // { key, dir, frames } while a stepping key is down
let running = false;  // the loop is live
let busy = false;     // a seek is in flight and its frame not yet shown
let onMove = null;    // keeps the store's playhead in step with the element

const frameOf = (t) => Math.round(Number((Number(t || 0) * REPORTING_FPS).toFixed(6)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The store wants to know where the playhead went, and that playback stopped. */
export function setStepListener(fn) {
  onMove = typeof fn === 'function' ? fn : null;
}

/** Resolves once the element has shown a new frame, or clearly is not going to. */
function framePresented(el) {
  return new Promise((resolve) => {
    let done = false;
    let rvfc = 0;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('seeked', onSeeked);
      if (rvfc && typeof el.cancelVideoFrameCallback === 'function') el.cancelVideoFrameCallback(rvfc);
      clearTimeout(timer);
      resolve();
    };
    // `seeked` means the position is settled, not that it has been painted.
    // One animation frame later it has been, if it is going to be.
    const onSeeked = () => requestAnimationFrame(finish);
    if (typeof el.requestVideoFrameCallback === 'function') rvfc = el.requestVideoFrameCallback(finish);
    el.addEventListener('seeked', onSeeked, { once: true });
    timer = setTimeout(finish, STALL_MS);
  });
}

/**
 * One step: pause, compute the next frame on the reporting grid, seek, and
 * wait for it to be shown. Returns false at either end of the clip.
 */
async function stepOnce(dir, frames) {
  const el = getVideoEl();
  if (!el) return false;
  if (!el.paused) el.pause();
  const cur = frameOf(el.currentTime);
  const last = Number.isFinite(el.duration) ? frameOf(el.duration) : Infinity;
  const next = Math.max(0, Math.min(last, cur + dir * frames));
  if (next === cur) return false;
  const t = next / REPORTING_FPS;
  busy = true;
  try {
    const shown = framePresented(el);
    el.currentTime = t;
    onMove?.(t);
    await shown;
  } finally {
    busy = false;
  }
  return true;
}

async function run() {
  running = true;
  let lastAt = 0;
  try {
    while (held) {
      const since = performance.now() - lastAt;
      if (since < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - since);
      if (!held) break;
      lastAt = performance.now();
      const { dir, frames } = held;
      const moved = await stepOnce(dir, frames);
      if (!moved) break; // the start or the end of the clip
    }
  } finally {
    running = false;
  }
}

/**
 * A stepping key went down. Steps once at once, then keeps stepping until
 * stopStepping() for the same key. Pressing the other arrow while one is held
 * simply changes direction.
 */
export function startStepping(key, dir, { frames = 1 } = {}) {
  held = { key, dir: dir < 0 ? -1 : 1, frames: Math.max(1, Math.round(frames)) };
  if (!running) run();
}

/** The key came up — or focus left, which has to count as the same thing. */
export function stopStepping(key = null) {
  if (key !== null && held && held.key !== key) return; // a different key let go
  held = null;
}

/** A single step from a click. A click cannot queue behind one in flight. */
export function stepFrames(dir, frames = 1) {
  if (busy || running) return;
  stepOnce(dir < 0 ? -1 : 1, Math.max(1, Math.round(frames)));
}

export const isStepping = () => running;
