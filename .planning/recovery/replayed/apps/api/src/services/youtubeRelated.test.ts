import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../lib/cache.js';
import type { YouTubeMusicTrack } from '../providers/youtubeMusic.js';
import type { UnifiedSong } from '../types.js';
import { YouTubeRelatedSource, type MatchCatalog, type RadioSource } from './youtubeRelated.js';

function song(id: string, title: string, artist: string, duration = 240): UnifiedSong {
  return { id, title, artist, artwork: '', streamUrl: `/api/stream/${id}`, duration, hasLyrics: false, language: 'hindi', playCount: 1, source: 'Saavn' };
}

const seed = song('seed', 'Tum Hi Ho', 'Arijit Singh, Mithoon');
const radio: YouTubeMusicTrack[] = [
  { videoId: 'v1', title: 'Janam Janam', artists: ['Arijit Singh'], duration: 239 },
  { videoId: 'v2', title: 'Sun Saathiya', artists: ['Priya Saraiya'], duration: 257 },
  { videoId: 'v3', title: 'Not On Saavn', artists: ['Nobody'], duration: 200 }
];

function fakes(options: { found?: boolean; failSearchFor?: string } = {}) {
  const calls = { find: [] as string[], radio: 0, search: [] as string[] };
  const youtube: RadioSource = {
    findSong: async (title, artist) => {
      calls.find.push(`${title}|${artist}`);
      return options.found === false ? null : { videoId: 'seedvid', title, artists: [artist] };
    },
    radio: async () => {
      calls.radio += 1;
      return radio;
    }
  };
  const rows: Record<string, UnifiedSong[]> = {
    'janam janam Arijit Singh': [song('j-cover', 'Janam Janam', 'Some Cover Band', 239), song('j', 'Janam Janam', 'Arijit Singh, Antara Mitra', 238)],
    'sun saathiya Priya Saraiya': [song('s-long', 'Sun Saathiya', 'Priya Saraiya', 400)]
  };
  const catalog: MatchCatalog = {
    search: async (query) => {
      calls.search.push(query);
      if (query === options.failSearchFor) throw new Error('saavn timed out');
      return { results: rows[query] ?? [] };
    }
  };
  return { youtube, catalog, calls };
}

test('the song radio comes back as catalog rows; anything without a confident match is dropped', async () => {
  const { youtube, catalog, calls } = fakes();
  const related = await new YouTubeRelatedSource(youtube, catalog, new MemoryCacheStore()).related(seed, 8);
  // Janam Janam matches by title and a shared artist (not the cover); Sun Saathiya's only
  // catalog row is 2.5 minutes too long to be the same recording; v3 is not in the catalog.
  assert.deepEqual(related.map((item) => item.id), ['j']);
  assert.deepEqual(calls.find, ['Tum Hi Ho|Arijit Singh']);
});

test('radio and matches are cached, so a second shelf makes no calls', async () => {
  const { youtube, catalog, calls } = fakes();
  const source = new YouTubeRelatedSource(youtube, catalog, new MemoryCacheStore());
  await source.related(seed, 8);
  const searches = calls.search.length;
  await source.related(seed, 8);
  assert.equal(calls.radio, 1);
  assert.equal(calls.find.length, 1);
  assert.equal(calls.search.length, searches);
});

test('a seed YouTube does not know yields nothing and no catalog searches', async () => {
  const { youtube, catalog, calls } = fakes({ found: false });
  assert.deepEqual(await new YouTubeRelatedSource(youtube, catalog, new MemoryCacheStore()).related(seed, 8), []);
  assert.equal(calls.radio, 0);
  assert.deepEqual(calls.search, []);
});

test('a catalog error drops that track without caching it as a miss', async () => {
  const { youtube, catalog, calls } = fakes({ failSearchFor: 'janam janam Arijit Singh' });
  const source = new YouTubeRelatedSource(youtube, catalog, new MemoryCacheStore());
  assert.deepEqual(await source.related(seed, 8), []);
  await source.related(seed, 8);
  assert.equal(calls.search.filter((query) => query === 'janam janam Arijit Singh').length, 2);
});

test('a slow provider is cut off at the budget', async () => {
  const youtube: RadioSource = { findSong: () => new Promise(() => undefined), radio: async () => [] };
  const started = Date.now();
  const related = await new YouTubeRelatedSource(youtube, { search: async () => ({ results: [] }) }, new MemoryCacheStore(), 50).related(seed, 8);
  assert.deepEqual(related, []);
  assert.ok(Date.now() - started < 1_000);
});
