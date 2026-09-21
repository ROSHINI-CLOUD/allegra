import assert from 'node:assert/strict';
import test from 'node:test';

import { DynamoCacheStore } from './dynamoCache.js';

test('get returns null and does not throw when Dynamo is unreachable', async () => {
  const store = new DynamoCacheStore({
    tableName: 'allegra-cache-test',
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' },
    fetchImpl: async () => {
      throw new Error('network down');
    }
  });
  assert.equal(await store.get('k'), null);
});

test('set and delete soft-fail when Dynamo rejects the call', async () => {
  const store = new DynamoCacheStore({
    tableName: 'allegra-cache-test',
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' },
    fetchImpl: async () => new Response('boom', { status: 500 })
  });
  await assert.doesNotReject(() => store.set('k', { ok: true }, 60));
  await assert.doesNotReject(() => store.delete('k'));
});

test('get parses a live item and ignores expired rows', async () => {
  const future = Math.floor(Date.now() / 1000) + 120;
  const past = Math.floor(Date.now() / 1000) - 5;
  let deleted = false;

  const store = new DynamoCacheStore({
    tableName: 'allegra-cache-test',
    region: 'us-east-1',
    credentials: { accessKeyId: 'AKIATEST', secretAccessKey: 'secret' },
    fetchImpl: async (_input, init) => {
      const target = (init?.headers as Record<string, string>)['x-amz-target'] ?? '';
      if (target.endsWith('DeleteItem')) {
        deleted = true;
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/x-amz-json-1.0' } });
      }
      const body = JSON.parse(String(init?.body));
      const key = body.Key.cacheKey.S as string;
      if (key === 'fresh') {
        return Response.json({
          Item: {
            cacheKey: { S: 'fresh' },
            payload: { S: JSON.stringify({ songs: 2 }) },
            expiresAt: { N: String(future) }
          }
        });
      }
      return Response.json({
        Item: {
          cacheKey: { S: 'stale' },
          payload: { S: JSON.stringify({ songs: 9 }) },
          expiresAt: { N: String(past) }
        }
      });
    }
  });

  assert.deepEqual(await store.get('fresh'), { songs: 2 });
  assert.equal(await store.get('stale'), null);
  assert.equal(deleted, true);
});
