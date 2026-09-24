import { fft, hannWindow, ifft } from './fft';
import {
  ROFORMER_FREQ_BINS,
  ROFORMER_FRAMES,
  ROFORMER_HOP,
  ROFORMER_N_FFT,
  ROFORMER_PACKED_FREQ
} from './config';

export interface StereoPcm {
  readonly left: Float32Array;
  readonly right: Float32Array;
}

/**
 * Mirrors torch.stft(center=True, pad_mode='reflect'): the signal is reflect-padded by n_fft/2
 * on both sides, so frame t is centred on sample t * hop.
 */
const HALF = ROFORMER_N_FFT / 2;

/** PCM samples covered by `frames` centred frames (the matching iSTFT `length`). */
export function pcmLengthForFrames(frames = ROFORMER_FRAMES): number {
  return (frames - 1) * ROFORMER_HOP;
}

/**
 * Index into the model layout [1, 2050, T, 2]. Stereo is interleaved per bin, exactly as
 * `rearrange(stft, 'b s f t c -> b (f s) t c')` in Mel-Band RoFormer: packed freq = f * 2 + channel.
 */
export function packedIndex(f: number, channel: number, t: number, frames: number): number {
  return ((f * 2 + channel) * frames + t) * 2;
}

function reflectIndex(k: number, length: number): number {
  if (length <= 1) return 0;
  let i = k;
  const period = 2 * (length - 1);
  i = ((i % period) + period) % period;
  return i < length ? i : period - i;
}

/** Reflect-pad by n_fft/2 each side over exactly `length` samples (zeros past the input end). */
function centerPad(samples: Float32Array, length: number): Float32Array {
  const src = new Float32Array(length);
  src.set(samples.subarray(0, Math.min(length, samples.length)));
  const out = new Float32Array(length + 2 * HALF);
  for (let i = 0; i < out.length; i++) {
    out[i] = src[reflectIndex(i - HALF, length)] ?? 0;
  }
  return out;
}

/** Stereo STFT packed into the model's [1, 2050, T, 2] row-major layout. */
export function encodeStftPacked(
  pcm: StereoPcm,
  frames = ROFORMER_FRAMES
): Float32Array {
  const nFft = ROFORMER_N_FFT;
  const hop = ROFORMER_HOP;
  const nFreq = ROFORMER_FREQ_BINS;
  const length = pcmLengthForFrames(frames);
  const win = hannWindow(nFft);
  const out = new Float32Array(ROFORMER_PACKED_FREQ * frames * 2);
  const re = new Float32Array(nFft);
  const im = new Float32Array(nFft);

  const encodeChannel = (samples: Float32Array, channel: number): void => {
    const padded = centerPad(samples, length);
    for (let t = 0; t < frames; t++) {
      const start = t * hop;
      im.fill(0);
      for (let i = 0; i < nFft; i++) {
        re[i] = (padded[start + i] ?? 0) * (win[i] ?? 0);
      }
      fft(re, im);
      for (let f = 0; f < nFreq; f++) {
        const base = packedIndex(f, channel, t, frames);
        out[base] = re[f] ?? 0;
        out[base + 1] = im[f] ?? 0;
      }
    }
  };

  encodeChannel(pcm.left, 0);
  encodeChannel(pcm.right, 1);
  return out;
}

/** Apply complex masks to packed STFT (in place or into dest). */
export function applyComplexMasks(
  stft: Float32Array,
  masks: Float32Array,
  dest?: Float32Array
): Float32Array {
  const out = dest ?? new Float32Array(stft.length);
  const n = Math.min(stft.length, masks.length);
  for (let i = 0; i < n; i += 2) {
    const sr = stft[i] ?? 0;
    const si = stft[i + 1] ?? 0;
    const mr = masks[i] ?? 0;
    const mi = masks[i + 1] ?? 0;
    // complex multiply
    out[i] = sr * mr - si * mi;
    out[i + 1] = sr * mi + si * mr;
  }
  return out;
}

/** Inverse of encodeStftPacked: windowed overlap-add, envelope-normalised, centre padding trimmed. */
export function decodeIstftPacked(
  packed: Float32Array,
  frames = ROFORMER_FRAMES
): StereoPcm {
  const nFft = ROFORMER_N_FFT;
  const hop = ROFORMER_HOP;
  const nFreq = ROFORMER_FREQ_BINS;
  const length = pcmLengthForFrames(frames);
  const win = hannWindow(nFft);
  const paddedLen = (frames - 1) * hop + nFft;
  const re = new Float32Array(nFft);
  const im = new Float32Array(nFft);

  const norm = new Float32Array(paddedLen);
  for (let t = 0; t < frames; t++) {
    const start = t * hop;
    for (let i = 0; i < nFft; i++) {
      const w = win[i] ?? 0;
      norm[start + i] = (norm[start + i] ?? 0) + w * w;
    }
  }

  const decodeChannel = (channel: number): Float32Array => {
    const acc = new Float32Array(paddedLen);
    for (let t = 0; t < frames; t++) {
      re.fill(0);
      im.fill(0);
      for (let f = 0; f < nFreq; f++) {
        const base = packedIndex(f, channel, t, frames);
        re[f] = packed[base] ?? 0;
        im[f] = packed[base + 1] ?? 0;
      }
      // Hermitian mirror for full FFT
      for (let f = 1; f < nFreq - 1; f++) {
        re[nFft - f] = re[f] ?? 0;
        im[nFft - f] = -(im[f] ?? 0);
      }
      ifft(re, im);
      const start = t * hop;
      for (let i = 0; i < nFft; i++) {
        acc[start + i] = (acc[start + i] ?? 0) + (re[i] ?? 0) * (win[i] ?? 0);
      }
    }
    const out = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const n = norm[i + HALF] ?? 0;
      out[i] = n > 1e-8 ? (acc[i + HALF] ?? 0) / n : 0;
    }
    return out;
  };

  return { left: decodeChannel(0), right: decodeChannel(1) };
}
