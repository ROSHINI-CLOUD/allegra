import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampLyricsOffset,
  DEFAULT_SETTINGS,
  MAX_LYRICS_OFFSETS,
  parseSettings,
  withLyricsOffset
} from './settings.ts';

test('nothing stored gives the defaults', () => {
  assert.deepEqual(parseSettings(null), DEFAULT_SETTINGS);
});

test('corrupt or non-object JSON gives the defaults', () => {
  assert.deepEqual(parseSettings('{not json'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('[1,2,3]'), DEFAULT_SETTINGS);
  assert.deepEqual(parseSettings('"light"'), DEFAULT_SETTINGS);
});

test('valid fields survive, invalid ones fall back one by one', () => {
  const parsed = parseSettings(
    JSON.stringify({
      theme: 'system',
      lyricsSize: 'huge',
      analytics: false,
      karaokeMode: 'ai-only',
      karaokeMix: { vocals: 0.4, instruments: 3 },
      animatedBackground: 'no',
      extra: 'dropped'
    })
  );
  assert.equal(parsed.theme, 'system');
  assert.equal(parsed.lyricsSize, DEFAULT_SETTINGS.lyricsSize);
  assert.equal(parsed.analytics, false);
  assert.equal(parsed.karaokeMode, DEFAULT_SETTINGS.karaokeMode);
  assert.deepEqual(parsed.karaokeMix, { vocals: 0.4, instruments: 1 });
  assert.equal(parsed.animatedBackground, true);
  assert.equal('extra' in parsed, false);
});

test('the old theme key is honoured only until settings are first saved', () => {
  assert.equal(parseSettings(null, 'light').theme, 'light');
  assert.equal(parseSettings(null, 'neon').theme, DEFAULT_SETTINGS.theme);
  assert.equal(parseSettings(JSON.stringify({ theme: 'dark' }), 'light').theme, 'dark');
});

test('lyric offsets clamp to ±5 s in 0.1 s steps', () => {
  assert.equal(clampLyricsOffset(0.26), 0.3);
  assert.equal(clampLyricsOffset(-12), -5);
  assert.equal(clampLyricsOffset(Number.POSITIVE_INFINITY), 0);
});

test('stored offsets drop zeros, non-numbers and out-of-range values', () => {
  const parsed = parseSettings(JSON.stringify({ lyricsOffsets: { a: 0, b: 'x', c: 9, d: -0.44 } }));
  assert.deepEqual(parsed.lyricsOffsets, { c: 5, d: -0.4 });
});

test('withLyricsOffset sets, clears at zero, and keeps the map bounded', () => {
  let map = withLyricsOffset({}, 'song', 1.24);
  assert.deepEqual(map, { song: 1.2 });
  map = withLyricsOffset(map, 'song', 0);
  assert.deepEqual(map, {});

  let full: Record<string, number> = {};
  for (let i = 0; i < MAX_LYRICS_OFFSETS + 5; i++) full = withLyricsOffset(full, `s${i}`, 0.5);
  assert.equal(Object.keys(full).length, MAX_LYRICS_OFFSETS);
  assert.equal('s0' in full, false, 'the oldest entries go first');
  assert.equal(`s${MAX_LYRICS_OFFSETS + 4}` in full, true);
});

test('re-setting a song moves it to the newest position', () => {
  let map: Record<string, number> = {};
  for (let i = 0; i < MAX_LYRICS_OFFSETS; i++) map = withLyricsOffset(map, `s${i}`, 0.5);
  map = withLyricsOffset(map, 's0', 1);
  map = withLyricsOffset(map, 'new', 1);
  assert.equal('s0' in map, true);
  assert.equal('s1' in map, false);
});
