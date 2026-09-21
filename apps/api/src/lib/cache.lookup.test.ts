import assert from 'node:assert/strict';
import test from 'node:test';

import { CACHE_MISS, cachedLookup, MemoryCacheStore } from './cache.js';

test('cachedLookup returns a hit without calling load', async () => {
  const cache = new MemoryCacheStore();
  await cache.set('k', { n: 1 }, 60);
  let loads = 0;
  const value = await cachedLookup(cache, {
    key: 'k',
    hitTtlSeconds: 60,
    load: async () => {
      loads += 1;
      return { n: 2 };
    }
  });
  assert.deepEqual(value, { n: 1 });
  assert.equal(loads, 0);
});

test('cachedLookup stores hits and negative misses', async () => {
  const cache = new MemoryCacheStore();
  let loads = 0;
  const first = await cachedLookup(cache, {
    key: 'miss',
    hitTtlSeconds: 60,
    missTtlSeconds: 30,
    load: async () => {
      loads += 1;
      return null;
    }
  });
  const second = await cachedLookup(cache, {
    key: 'miss',
    hitTtlSeconds: 60,
    missTtlSeconds: 30,
    load: async () => {
      loads += 1;
      return { n: 1 };
    }
  });
  assert.equal(first, null);
  assert.equal(second, null);
  assert.equal(loads, 1);
  assert.deepEqual(await cache.get('miss'), CACHE_MISS);
});

test('cachedLookup writes a hit after a successful load', async () => {
  const cache = new MemoryCacheStore();
  const value = await cachedLookup(cache, {
    key: 'hit',
    hitTtlSeconds: 60,
    load: async () => ({ ok: true })
  });
  assert.deepEqual(value, { ok: true });
  assert.deepEqual(await cache.get('hit'), { ok: true });
});
