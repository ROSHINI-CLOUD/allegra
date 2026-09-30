import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryLibraryStore } from './library.js';
import { MemoryUserStore, type UserData } from './store.js';

const profile = (overrides: Partial<UserData> = {}): UserData => ({
  userId: 'u1',
  isGuest: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  libraries: [],
  likedSongIds: [],
  recentlyPlayed: [],
  settings: {},
  ...overrides
});

test('a whole-profile save made from an older read cannot undo a library change', async () => {
  const users = new MemoryUserStore();
  const library = new MemoryLibraryStore(users);
  await users.save(profile());

  const staleRead = await users.get('u1'); // e.g. a taste update that started before the like
  await library.apply('u1', [{ op: 'like', ref: 'saavn:a', at: Date.now() }]);
  assert.ok(staleRead);
  await users.save({ ...staleRead, settings: { theme: 'dark' } });

  const now = await users.get('u1');
  assert.deepEqual(now?.likedSongIds, ['a']);
  assert.deepEqual(now?.settings, { theme: 'dark' });
});

test("a listener's first sync sends the library they already had", async () => {
  const users = new MemoryUserStore();
  const library = new MemoryLibraryStore(users);
  await users.save(
    profile({
      likedSongIds: ['a', 'b'],
      libraries: [{ id: 'p1', name: 'Old list', isPublic: false, songIds: ['b'], createdAt: '2026-09-02T00:00:00.000Z' }]
    })
  );
  const page = await library.changes('u1', 0, 100);
  assert.deepEqual(
    page.changes.map((change) => [change.kind, 'ref' in change ? change.ref : change.playlistId]),
    [
      ['like', 'saavn:a'],
      ['like', 'saavn:b'],
      ['playlist', 'p1'],
      ['playlist_item', 'saavn:b']
    ]
  );
  assert.equal(page.more, false);
  // Unchanged by being moved into rows.
  assert.deepEqual((await users.get('u1'))?.likedSongIds, ['a', 'b']);
});

test('unknown listeners are refused rather than given an empty library', async () => {
  const library = new MemoryLibraryStore(new MemoryUserStore());
  await assert.rejects(library.apply('nobody', [{ op: 'like', ref: 'saavn:a', at: 1 }]));
});
