import { RESIDUAL_DEFAULTS } from './config';
import type { StereoPcm } from './stft';

export function rmsStereo(pcm: StereoPcm): number {
  const n = Math.min(pcm.left.length, pcm.right.length);
  if (n === 0) return 0;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const l = pcm.left[i] ?? 0;
    const r = pcm.right[i] ?? 0;
    acc += l * l + r * r;
  }
  return Math.sqrt(acc / (2 * n));
}

export function residualRatio(instrumental: StereoPcm, residualVocals: StereoPcm): number {
  const i = rmsStereo(instrumental);
  const v = rmsStereo(residualVocals);
  return v / (i + RESIDUAL_DEFAULTS.epsilon);
}

/**
 * Soft residual vocal removal in the time domain (Phase 4 precursor).
 * Prefer spectral masks later; this is a gated waveform suppress for CLEAN mode.
 */
export function softSubtractResidual(
  instrumental: StereoPcm,
  residualVocals: StereoPcm,
  strength = RESIDUAL_DEFAULTS.suppressionStrength
): StereoPcm {
  const n = Math.min(
    instrumental.left.length,
    instrumental.right.length,
    residualVocals.left.length,
    residualVocals.right.length
  );
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const s = Math.max(0, Math.min(1, strength));
  for (let i = 0; i < n; i++) {
    left[i] = (instrumental.left[i] ?? 0) - (residualVocals.left[i] ?? 0) * s;
    right[i] = (instrumental.right[i] ?? 0) - (residualVocals.right[i] ?? 0) * s;
  }
  return { left, right };
}
