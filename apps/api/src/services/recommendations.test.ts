import assert from 'node:assert/strict';
import test from 'node:test';

import { AiClient } from '../ai/aiClient.js';
import type { AiProvider } from '../ai/types.js';
import { RecommendationService, type SongSearcher } from './recommendations.js';
import type { UnifiedSong } from '../types.js';

function song(id: string): UnifiedSong {
  return { id, title: id, artist: 'Someone', artwork: '', streamUrl: '', duration: 180, hasLyrics: false, playCount: 0, source: 'Saavn' };
}

function fakeCatalog(byQuery: Record<string, UnifiedSong[]>): SongSearcher {
  return {
    async search(query) {
      return { results: byQuery[query] ?? [] };
    }
  };
}

test('turns AI-suggested queries into deduplicated songs, excluding what the listener already has', async () => {
  const provider: AiProvider = {
    name: 'fake',
    async complete() { return JSON.stringify({ queries: ['lofi hindi', 'arijit singh'], reasoning: 'You like soft romantic tracks.' }); }
  };
  const catalog = fakeCatalog({
    'lofi hindi': [song('a'), song('b')],
    'arijit singh': [song('b'), song('c')] // b overlaps across queries
  });
  const service = new RecommendationService(new AiClient([provider]), catalog);

  const result = await service.recommend({ likedSongs: [{ title: 'Gehra Hua', artist: 'Arijit Singh' }], recentSongs: [] }, new Set(['already-liked-id']));
  assert.ok(result);
  assert.equal(result.provider, 'fake');
  assert.deepEqual(result.songs.map((s) => s.id), ['a', 'b', 'c']);
  assert.equal(result.reasoning, 'You like soft romantic tracks.');
});

test('excludeIds actually excludes songs the listener already liked or played', async () => {
  const provider: AiProvider = { name: 'fake', async complete() { return JSON.stringify({ queries: ['x'] }); } };
  const catalog = fakeCatalog({ x: [song('already-liked-id'), song('new-one')] });
  const service = new RecommendationService(new AiClient([provider]), catalog);

  const result = await service.recommend({ likedSongs: [{ title: 'T', artist: 'A' }], recentSongs: [] }, new Set(['already-liked-id']));
  assert.deepEqual(result?.songs.map((s) => s.id), ['new-one']);
});

test('no listening history at all skips the AI call entirely and returns null', async () => {
  let called = false;
  const provider: AiProvider = { name: 'fake', async complete() { called = true; return '{}'; } };
  const service = new RecommendationService(new AiClient([provider]), fakeCatalog({}));

  assert.equal(await service.recommend({ likedSongs: [], recentSongs: [] }, new Set()), null);
  assert.equal(called, false);
});

test('a malformed AI response (no queries array) returns null instead of throwing', async () => {
  const provider: AiProvider = { name: 'fake', async complete() { return 'not json at all'; } };
  const service = new RecommendationService(new AiClient([provider]), fakeCatalog({}));
  assert.equal(await service.recommend({ likedSongs: [{ title: 'T', artist: 'A' }], recentSongs: [] }, new Set()), null);
});

test('queries delivered as one comma-separated string are still used', async () => {
  // NVIDIA's Llama answers this prompt with a string rather than the array the
  // prompt asks for. Reading only the array shape lost every one of its answers.
  const provider: AiProvider = {
    name: 'fake',
    async complete() { return JSON.stringify({ queries: 'lofi hindi, arijit singh', reasoning: 'Soft romantic tracks.' }); }
  };
  const catalog = fakeCatalog({ 'lofi hindi': [song('a')], 'arijit singh': [song('b')] });
  const service = new RecommendationService(new AiClient([provider]), catalog);

  const result = await service.recommend({ likedSongs: [{ title: 'T', artist: 'A' }], recentSongs: [] }, new Set());
  assert.deepEqual(result?.songs.map((s) => s.id), ['a', 'b']);
});

test('a queries value that is neither array nor string returns null rather than throwing', async () => {
  const provider: AiProvider = {
    name: 'fake',
    async complete() { return JSON.stringify({ queries: { calm: 'lofi', upbeat: 'party' } }); }
  };
  const service = new RecommendationService(new AiClient([provider]), fakeCatalog({}));
  assert.equal(await service.recommend({ likedSongs: [{ title: 'T', artist: 'A' }], recentSongs: [] }, new Set()), null);
});

test('a song the listener already liked is not recommended back under another release id', async () => {
  const provider: AiProvider = { name: 'fake', async complete() { return JSON.stringify({ queries: ['x'] }); } };
  const alreadyLiked = { ...song('liked-id'), title: 'Raga of Revenge', artist: 'Anirudh Ravichander' };
  const rerelease = { ...song('other-id'), title: 'Raga of Revenge (From "DC")', artist: 'Anirudh Ravichander' };
  const catalog = fakeCatalog({ x: [rerelease, song('fresh')] });
  const service = new RecommendationService(new AiClient([provider]), catalog);

  const result = await service.recommend(
    { likedSongs: [{ title: 'Raga of Revenge', artist: 'Anirudh Ravichander' }], recentSongs: [] },
    new Set(['liked-id']),
    [alreadyLiked]
  );
  assert.deepEqual(result?.songs.map((s) => s.id), ['fresh']);
});

test('the same recording returned under two release ids only appears once', async () => {
  const provider: AiProvider = { name: 'fake', async complete() { return JSON.stringify({ queries: ['one', 'two'] }); } };
  const rerelease = { ...song('id-2'), title: 'Zaalima (From "Raees")', artist: 'Harshdeep Kaur, Arijit Singh' };
  const original = { ...song('id-1'), title: 'Zaalima', artist: 'Arijit Singh, Harshdeep Kaur' };
  const catalog = fakeCatalog({ one: [original], two: [rerelease] });
  const service = new RecommendationService(new AiClient([provider]), catalog);

  const result = await service.recommend({ likedSongs: [{ title: 'T', artist: 'A' }], recentSongs: [] }, new Set());
  assert.deepEqual(result?.songs.map((s) => s.id), ['id-1']);
});
