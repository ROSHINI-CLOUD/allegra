import { ROFORMER_SAMPLE_RATE } from './config';
import type { StereoPcm } from './stft';

function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input.slice();
  const ratio = toRate / fromRate;
  const out = new Float32Array(Math.max(1, Math.round(input.length * ratio)));
  for (let i = 0; i < out.length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = src - i0;
    out[i] = (input[i0] ?? 0) * (1 - t) + (input[i1] ?? 0) * t;
  }
  return out;
}

/**
 * The model's input format: stereo at 44.1 kHz. Songs are decoded at that rate where the
 * browser allows it, so the linear resample is normally a plain copy.
 */
export function audioBufferToStereo44k(buffer: AudioBuffer): StereoPcm {
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  return {
    left: resampleLinear(left, buffer.sampleRate, ROFORMER_SAMPLE_RATE),
    right: resampleLinear(right, buffer.sampleRate, ROFORMER_SAMPLE_RATE)
  };
}

/** The model runs in a module worker; without one, karaoke uses the mid-side remover. */
export function isRoformerLikelySupported(): boolean {
  return typeof window !== 'undefined' && typeof Worker === 'function' && typeof fetch === 'function';
}
