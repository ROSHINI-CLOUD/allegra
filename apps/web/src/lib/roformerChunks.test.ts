import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assembleSegment,
  catchUpChunk,
  chunkIndexAt,
  chunkTail,
  crossfadeHead,
  sliceChunk,
  STREAM_FADE_SAMPLES,
  STREAM_HOP_SAMPLES,
  streamChunkCount
} from './liveKaraoke/roformer/chunks.ts';
import { ROFORMER_CHUNK_SAMPLES, ROFORMER_SAMPLE_RATE } from './liveKaraoke/roformer/config.ts';
import type { StereoPcm } from './liveKaraoke/roformer/stft.ts';

const TOTAL = STREAM_HOP_SAMPLES * 2 + 12_345;

function ramp(length: number): StereoPcm {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    left[i] = Math.sin(i * 0.001);
    right[i] = Math.cos(i * 0.0007);
  }
  return { left, right };
}

function concat(segments: StereoPcm[]): StereoPcm {
  const length = segments.reduce((n, s) => n + s.left.length, 0);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let at = 0;
  for (const s of segments) {
    left.set(s.left, at);
    right.set(s.right, at);
    at += s.left.length;
  }
  return { left, right };
}

function maxError(a: Float32Array, b: Float32Array): number {
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  return worst;
}

test('chunks cover the whole song, one hop apart', () => {
  const count = streamChunkCount(TOTAL);
  assert.equal(count, 3);
  assert.ok((count - 1) * STREAM_HOP_SAMPLES < TOTAL && TOTAL <= count * STREAM_HOP_SAMPLES);
  assert.equal(STREAM_HOP_SAMPLES + STREAM_FADE_SAMPLES, ROFORMER_CHUNK_SAMPLES);
});

test('chunkIndexAt maps seconds to chunks and clamps at both ends', () => {
  const hopSeconds = STREAM_HOP_SAMPLES / ROFORMER_SAMPLE_RATE;
  assert.equal(chunkIndexAt(-5, TOTAL), 0);
  assert.equal(chunkIndexAt(hopSeconds * 1.5, TOTAL), 1);
  assert.equal(chunkIndexAt(10_000, TOTAL), 2);
});

test('the last chunk is zero-padded past the end of the song', () => {
  const mix = ramp(TOTAL);
  const last = sliceChunk(mix, 2);
  assert.equal(last.left.length, ROFORMER_CHUNK_SAMPLES);
  assert.equal(last.left[0], mix.left[2 * STREAM_HOP_SAMPLES]);
  assert.equal(last.left[TOTAL - 2 * STREAM_HOP_SAMPLES], 0);
});

test('segments stitched in order reproduce the input exactly', () => {
  // An identity "model": each chunk's output is its input, so any seam error shows up.
  const mix = ramp(TOTAL);
  const chunks = [0, 1, 2].map((k) => sliceChunk(mix, k));
  const segments = chunks.map((chunk, k) =>
    assembleSegment(k, TOTAL, chunk, k > 0 ? chunkTail(chunks[k - 1]!) : null)
  );
  assert.equal(segments[2]!.left.length, TOTAL - 2 * STREAM_HOP_SAMPLES);
  const out = concat(segments);
  assert.equal(out.left.length, TOTAL);
  assert.ok(maxError(out.left, mix.left) < 1e-6);
  assert.ok(maxError(out.right, mix.right) < 1e-6);
});

test('a segment blended after its predecessor arrives matches in-order stitching', () => {
  // After a seek, chunk 2 is separated before chunk 1.
  const mix = ramp(TOTAL);
  const c1 = sliceChunk(mix, 1);
  const c2 = sliceChunk(mix, 2);
  const early = assembleSegment(2, TOTAL, c2, null);
  crossfadeHead(early, chunkTail(c1));
  const inOrder = assembleSegment(2, TOTAL, c2, chunkTail(c1));
  assert.ok(maxError(early.left, inOrder.left) < 1e-7);
  assert.ok(maxError(early.right, inOrder.right) < 1e-7);
});

test('the crossfade hides a discontinuity between two different estimates', () => {
  const length = ROFORMER_CHUNK_SAMPLES;
  const prev = { left: new Float32Array(length).fill(1), right: new Float32Array(length).fill(1) };
  const current = { left: new Float32Array(length), right: new Float32Array(length) };
  const seg = assembleSegment(1, STREAM_HOP_SAMPLES * 3, current, chunkTail(prev));
  // Starts at the previous estimate, ends at the current one, never steps.
  assert.ok((seg.left[0] ?? 0) > 0.999);
  assert.ok((seg.left[STREAM_FADE_SAMPLES - 1] ?? 1) < 0.001);
  for (let j = 1; j < STREAM_FADE_SAMPLES; j++) {
    assert.ok(Math.abs((seg.left[j] ?? 0) - (seg.left[j - 1] ?? 0)) < 0.001);
  }
});

test('after a press or seek, karaoke never drops back to the original once it starts', () => {
  // A worker that separates focus, focus + 1, ... back to back while the song plays on.
  const hop = STREAM_HOP_SAMPLES / ROFORMER_SAMPLE_RATE;
  const total = Math.round(300 * ROFORMER_SAMPLE_RATE);
  for (const chunkSeconds of [4, 6.5, 8, 9]) {
    for (let start = 0; start < 240; start += 0.25) {
      const focus = catchUpChunk(start + chunkSeconds + 1.5, chunkSeconds, total);
      const landsAt = (i: number): number => start + (i + 1) * chunkSeconds;
      // The first chunk lands before the playhead has left it...
      assert.ok(landsAt(0) < (focus + 1) * hop, `first chunk late: start ${start}, ${chunkSeconds}s`);
      // ...and every later one before the playhead reaches it.
      for (let i = 1; i < 4; i++) {
        assert.ok(landsAt(i) <= (focus + i) * hop, `gap at chunk ${focus + i}: start ${start}, ${chunkSeconds}s`);
      }
    }
  }
});

test('the dropout seen in testing: a chunk landing late in its span defers to the next', () => {
  // Pressed at 8.3 s, model ready 19 s later: aiming at 36.9 s landed chunk 3 with
  // 1.8 s of vocals before chunk 4 arrived. It now starts at chunk 4.
  const total = Math.round(262 * ROFORMER_SAMPLE_RATE);
  assert.equal(catchUpChunk(36.9, 6.5, total), 4);
  // Landing early in a chunk leaves time for the next one: keep it.
  assert.equal(catchUpChunk(31, 6.5, total), 3);
  // Never past the last chunk.
  assert.equal(catchUpChunk(261, 6.5, total), streamChunkCount(total) - 1);
});
