import assert from 'node:assert/strict';
import test from 'node:test';

import { cacheKey, MemoryCacheStore } from './cache.js';

test('cache keys are normalized and values round-trip before expiry', async () => {
  assert.equal(cacheKey('Search', '  Hello   World '), 'search:hello world');
  const cache = new MemoryCacheStore();
  await cache.set('search:hello', { ok: true }, 60);
  assert.deepEqual(await cache.get('search:hello'), { ok: true });
  await cache.delete('search:hello');
  assert.equal(await cache.get('search:hello'), null);
});
