import { ROFORMER_CHUNK_SAMPLES, ROFORMER_SAMPLE_RATE } from './config';
import type { StereoPcm } from './stft';

/**
 * Streaming chunk layout. Chunks overlap only by a short crossfade instead of 2-4x, so
 * each second of audio goes through the model about once — the difference between
 * keeping ahead of playback and taking many minutes on a laptop GPU.
 *
 * Chunk k covers [k * HOP, k * HOP + CHUNK). Segment k is the playable span
 * [k * HOP, (k + 1) * HOP): its first FADE samples blend chunk k - 1's tail into
 * chunk k's head, the rest comes from chunk k alone.
 */
export const STREAM_FADE_SAMPLES = ROFORMER_SAMPLE_RATE; // 1 s
export const STREAM_HOP_SAMPLES = ROFORMER_CHUNK_SAMPLES - STREAM_FADE_SAMPLES;

export function streamChunkCount(totalSamples: number): number {
  return Math.max(1, Math.ceil(totalSamples / STREAM_HOP_SAMPLES));
}

export function chunkIndexAt(seconds: number, totalSamples: number): number {
  const sample = Math.max(0, Math.floor(seconds * ROFORMER_SAMPLE_RATE));
  return Math.min(streamChunkCount(totalSamples) - 1, Math.floor(sample / STREAM_HOP_SAMPLES));
}

/**
 * The chunk to separate first when the playhead has no instrumental yet, so that once
 * karaoke starts it stays on.
 *
 * Aim where the playhead will be when the chunk lands (`arriveAt`). The next chunk then
 * needs another `chunkSeconds`; if the playhead would leave the first one before that,
 * the original would come back for a moment between them. In that case start one chunk
 * later: karaoke begins a little later but never drops out.
 */
export function catchUpChunk(arriveAt: number, chunkSeconds: number, totalSamples: number): number {
  const hopSeconds = STREAM_HOP_SAMPLES / ROFORMER_SAMPLE_RATE;
  const k = chunkIndexAt(arriveAt, totalSamples);
  const offset = arriveAt - k * hopSeconds;
  const last = streamChunkCount(totalSamples) - 1;
  return offset + chunkSeconds > hopSeconds ? Math.min(last, k + 1) : k;
}

/** Input for chunk k, zero-padded past the end of the song. */
export function sliceChunk(mix: StereoPcm, index: number): StereoPcm {
  const start = index * STREAM_HOP_SAMPLES;
  const left = new Float32Array(ROFORMER_CHUNK_SAMPLES);
  const right = new Float32Array(ROFORMER_CHUNK_SAMPLES);
  left.set(mix.left.subarray(start, start + ROFORMER_CHUNK_SAMPLES));
  right.set(mix.right.subarray(start, start + ROFORMER_CHUNK_SAMPLES));
  return { left, right };
}

/** Chunk k's last FADE samples: all segment k + 1 needs from it once segment k is built. */
export function chunkTail(chunk: StereoPcm): StereoPcm {
  const end = STREAM_HOP_SAMPLES + STREAM_FADE_SAMPLES;
  return {
    left: chunk.left.slice(STREAM_HOP_SAMPLES, end),
    right: chunk.right.slice(STREAM_HOP_SAMPLES, end)
  };
}

/**
 * Blend the previous chunk's tail into a segment's head, in place. The head must still
 * be chunk k's raw output. Raised cosine: the weights sum to 1, right for two estimates
 * of the same audio.
 */
export function crossfadeHead(segment: StereoPcm, prevTail: StereoPcm): void {
  const fade = Math.min(STREAM_FADE_SAMPLES, segment.left.length, prevTail.left.length);
  for (let j = 0; j < fade; j++) {
    const r = 0.5 - 0.5 * Math.cos((Math.PI * (j + 0.5)) / STREAM_FADE_SAMPLES);
    segment.left[j] = (prevTail.left[j] ?? 0) * (1 - r) + (segment.left[j] ?? 0) * r;
    segment.right[j] = (prevTail.right[j] ?? 0) * (1 - r) + (segment.right[j] ?? 0) * r;
  }
}

/**
 * Playable audio for segment k. `prevTail` is chunk k - 1's tail when it exists; without
 * it (first chunk, or the first chunk processed after a seek) chunk k's head is used as
 * is, and can be blended later with `crossfadeHead`.
 */
export function assembleSegment(
  index: number,
  totalSamples: number,
  current: StereoPcm,
  prevTail: StereoPcm | null
): StereoPcm {
  const start = index * STREAM_HOP_SAMPLES;
  const length = Math.max(0, Math.min(STREAM_HOP_SAMPLES, totalSamples - start));
  const segment = { left: current.left.slice(0, length), right: current.right.slice(0, length) };
  if (prevTail && index > 0) crossfadeHead(segment, prevTail);
  return segment;
}
