import assert from 'node:assert/strict';
import test from 'node:test';

import { PersistenceError } from '../lib/errors.js';
import { ConvexUserStore } from './convex.js';
import { ConvexGateway, type ConvexClientLike } from './convexGateway.js';
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
  const store = new ConvexUserStore(new ConvexGateway({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client }));

  await store.save(user);
  assert.deepEqual(await store.get('u1'), user);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.secret === 'a-long-shared-secret'));
});

test('an unknown user is null, not an error', async () => {
  const { client } = fakeClient(new Map());
  const store = new ConvexUserStore(new ConvexGateway({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client }));
  assert.equal(await store.get('missing'), null);
});

test('a malformed row is treated as missing rather than crashing the request', async () => {
  const { client } = fakeClient(new Map([['u2', { userId: 'u2', likedSongIds: 'nope' }]]));
  const store = new ConvexUserStore(new ConvexGateway({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client }));
  assert.equal(await store.get('u2'), null);
});

/** A profile row with the version counter convex/profiles.ts keeps, and an `update` that compares it. */
function versionedClient(initial: UserData, interfere: (attempt: number) => UserData | null) {
  let row: UserData & { version: number } = { ...initial, version: 3 };
  let attempts = 0;
  const client: ConvexClientLike = {
    async query() {
      return row;
    },
    async mutation(name, args) {
      assert.equal(name, 'profiles:update');
      attempts += 1;
      // Another device writes between this caller's read and its write.
      const other = interfere(attempts);
      if (other) row = { ...other, version: row.version + 1 };
      if (args.expectedVersion !== row.version) return false;
      row = { ...(args.user as UserData), version: row.version + 1 };
      return true;
    }
  };
  return { client, current: () => row, attempts: () => attempts };
}

test('update re-applies the change on top of a write that landed in between', async () => {
  const fake = versionedClient(user, (attempt) => (attempt === 1 ? { ...user, settings: { theme: 'light', volume: 3 } } : null));
  const store = new ConvexUserStore(new ConvexGateway({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client: fake.client }));

  const saved = await store.update('u1', (current) => ({ ...current, settings: { ...current.settings, language: 'tamil' } }));

  assert.equal(fake.attempts(), 2);
  assert.deepEqual(fake.current().settings, { theme: 'light', volume: 3, language: 'tamil' });
  assert.deepEqual(saved?.settings, { theme: 'light', volume: 3, language: 'tamil' });
});

test('update gives up with PersistenceError when it keeps losing the race', async () => {
  const fake = versionedClient(user, () => ({ ...user, settings: { theme: 'busy' } }));
  const store = new ConvexUserStore(new ConvexGateway({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client: fake.client }));

  await assert.rejects(store.update('u1', (current) => ({ ...current, settings: {} })), PersistenceError);
  assert.equal(fake.attempts(), 5);
});

test('update that changes nothing writes nothing', async () => {
  const fake = versionedClient(user, () => null);
  const store = new ConvexUserStore(new ConvexGateway({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client: fake.client }));

  assert.deepEqual(await store.update('u1', () => null), user);
  assert.equal(fake.attempts(), 0);
});

test('non-object settings fall back to an empty object', async () => {
  const { client } = fakeClient(new Map([['u3', { ...user, userId: 'u3', settings: null }]]));
  const store = new ConvexUserStore(new ConvexGateway({ url: 'https://example.convex.cloud', serverSecret: 'a-long-shared-secret', client }));
  assert.deepEqual((await store.get('u3'))?.settings, {});
});
