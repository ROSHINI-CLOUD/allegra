import assert from 'node:assert/strict';
import test from 'node:test';

import { createDoubleTap, DEFAULT_KARAOKE_MIX, DOUBLE_TAP_MS, normalizeMix, type DoubleTapClock } from './karaokeMix.ts';
import { subtractStereo } from './liveKaraoke/roformer/stems.ts';
import type { StereoPcm } from './liveKaraoke/roformer/stft.ts';

test('normalizeMix clamps levels to 0–1 and defaults anything unusable', () => {
  assert.deepEqual(normalizeMix({ vocals: 1.7, instruments: -0.2 }), { vocals: 1, instruments: 0 });
  assert.deepEqual(normalizeMix({ vocals: 0.35, instruments: 0.8 }), { vocals: 0.35, instruments: 0.8 });
  assert.deepEqual(normalizeMix({ vocals: Number.NaN, instruments: '1' }), DEFAULT_KARAOKE_MIX);
  assert.deepEqual(normalizeMix(null), DEFAULT_KARAOKE_MIX);
  assert.deepEqual(normalizeMix('loud'), DEFAULT_KARAOKE_MIX);
});

test('the default mix is karaoke: no vocals, full instruments', () => {
  assert.deepEqual(DEFAULT_KARAOKE_MIX, { vocals: 0, instruments: 1 });
});

function noise(length: number, seed: number): StereoPcm {
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    left[i] = x / 2147483648 - 0.5;
    right[i] = ((x >> 3) % 1000) / 1000 - 0.5;
  }
  return { left, right };
}

test('vocals derived as mix − instrumental sum back to the mix', () => {
  const mix = noise(4096, 7);
  const instrumental = noise(4096, 91);
  const vocals = subtractStereo(mix, instrumental, instrumental.left.length);
  for (let i = 0; i < mix.left.length; i++) {
    assert.ok(Math.abs((vocals.left[i] ?? 0) + (instrumental.left[i] ?? 0) - (mix.left[i] ?? 0)) < 1e-6);
    assert.ok(Math.abs((vocals.right[i] ?? 0) + (instrumental.right[i] ?? 0) - (mix.right[i] ?? 0)) < 1e-6);
  }
});

test('subtractStereo treats samples past the end of an input as silence', () => {
  const a = { left: new Float32Array([1, 2, 3]), right: new Float32Array([1, 2, 3]) };
  const b = { left: new Float32Array([1]), right: new Float32Array([0.5]) };
  const out = subtractStereo(a, b, 4);
  assert.deepEqual([...out.left], [0, 2, 3, 0]);
  assert.deepEqual([...out.right], [0.5, 2, 3, 0]);
});

/** A clock the test moves by hand. */
function fakeClock(): DoubleTapClock & { advance: (ms: number) => void } {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimer: (run, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
    advance: (ms) => {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.run();
        }
      }
    }
  };
}

function harness(waits: boolean) {
  const clock = fakeClock();
  const calls: string[] = [];
  const gesture = createDoubleTap(
    { onSingle: () => calls.push('single'), onDouble: () => calls.push('double'), shouldWait: () => waits },
    clock
  );
  return { clock, calls, gesture };
}

test('karaoke off: a single tap toggles at once', () => {
  const { calls, gesture } = harness(false);
  gesture.tap();
  assert.deepEqual(calls, ['single']);
});

test('karaoke off: a double tap turns it on and opens the mix', () => {
  const { clock, calls, gesture } = harness(false);
  gesture.tap();
  clock.advance(DOUBLE_TAP_MS - 60);
  gesture.tap();
  assert.deepEqual(calls, ['single', 'double']);
});

test('karaoke on: a single tap waits out the double-tap window, then toggles', () => {
  const { clock, calls, gesture } = harness(true);
  gesture.tap();
  assert.deepEqual(calls, []);
  clock.advance(DOUBLE_TAP_MS);
  assert.deepEqual(calls, ['single']);
});

test('karaoke on: a double tap opens the mix and never turns karaoke off', () => {
  const { clock, calls, gesture } = harness(true);
  gesture.tap();
  clock.advance(DOUBLE_TAP_MS - 1);
  gesture.tap();
  clock.advance(DOUBLE_TAP_MS * 3);
  assert.deepEqual(calls, ['double']);
});

test('taps further apart than the window are two single taps', () => {
  const { clock, calls, gesture } = harness(false);
  gesture.tap();
  clock.advance(DOUBLE_TAP_MS + 1);
  gesture.tap();
  assert.deepEqual(calls, ['single', 'single']);
});

test('a third quick tap starts a fresh gesture rather than a second double', () => {
  const { clock, calls, gesture } = harness(false);
  gesture.tap();
  clock.advance(100);
  gesture.tap();
  clock.advance(100);
  gesture.tap();
  assert.deepEqual(calls, ['single', 'double', 'single']);
});

test('cancel drops a pending single tap', () => {
  const { clock, calls, gesture } = harness(true);
  gesture.tap();
  gesture.cancel();
  clock.advance(DOUBLE_TAP_MS * 2);
  assert.deepEqual(calls, []);
});
