/**
 * A direct handle on the playing <video> element.
 *
 * Scrubbing has to reach the decoder on every pointer move. Routing that
 * through React state means a full re-render before the picture can change,
 * which is what made the video appear to catch up only once the mouse stopped.
 * The timeline writes here instead, and the store is updated separately so the
 * playhead and readouts still follow.
 */
let el = null;

export const setVideoEl = (node) => {
  el = node;
};

export const getVideoEl = () => el;

/**
 * Seek as cheaply as the browser allows.
 *
 * fastSeek lands on the nearest keyframe without waiting for an exact decode,
 * which is what keeps a drag fluid. `exact` forces the precise seek used when
 * the drag ends.
 */
export function seekVideo(t, { exact = false } = {}) {
  if (!el) return false;
  const time = Math.max(0, t);
  if (!exact && typeof el.fastSeek === 'function' && el.readyState >= 2) {
    el.fastSeek(time);
  } else {
    el.currentTime = time;
  }
  return true;
}
