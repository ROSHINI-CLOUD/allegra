import assert from 'node:assert/strict';
import test from 'node:test';

import { ConvexUserStore, type ConvexClientLike } from './convex.js';
import type { UserData } from '../user/store.js';

const user: UserData = {
  userId: 'u1',
  isGuest: true,
  createdAt: '2026-09-20T00:00:00.000Z',
  libraries: [{ id: 'l1', name: 'Late night', isPublic: false, songIds: ['a'], createdAt: '2026-09-20T00:00:00.000Z' }],
  likedSongIds: ['a', 'b'],
  recentlyPlayed: [{ songId: 'a', playDuration: 12, playedAt: '2026-09-20T00:00:00.000Z' }],
  settings: { theme: 'dark' }
};

function fakeClient(rows: Map<string, unknown>): { client: ConvexClientLike; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const client: ConvexClientLike = {
    async query(_reference, args) {
      calls.push(args);
      return rows.get(String(args.userId)) ?? null;
    },
    async mutation(_reference, args) {
      calls.push(args);
      const saved = args.user as UserData;
      rows.set(saved.userId, saved);
      return null;
    }
  };
  return { client, calls };
}

test('save then get round-trips a user and sends the server secret every time', async () => {
  const { client, calls } = fakeClient(new Map());
  const store = new ConvexUserStore({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client });

  await store.save(user);
  assert.deepEqual(await store.get('u1'), user);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.secret === 'a-long-shared-secret'));
});

test('an unknown user is null, not an error', async () => {
  const { client } = fakeClient(new Map());
  const store = new ConvexUserStore({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client });
  assert.equal(await store.get('missing'), null);
});

test('a malformed row is treated as missing rather than crashing the request', async () => {
  const { client } = fakeClient(new Map([['u2', { userId: 'u2', likedSongIds: 'nope' }]]));
  const store = new ConvexUserStore({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client });
  assert.equal(await store.get('u2'), null);
});

test('non-object settings fall back to an empty object', async () => {
  const { client } = fakeClient(new Map([['u3', { ...user, userId: 'u3', settings: null }]]));
  const store = new ConvexUserStore({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client });
  assert.deepEqual((await store.get('u3'))?.settings, {});
});
