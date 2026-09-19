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

test('primaryArtists string, missing artist fallback, last-quality fallback, and seconds duration', () => {
  const named = normalizeSong({
    id: 'str',
    name: 'Named',
    primaryArtists: 'Solo',
    duration: '245',
    image: [{ quality: '150x150', url: 'https://img/150.jpg' }],
    downloadUrl: [{ quality: '160kbps', url: 'https://audio/160.mp4' }]
  }, 'Saavn');
  const unknown = normalizeSong({
    id: 'unk',
    name: 'No Artist',
    downloadUrl: [{ url: 'https://audio/song.mp4' }]
  }, 'Saavn');

  assert.equal(named?.artist, 'Solo');
  assert.equal(named?.duration, 245);
  assert.equal(named?.artwork, 'https://img/150.jpg');
  assert.equal(named?.streamUrl, '/api/stream/str');
  assert.equal(unknown?.artist, 'Unknown Artist');
});

test('hex apostrophe decoding is distinct from decimal', () => {
  const song = normalizeSong({
    id: 'hex',
    name: 'It&#x27;s Time',
    primaryArtists: 'A',
    downloadUrl: [{ quality: '320kbps', url: 'https://audio/320.mp4' }]
  }, 'Saavn');
  assert.equal(song?.title, "It's Time");
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
