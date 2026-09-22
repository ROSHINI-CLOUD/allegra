import type { StereoPcm } from './stft';

/** Hann-weighted overlap-add of stereo chunks into an accumulator. */
export function overlapAddStereo(
  destL: Float32Array,
  destR: Float32Array,
  weight: Float32Array,
  chunk: StereoPcm,
  offset: number
): void {
  const n = Math.min(chunk.left.length, chunk.right.length);
  const fade = makeHann(n);
  for (let i = 0; i < n; i++) {
    const di = offset + i;
    if (di < 0 || di >= destL.length) continue;
    const w = fade[i] ?? 0;
    destL[di] = (destL[di] ?? 0) + (chunk.left[i] ?? 0) * w;
    destR[di] = (destR[di] ?? 0) + (chunk.right[i] ?? 0) * w;
    weight[di] = (weight[di] ?? 0) + w;
  }
}

export function normalizeOverlap(
  destL: Float32Array,
  destR: Float32Array,
  weight: Float32Array
): void {
  for (let i = 0; i < destL.length; i++) {
    const w = weight[i] ?? 0;
    if (w > 1e-8) {
      destL[i] = (destL[i] ?? 0) / w;
      destR[i] = (destR[i] ?? 0) / w;
    }
  }
}

function makeHann(n: number): Float32Array {
  const w = new Float32Array(n);
  if (n <= 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

export function chunkOffsets(
  totalSamples: number,
  chunkSamples: number,
  overlap: number
): number[] {
  const hop = Math.max(1, Math.floor(chunkSamples / Math.max(1, overlap)));
  const offsets: number[] = [];
  for (let o = 0; o + chunkSamples <= totalSamples || offsets.length === 0; o += hop) {
    const start = Math.min(o, Math.max(0, totalSamples - chunkSamples));
    if (offsets.length && offsets[offsets.length - 1] === start) break;
    offsets.push(start);
    if (start + chunkSamples >= totalSamples) break;
  }
  return offsets;
}
