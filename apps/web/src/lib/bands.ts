/**
 * Turning a spectrum into something worth animating.
 *
 * Raw band levels are nearly useless on their own. Measured against a real mix, the bass band sits
 * around 0.8 and wanders by about four percent, so anything driven by it reads as "permanently
 * louder" rather than as a beat. What a listener sees is the *swing*, so each band is rescaled
 * against its own running floor and ceiling, then shaped by an envelope follower.
 *
 * Kept pure and free of Web Audio so it can be reasoned about — and checked — without a sound card.
 */

/** Three-way split of the spectrum, each 0..1. What a listener would call thump, body and air. */
export interface AudioBands {
  readonly bass: number;
  readonly mid: number;
  readonly treble: number;
}

interface Window {
  floor: number;
  ceiling: number;
}

interface Shape {
  /** How fast the value is allowed to rise. A kick should land on the frame it happens. */
  readonly attack: number;
  /** How fast it falls. Slower than the attack, so light decays instead of strobing. */
  readonly release: number;
}

const SHAPES: readonly Shape[] = [
  { attack: 0.5, release: 0.11 },
  { attack: 0.36, release: 0.14 },
  { attack: 0.3, release: 0.17 }
];

/** The window snaps outward to take in a new extreme at this rate. */
const EXPAND = 0.25;
/** …and creeps back in at this one, so a quiet passage regains its range and one loud bar cannot flatten the next minute. */
const CONTRACT = 0.004;
/** A floor under the range itself: near-silence must not be amplified into a light show. */
const MIN_SPAN = 0.06;

export interface BandTracker {
  /** Feeds one frame of raw band means (each 0..1) and returns the shaped, normalised bands. */
  readonly next: (bass: number, mid: number, treble: number) => AudioBands;
  /** Forgets the learned range. Call when the source changes so a new song is measured on its own terms. */
  readonly reset: () => void;
}

export function createBandTracker(): BandTracker {
  let windows: Window[] = [];
  let shaped = [0, 0, 0];

  const reset = (): void => {
    // Deliberately inverted: the first frames pull the floor down and the ceiling up to meet the
    // real signal, which takes about a quarter second and then tracks it.
    windows = [
      { floor: 1, ceiling: 0 },
      { floor: 1, ceiling: 0 },
      { floor: 1, ceiling: 0 }
    ];
    shaped = [0, 0, 0];
  };

  reset();

  const step = (index: number, value: number): number => {
    const window = windows[index];
    const shape = SHAPES[index];
    if (!window || !shape) return value;

    window.floor += (value - window.floor) * (value < window.floor ? EXPAND : CONTRACT);
    window.ceiling += (value - window.ceiling) * (value > window.ceiling ? EXPAND : CONTRACT);
    const span = Math.max(window.ceiling - window.floor, MIN_SPAN);
    const normalised = Math.min(1, Math.max(0, (value - window.floor) / span));

    const current = shaped[index] ?? 0;
    const rate = normalised > current ? shape.attack : shape.release;
    const next = current + (normalised - current) * rate;
    shaped[index] = next;
    return next;
  };

  return {
    next: (bass, mid, treble) => ({
      bass: step(0, bass),
      mid: step(1, mid),
      treble: step(2, treble)
    }),
    reset
  };
}
