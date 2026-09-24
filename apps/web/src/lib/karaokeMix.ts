/**
 * The karaoke mix: how loud each separated stem plays, 0–1. Vocals at 0 and instruments
 * at 1 is plain karaoke; both at 1 is the original song, because the stems sum to it.
 */
export interface KaraokeMix {
  readonly vocals: number;
  readonly instruments: number;
}

export const DEFAULT_KARAOKE_MIX: KaraokeMix = { vocals: 0, instruments: 1 };

function level(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

/** Any stored or partial value → a mix whose levels are finite and within 0–1. */
export function normalizeMix(value: unknown): KaraokeMix {
  if (typeof value !== 'object' || value === null) return DEFAULT_KARAOKE_MIX;
  const record = value as Record<string, unknown>;
  return {
    vocals: level(record.vocals, DEFAULT_KARAOKE_MIX.vocals),
    instruments: level(record.instruments, DEFAULT_KARAOKE_MIX.instruments)
  };
}

/** Two taps closer than this open the mix instead of toggling karaoke twice. */
export const DOUBLE_TAP_MS = 300;

export interface DoubleTapHandlers {
  readonly onSingle: () => void;
  readonly onDouble: () => void;
  /**
   * Whether a single tap waits to see if a second follows. Wait only when the single tap
   * would undo something (karaoke is on): turning it on stays instant, and a second tap
   * then opens the mix with karaoke already starting.
   */
  readonly shouldWait: () => boolean;
}

export interface DoubleTapClock {
  readonly now: () => number;
  readonly setTimer: (run: () => void, ms: number) => number;
  readonly clearTimer: (id: number) => void;
}

export interface DoubleTap {
  readonly tap: () => void;
  /** Drop a pending single tap, e.g. on unmount. */
  readonly cancel: () => void;
}

const browserClock: DoubleTapClock = {
  now: () => performance.now(),
  setTimer: (run, ms) => window.setTimeout(run, ms),
  clearTimer: (id) => window.clearTimeout(id)
};

/**
 * One tap handler shared by every Karaoke button. A second tap inside `DOUBLE_TAP_MS`
 * cancels the pending single tap, so a double tap on "Karaoke on" opens the mix rather
 * than turning karaoke off.
 */
export function createDoubleTap(handlers: DoubleTapHandlers, clock: DoubleTapClock = browserClock): DoubleTap {
  let lastTap: number | null = null;
  let pending: number | null = null;

  const cancel = (): void => {
    if (pending !== null) clock.clearTimer(pending);
    pending = null;
  };

  const tap = (): void => {
    const now = clock.now();
    if (lastTap !== null && now - lastTap < DOUBLE_TAP_MS) {
      cancel();
      lastTap = null;
      handlers.onDouble();
      return;
    }
    lastTap = now;
    cancel();
    if (!handlers.shouldWait()) {
      handlers.onSingle();
      return;
    }
    pending = clock.setTimer(() => {
      pending = null;
      handlers.onSingle();
    }, DOUBLE_TAP_MS);
  };

  return { tap, cancel };
}
