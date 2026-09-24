import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../lib/cache.js';
import type { UnifiedSong } from '../types.js';
import { RecommendationService, type RecommendationCatalog, type TasteContext } from './recommendations.js';

function song(id: string, title: string, artist: string, language = 'hindi', playCount = 1000): UnifiedSong {
  return { id, title, artist, artwork: '', streamUrl: `/api/stream/${id}`, duration: 200, hasLyrics: true, language, playCount, source: 'Saavn' };
}

interface Calls {
  suggestions: string[];
  artists: string[];
  searches: string[];
}

function fakeCatalog(data: {
  suggestions?: Record<string, UnifiedSong[]>;
  artists?: Record<string, UnifiedSong[]>;
  searches?: Record<string, UnifiedSong[]>;
  failArtist?: boolean;
}): { catalog: RecommendationCatalog; calls: Calls } {
  const calls: Calls = { suggestions: [], artists: [], searches: [] };
  const catalog: RecommendationCatalog = {
    getSuggestions: async (id) => {
      calls.suggestions.push(id);
      return data.suggestions?.[id] ?? [];
    },
    getArtist: async (name) => {
      calls.artists.push(name);
      if (data.failArtist) throw new Error('artist page timed out');
      return { songs: data.artists?.[name] ?? [] };
    },
    search: async (query) => {
      calls.searches.push(query);
      return { results: data.searches?.[query] ?? [] };
    }
  };
  return { catalog, calls };
}

const emptyTaste: TasteContext = { seeds: [], favoriteArtists: [], favoriteLanguages: [], languages: [] };

test('nothing to go on means no shelf, and no catalog calls', async () => {
  const { catalog, calls } = fakeCatalog({});
  const result = await new RecommendationService(catalog, new MemoryCacheStore()).recommend(emptyTaste, new Set());
  assert.equal(result, null);
  assert.deepEqual(calls, { suggestions: [], artists: [], searches: [] });
});

test('songs suggested by several things the listener played rank first', async () => {
  const a = song('a', 'Seed A', 'Arijit Singh');
  const b = song('b', 'Seed B', 'Shreya Ghoshal');
  const shared = song('s', 'Both Like This', 'Pritam');
  const onlyA = song('x', 'Only A', 'KK');
  const { catalog } = fakeCatalog({ suggestions: { a: [onlyA, shared], b: [shared] } });
  const result = await new RecommendationService(catalog, new MemoryCacheStore()).recommend({ ...emptyTaste, seeds: [a, b] }, new Set());
  assert.ok(result);
  assert.equal(result.songs[0]?.id, 's');
  assert.equal(result.provider, 'allegra');
  assert.match(result.reasoning, /Seed A/);
});

test('already heard songs are excluded, by id and by recording', async () => {
  const seed = song('seed', 'Seed', 'A');
  const heard = song('h1', 'Heard', 'B');
  const heardOtherRelease = song('h2', 'Heard', 'B');
  const fresh = song('f', 'Fresh', 'C');
  const { catalog } = fakeCatalog({ suggestions: { seed: [heardOtherRelease, fresh] } });
  const result = await new RecommendationService(catalog, new MemoryCacheStore()).recommend({ ...emptyTaste, seeds: [seed] }, new Set(['h1']), [heard]);
  assert.deepEqual(result?.songs.map((item) => item.id), ['f']);
});

test('the language setting is a hard filter everywhere', async () => {
  const seed = song('seed', 'Seed', 'A', 'hindi');
  const tamil = song('t', 'Tamil Song', 'Anirudh', 'tamil');
  const hindi = song('h', 'Hindi Song', 'Pritam', 'hindi');
  const unlabelled = { ...song('u', 'Unknown', 'X'), language: undefined } as unknown as UnifiedSong;
  const { catalog } = fakeCatalog({ suggestions: { seed: [hindi, tamil, unlabelled] } });
  const result = await new RecommendationService(catalog, new MemoryCacheStore()).recommend({ ...emptyTaste, seeds: [seed], languages: ['tamil'] }, new Set());
  assert.deepEqual(result?.songs.map((item) => item.id), ['t']);
});

test('favourite artists contribute their top songs, and a failing artist page does not sink the shelf', async () => {
  const { catalog: ok } = fakeCatalog({ artists: { 'Arijit Singh': [song('1', 'One', 'Arijit Singh'), song('2', 'Two', 'Arijit Singh')] } });
  const taste: TasteContext = { ...emptyTaste, favoriteArtists: [{ name: 'Arijit Singh', score: 5 }] };
  const result = await new RecommendationService(ok, new MemoryCacheStore()).recommend(taste, new Set());
  assert.deepEqual(result?.songs.map((item) => item.id).sort(), ['1', '2']);
  assert.match(result?.reasoning ?? '', /Arijit Singh/);

  const { catalog: failing } = fakeCatalog({ failArtist: true, searches: { 'top hindi songs': [song('p', 'Popular', 'Z')] } });
  const fallback = await new RecommendationService(failing, new MemoryCacheStore()).recommend({ ...taste, languages: ['hindi'] }, new Set());
  assert.deepEqual(fallback?.songs.map((item) => item.id), ['p']);
});

test('no artist takes more than two slots', async () => {
  const seed = song('seed', 'Seed', 'Seedy');
  const many = ['1', '2', '3', '4'].map((id) => song(id, `Song ${id}`, 'Same Artist'));
  const other = song('o', 'Other', 'Someone Else');
  const { catalog } = fakeCatalog({ suggestions: { seed: [...many, other] } });
  const result = await new RecommendationService(catalog, new MemoryCacheStore()).recommend({ ...emptyTaste, seeds: [seed] }, new Set());
  assert.equal(result?.songs.filter((item) => item.artist === 'Same Artist').length, 2);
  assert.ok(result?.songs.some((item) => item.id === 'o'));
});

test('only languages known: popular songs in those languages', async () => {
  const { catalog, calls } = fakeCatalog({ searches: { 'top tamil songs': [song('t1', 'Hit', 'Anirudh', 'tamil')] } });
  const result = await new RecommendationService(catalog, new MemoryCacheStore()).recommend({ ...emptyTaste, languages: ['tamil'] }, new Set());
  assert.deepEqual(result?.songs.map((item) => item.id), ['t1']);
  assert.deepEqual(calls.searches, ['top tamil songs']);
  assert.match(result?.reasoning ?? '', /Tamil/);
});

test('the pool is cached, and excludes still apply to a cached shelf', async () => {
  const seed = song('seed', 'Seed', 'A');
  const one = song('1', 'One', 'B');
  const two = song('2', 'Two', 'C');
  const { catalog, calls } = fakeCatalog({ suggestions: { seed: [one, two] } });
  const service = new RecommendationService(catalog, new MemoryCacheStore());
  const taste = { ...emptyTaste, seeds: [seed] };
  await service.recommend(taste, new Set());
  const second = await service.recommend(taste, new Set(['1']));
  assert.equal(calls.suggestions.length, 1);
  assert.deepEqual(second?.songs.map((item) => item.id), ['2']);
});
