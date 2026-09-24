import assert from 'node:assert/strict';
import test from 'node:test';

import { hannWindow } from './liveKaraoke/roformer/fft.ts';
import {
  applyComplexMasks,
  decodeIstftPacked,
  encodeStftPacked,
  packedIndex,
  pcmLengthForFrames
} from './liveKaraoke/roformer/stft.ts';

const FRAMES = 64;
const HOP = 441;
const BINS = 1025;

function noise(length: number, seed: number): Float32Array {
  const out = new Float32Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = s / 2 ** 32 - 0.5;
  }
  return out;
}

function frameEnergy(stft: Float32Array, channel: number, t: number): number {
  let e = 0;
  for (let f = 0; f < BINS; f++) {
    const i = packedIndex(f, channel, t, FRAMES);
    e += (stft[i] ?? 0) ** 2 + (stft[i + 1] ?? 0) ** 2;
  }
  return e;
}

test('hann window is periodic like torch.hann_window', () => {
  const w = hannWindow(2048);
  assert.equal(w[0], 0);
  assert.ok(Math.abs((w[1024] ?? 0) - 1) < 1e-6);
  assert.ok((w[2047] ?? 0) > 0);
});

test('stereo is interleaved per bin: packed freq = f * 2 + channel', () => {
  const length = pcmLengthForFrames(FRAMES);
  const stft = encodeStftPacked(
    { left: noise(length, 1), right: new Float32Array(length) },
    FRAMES
  );
  assert.equal(packedIndex(3, 1, 0, FRAMES), (3 * 2 + 1) * FRAMES * 2);
  for (let t = 0; t < FRAMES; t++) {
    assert.ok(frameEnergy(stft, 0, t) > 1);
    assert.equal(frameEnergy(stft, 1, t), 0);
  }
});

test('frames are centred: frame t peaks for an impulse at t * hop', () => {
  const length = pcmLengthForFrames(FRAMES);
  const left = new Float32Array(length);
  left[20 * HOP] = 1;
  const stft = encodeStftPacked({ left, right: new Float32Array(length) }, FRAMES);
  let best = 0;
  for (let t = 1; t < FRAMES; t++) {
    if (frameEnergy(stft, 0, t) > frameEnergy(stft, 0, best)) best = t;
  }
  assert.equal(best, 20);
});

test('identity mask reconstructs the input; zero mask gives silence', () => {
  const length = pcmLengthForFrames(FRAMES);
  const pcm = { left: noise(length, 7), right: noise(length, 11) };
  const stft = encodeStftPacked(pcm, FRAMES);

  const identity = new Float32Array(stft.length);
  for (let i = 0; i < identity.length; i += 2) identity[i] = 1;
  const back = decodeIstftPacked(applyComplexMasks(stft, identity), FRAMES);
  assert.equal(back.left.length, length);
  let maxErr = 0;
  for (let i = 0; i < length; i++) {
    maxErr = Math.max(
      maxErr,
      Math.abs((back.left[i] ?? 0) - (pcm.left[i] ?? 0)),
      Math.abs((back.right[i] ?? 0) - (pcm.right[i] ?? 0))
    );
  }
  assert.ok(maxErr < 1e-4, `max reconstruction error ${maxErr}`);

  const silent = decodeIstftPacked(
    applyComplexMasks(stft, new Float32Array(stft.length)),
    FRAMES
  );
  assert.ok(silent.left.every((v) => v === 0));
});
