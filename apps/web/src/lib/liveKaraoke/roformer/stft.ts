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
 * Pack stereo STFT into model layout [1, 2050, T, 2] row-major:
 * index = ((f * T) + t) * 2 + c  where f in [0,2050), c in {0=real,1=imag}
 * f 0..1024 = left, 1025..2049 = right.
 */
export function encodeStftPacked(
  pcm: StereoPcm,
  frames = ROFORMER_FRAMES
): Float32Array {
  const nFft = ROFORMER_N_FFT;
  const hop = ROFORMER_HOP;
  const nFreq = ROFORMER_FREQ_BINS;
  const win = hannWindow(nFft);
  const out = new Float32Array(ROFORMER_PACKED_FREQ * frames * 2);
  const re = new Float32Array(nFft);
  const im = new Float32Array(nFft);

  const encodeChannel = (samples: Float32Array, freqOffset: number): void => {
    for (let t = 0; t < frames; t++) {
      const start = t * hop;
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < nFft; i++) {
        const s = samples[start + i] ?? 0;
        re[i] = s * (win[i] ?? 0);
      }
      fft(re, im);
      for (let f = 0; f < nFreq; f++) {
        const base = ((freqOffset + f) * frames + t) * 2;
        out[base] = re[f] ?? 0;
        out[base + 1] = im[f] ?? 0;
      }
    }
  };

  encodeChannel(pcm.left, 0);
  encodeChannel(pcm.right, nFreq);
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

export function decodeIstftPacked(
  packed: Float32Array,
  frames = ROFORMER_FRAMES
): StereoPcm {
  const nFft = ROFORMER_N_FFT;
  const hop = ROFORMER_HOP;
  const nFreq = ROFORMER_FREQ_BINS;
  const win = hannWindow(nFft);
  const outLen = (frames - 1) * hop + nFft;
  const left = new Float32Array(outLen);
  const right = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const re = new Float32Array(nFft);
  const im = new Float32Array(nFft);

  const decodeChannel = (freqOffset: number, dest: Float32Array): void => {
    for (let t = 0; t < frames; t++) {
      re.fill(0);
      im.fill(0);
      for (let f = 0; f < nFreq; f++) {
        const base = ((freqOffset + f) * frames + t) * 2;
        re[f] = packed[base] ?? 0;
        im[f] = packed[base + 1] ?? 0;
      }
      // Hermitian mirror for full FFT
      for (let f = 1; f < nFreq - 1; f++) {
        re[nFft - f] = re[f] ?? 0;
        im[nFft - f] = -((im[f] ?? 0));
      }
      ifft(re, im);
      const start = t * hop;
      for (let i = 0; i < nFft; i++) {
        const w = win[i] ?? 0;
        dest[start + i] = (dest[start + i] ?? 0) + (re[i] ?? 0) * w;
        norm[start + i] = (norm[start + i] ?? 0) + w * w;
      }
    }
  };

  decodeChannel(0, left);
  // Reset norm for right? Use shared window energy
  const normCopy = norm.slice(0);
  norm.fill(0);
  decodeChannel(nFreq, right);
  for (let i = 0; i < outLen; i++) {
    const nL = normCopy[i] ?? 0;
    const nR = norm[i] ?? 0;
    if (nL > 1e-8) left[i] = (left[i] ?? 0) / nL;
    if (nR > 1e-8) right[i] = (right[i] ?? 0) / nR;
  }
  return { left, right };
}

export function pcmLengthForFrames(frames = ROFORMER_FRAMES): number {
  return (frames - 1) * ROFORMER_HOP + ROFORMER_N_FFT;
}
