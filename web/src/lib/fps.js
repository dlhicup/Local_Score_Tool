/**
 * Frame-rate handling — there are TWO clocks here, and conflating them is the
 * classic way to produce ground truth that lines up with nothing.
 *
 * 1. THE REPORTING CLOCK (fixed, 25 fps). Score's ground truth speaks in frame
 *    numbers on a 25 fps clock: frame 504 means 20.16 seconds. Every frame
 *    number written to a GT file is `seconds * 25`, whatever the source video
 *    actually runs at. A 30 s clip is always 750 reporting frames.
 *
 * 2. THE VIDEO'S OWN RATE (measured). Only used for stepping the player one
 *    real frame at a time. It must never reach a GT file.
 *
 * Timestamps in seconds stay the internal source of truth. They are precise,
 * independent of both clocks, and converting at the edges means a correction
 * re-numbers events instead of corrupting them.
 */

/**
 * The reporting clock. Fixed by the scoring system, not by the footage.
 * A 30 s clip is 750 frames on this clock even if it was shot at 30 fps.
 */
export const REPORTING_FPS = 25;

export const DEFAULT_FPS = 25;

/**
 * Seconds -> reporting frame number. Always the 25 fps clock — never the
 * video's measured rate, or the numbers stop matching the scoring system.
 *
 * The toFixed(6) is not cosmetic. Many timestamps are not exactly representable
 * in float64, so a product that is mathematically x.5 can land a hair below it:
 * 17.9 * 25 evaluates to 447.49999999999994, which Math.round sends DOWN to 447
 * when the intended answer is 448. Collapsing that error first makes half-frame
 * boundaries round up as expected. Frame 0 is t = 0.
 */
export const toFrame = (seconds, fps = REPORTING_FPS) =>
  Math.max(0, Math.round(Number(((Number(seconds) || 0) * (fps || REPORTING_FPS)).toFixed(6))));

/** Reporting frame number -> the timestamp it denotes. */
export const toSeconds = (frame, fps = REPORTING_FPS) => (Number(frame) || 0) / (fps || REPORTING_FPS);

/** One frame in seconds — the unit for frame stepping and nudging. */
export const frameStep = (fps) => 1 / (fps || DEFAULT_FPS);
