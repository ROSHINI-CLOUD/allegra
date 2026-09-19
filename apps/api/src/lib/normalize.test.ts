import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeSong } from './normalize.js';

test('normalization decodes entities, supports array artists, selects quality, and parses counts', () => {
  const song = normalizeSong({
    id: 'abc',
    name: '&quot;Track&#39;s&#x20;Name&quot;',
    artists: { primary: [{ name: 'A &amp; B' }, { name: 'C' }] },
    playCount: '1,234,567 plays',
    duration: 240,
    image: [
      { quality: '150x150', url: 'https://img/150.jpg' },
      { quality: '500x500', url: 'https://img/500.jpg' }
    ],
    downloadUrl: [
      { quality: '96kbps', url: 'https://audio/96.mp4' },
      { quality: '320kbps', url: 'https://audio/320.mp4' }
    ]
  }, 'Saavn');

  assert.deepEqual(song, {
    id: 'abc',
    title: '"Track\'s Name"',
    artist: 'A & B, C',
    artwork: 'https://img/500.jpg',
    streamUrl: '/api/stream/abc',
    duration: 240,
    hasLyrics: false,
    playCount: 1_234_567,
    source: 'Saavn'
  });
});

test('Gaana play counts are always zero and songs without audio are dropped', () => {
  const song = normalizeSong({
    id: 'gaana',
    name: 'Gaana song',
    primaryArtists: 'Artist',
    playCount: 99_999,
    downloadUrl: [{ quality: '160kbps', url: 'https://audio/song.mp4' }]
  }, 'Gaana');
  const missingAudio = normalizeSong({ id: 'missing', name: 'Missing' }, 'Saavn');

  assert.equal(song?.playCount, 0);
  assert.equal(missingAudio, null);
});
