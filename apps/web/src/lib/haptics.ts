/**
 * One short pulse on a confirmed action. Feature-detected, and silent wherever
 * the Vibration API is missing (every iOS browser) or the reader asked for less
 * motion. Never used for passive events, only for something the user did.
 */
export function tapHaptic(pattern: number = 10): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  navigator.vibrate(pattern);
}
