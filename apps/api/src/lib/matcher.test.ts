import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreLyrics } from './matcher.js';

test('lyrics scoring prefers title match, synced lyrics, and close duration', () => {
  const high = scoreLyrics({
    trackName: 'Night Drive',
    syncedLyrics: '[00:01.00] go',
    duration: 200
  }, 'Night Drive', 200);
  const low = scoreLyrics({
    trackName: 'Other Song',
    plainLyrics: 'words',
    duration: 80
  }, 'Night Drive', 200);

  assert.equal(high.score, 60);
  assert.equal(high.reason, 'Title match • Synced • Exact duration');
  assert.ok(high.score > low.score);
});
