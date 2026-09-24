import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedSong } from '../types.js';
import type { RelatedSongSource } from './recommendations.js';
import { MemoryRelationStore, SongRelations, type RelationCatalog, type RelationStore, type SongRelation } from './songRelations.js';

function song(id: string, title = `Song ${id}`, artist = `Artist ${id}`): UnifiedSong {
  return { id, title, artist, artwork: '', streamUrl: `/api/stream/${id}`, duration: 200, hasLyrics: false, playCount: 1, source: 'Saavn' };
}

const NOW = new Date(Date.UTC(2026, 8, 24));

function catalog(suggestions: Record<string, UnifiedSong[]>): { catalog: RelationCatalog; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    catalog: {
      getSuggestions: async (id) => {
        calls.push(id);
        return suggestions[id] ?? [];
      }
    }
  };
}

test('radio and suggestions merge; a song both name ranks first, and the seed never relates to itself', async () => {
  const seed = song('seed');
  const { catalog: fake } = catalog({ seed: [song('s1'), song('both'), { ...song('seed-again'), title: seed.title, artist: seed.artist }] });
  const radio: RelatedSongSource = { related: async () => [song('r1'), song('both')] };
  const store = new MemoryRelationStore();
  const related = await new SongRelations(fake, store, radio).forSeeds([seed], NOW);
  assert.deepEqual(related.get('seed')?.map((item) => item.id), ['both', 'r1', 's1']);
  assert.deepEqual((await store.getMany(['seed'])).get('seed')?.songs.map((item) => item.id), ['both', 'r1', 's1']);
});

test('stored relations are reused with no provider calls', async () => {
  const store = new MemoryRelationStore();
  await store.put({ songId: 'seed', songs: [song('kept')], updatedAt: NOW.toISOString() });
  const { catalog: fake, calls } = catalog({});
  const related = await new SongRelations(fake, store).forSeeds([song('seed')], NOW);
  assert.deepEqual(related.get('seed')?.map((item) => item.id), ['kept']);
  assert.deepEqual(calls, []);
});

test('only a few missing seeds are worked out per call, strongest first', async () => {
  const seeds = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => song(id));
  const { catalog: fake, calls } = catalog(Object.fromEntries(seeds.map((seed) => [seed.id, [song(`${seed.id}-next`)]])));
  const relations = new SongRelations(fake, new MemoryRelationStore(), undefined, { computePerCall: 2 });
  const first = await relations.forSeeds(seeds, NOW);
  assert.deepEqual([...first.keys()], ['a', 'b']);
  const second = await relations.forSeeds(seeds, NOW);
  assert.deepEqual([...second.keys()].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(calls, ['a', 'b', 'c', 'd']);
});

test('with the radio configured but silent, the catalog half is used now and retried later', async () => {
  const { catalog: fake, calls } = catalog({ seed: [song('s1')] });
  const store = new MemoryRelationStore();
  const relations = new SongRelations(fake, store, { related: async () => [] });
  assert.deepEqual((await relations.forSeeds([song('seed')], NOW)).get('seed')?.map((item) => item.id), ['s1']);
  assert.equal((await store.getMany(['seed'])).size, 0);
  await relations.forSeeds([song('seed')], NOW);
  assert.equal(calls.length, 2);
});

test('a stale relation is refreshed, and kept if the refresh comes back empty', async () => {
  const store = new MemoryRelationStore();
  const old = new Date(NOW.getTime() - 40 * 86_400_000).toISOString();
  await store.put({ songId: 'fresh-later', songs: [song('old')], updatedAt: old });
  await store.put({ songId: 'dead', songs: [song('old-dead')], updatedAt: old });
  const { catalog: fake } = catalog({ 'fresh-later': [song('new')] });
  const related = await new SongRelations(fake, store).forSeeds([song('fresh-later'), song('dead')], NOW);
  assert.deepEqual(related.get('fresh-later')?.map((item) => item.id), ['new']);
  assert.deepEqual(related.get('dead')?.map((item) => item.id), ['old-dead']);
});

test('a broken store never breaks the shelf', async () => {
  const broken: RelationStore = {
    getMany: async () => { throw new Error('convex down'); },
    put: async (_relation: SongRelation) => { throw new Error('convex down'); }
  };
  const { catalog: fake } = catalog({ seed: [song('s1')] });
  const related = await new SongRelations(fake, broken).forSeeds([song('seed')], NOW);
  assert.deepEqual(related.get('seed')?.map((item) => item.id), ['s1']);
});

test('stored rows drop nested variants', async () => {
  const store = new MemoryRelationStore();
  const withVariants = { ...song('v'), variants: [song('v2')] };
  const { catalog: fake } = catalog({ seed: [withVariants] });
  await new SongRelations(fake, store).forSeeds([song('seed')], NOW);
  const stored = (await store.getMany(['seed'])).get('seed')?.songs[0];
  assert.equal(stored?.id, 'v');
  assert.equal(stored && 'variants' in stored, false);
});
