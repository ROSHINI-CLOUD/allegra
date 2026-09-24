import type { StereoPcm } from './stft';

/**
 * `a − b` sample by sample over `length` samples; a missing sample counts as silence.
 * The model estimates vocals, so instrumental = mix − vocals, and the vocal stem the
 * listener hears is mix − instrumental. Deriving each from the other keeps
 * vocals + instrumental equal to the mix, so both sliders up is the original song.
 */
export function subtractStereo(
  a: StereoPcm,
  b: StereoPcm,
  length = Math.min(a.left.length, a.right.length)
): StereoPcm {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    left[i] = (a.left[i] ?? 0) - (b.left[i] ?? 0);
    right[i] = (a.right[i] ?? 0) - (b.right[i] ?? 0);
  }
  return { left, right };
}
