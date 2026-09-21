import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedSong } from '@shared/types';

import { shouldStartRadio, songIdentity, uniqueByIdentity } from './songIdentity.ts';

function song(id: string, title: string, artist: string, album = 'A'): UnifiedSong {
  return {
    id,
    title,
    artist,
    album,
    artwork: '',
    streamUrl: `/api/stream/${id}`,
    duration: 180,
    hasLyrics: false,
    playCount: 0,
    source: 'Saavn'
  };
}

test('songIdentity collapses film trailer and artist order differences', () => {
  const a = song('1', 'Kesariya (From "Brahmastra")', 'Arijit Singh, Amitabh Bhattacharya, Pritam');
  const b = song('2', 'Kesariya', 'Pritam, Arijit Singh, Amitabh Bhattacharya');
  assert.equal(songIdentity(a), songIdentity(b));
});

test('uniqueByIdentity keeps the first remaster only', () => {
  const list = [
    song('1', 'Kesariya (From "Brahmastra")', 'Arijit Singh, Pritam'),
    song('2', 'Kesariya', 'Pritam, Arijit Singh'),
    song('3', 'Chaleya', 'Arijit Singh, Anirudh Ravichander')
  ];
  assert.deepEqual(uniqueByIdentity(list).map((entry) => entry.id), ['1', '3']);
});

test('shouldStartRadio is true for remaster-heavy title search queues', () => {
  const seed = song('1', 'Kesariya (From "Brahmastra")', 'Arijit Singh, Pritam');
  const queue = [
    seed,
    song('2', 'Kesariya', 'Pritam, Arijit Singh', 'Hits'),
    song('3', 'Kesariya', 'Arijit Singh, Pritam', 'Tour'),
    song('4', 'Kesariya (Lofi Flip)', 'Arijit Singh, Pritam', 'Lofi')
  ];
  assert.equal(shouldStartRadio(seed, queue), true);
});

test('shouldStartRadio is false for diverse playlist-sized queues', () => {
  const seed = song('1', 'Kalank', 'Arijit Singh');
  const queue = [
    seed,
    song('2', 'Chaleya', 'Arijit Singh'),
    song('3', 'Heeriye', 'Arijit Singh'),
    song('4', 'Satranga', 'Arijit Singh'),
    song('5', 'Deva Deva', 'Arijit Singh'),
    song('6', 'Khairiyat', 'Arijit Singh'),
    song('7', 'Tum Hi Ho', 'Arijit Singh'),
    song('8', 'Gerua', 'Arijit Singh'),
    song('9', 'Janam Janam', 'Arijit Singh')
  ];
  assert.equal(shouldStartRadio(seed, queue), false);
});

test('shouldStartRadio is true when most hits share the seed title (remix variants)', () => {
  const seed = song('1', 'Kesariya (From "Brahmastra")', 'Arijit Singh, Pritam');
  const queue = [
    seed,
    song('2', 'Kesariya (Lofi Flip)', 'VIBIE, Arijit Singh, Pritam'),
    song('3', 'Kesariya (Dance Mix)', 'Pritam, Arijit Singh, Antara Mitra'),
    song('4', 'Kesariya (Remix)', 'Pritam, Arijit Singh, Dj Chetas'),
    song('5', 'Kesariya Rangu', 'Pritam, Sid Sriram')
  ];
  assert.equal(shouldStartRadio(seed, queue), true);
});
