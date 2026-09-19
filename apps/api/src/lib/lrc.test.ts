import assert from 'node:assert/strict';
import test from 'node:test';

import { parseLyrics } from './lrc.js';

test('LRC parser accepts dirty timestamps and emits instrumental lines', () => {
  const lines = parseLyrics('[0:3.75]Hello\n[01:05]   \n[00:10.25]World', 120);

  assert.deepEqual(lines, [
    { timestamp: 3.75, text: 'Hello', lineOrder: 0 },
    { timestamp: 10.25, text: 'World', lineOrder: 1 },
    { timestamp: 65, text: '[INSTRUMENTAL]', lineOrder: 2 }
  ]);
});

test('plain lyrics are interpolated across duration', () => {
  assert.deepEqual(parseLyrics('one\ntwo\nthree', 90), [
    { timestamp: 0, text: 'one', lineOrder: 0 },
    { timestamp: 30, text: 'two', lineOrder: 1 },
    { timestamp: 60, text: 'three', lineOrder: 2 }
  ]);
});
