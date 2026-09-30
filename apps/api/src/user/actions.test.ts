import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundError } from '../lib/errors.js';
import { createServices } from '../services.js';
import type { LibraryChange } from '../shared/library.js';

const rawSong = (id: string) => ({
  id,
  name: `Song ${id}`,
  primaryArtists: `Artist ${id}`,
  duration: 180,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
});

const catalogUp = (input: RequestInfo | URL): Promise<Response> => {
  const match = String(input).match(/\/songs\/([^/?]+)/);
  const body = match ? { success: true, data: rawSong(decodeURIComponent(match[1] ?? '')) } : { success: false };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
};

const catalogDown = (): Promise<Response> => Promise.reject(new Error('ECONNRESET'));

async function listener(fetchImpl: typeof fetch = catalogUp) {
  const services = createServices({ jwtSecret: 'test-secret', saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api', fetchImpl });
  const { userId } = await services.auth.createGuest();
  const user = async () => {
    const found = await services.auth.getUser(userId);
    assert.ok(found);
    return found;
  };
  const changes = async (): Promise<LibraryChange[]> => [...(await services.auth.library.changes(userId, 0, 500)).changes];
  return { ...services, userId, user, changes };
}

test('a like carries the song’s details, so the phone can show it without a lookup', async () => {
  const ctx = await listener();
  await ctx.actions.like(await ctx.user(), 's1');

  const like = (await ctx.changes()).find((change) => change.kind === 'like');
  assert.ok(like && like.kind === 'like');
  assert.equal(like.liked, true);
  assert.deepEqual(like.song, { ref: 'saavn:s1', title: 'Song s1', artist: 'Artist s1', artwork: 'https://img/song.jpg', duration: 180 });
});

test('liking twice teaches taste once', async () => {
  const ctx = await listener();
  await ctx.actions.like(await ctx.user(), 's1');
  const once = (await ctx.user()).taste?.artists[0]?.score;
  await ctx.actions.like(await ctx.user(), 's1');
  assert.equal((await ctx.user()).taste?.artists[0]?.score, once);
});

test('with the catalog down, a like still lands, only without details or taste', async () => {
  const ctx = await listener(catalogDown);
  await ctx.actions.like(await ctx.user(), 's1');

  assert.deepEqual((await ctx.user()).likedSongIds, ['s1']);
  const like = (await ctx.changes()).find((change) => change.kind === 'like');
  assert.ok(like && like.kind === 'like' && like.song === undefined);
  assert.equal((await ctx.user()).taste, undefined);
});

test('adding to a playlist that isn’t there is NotFoundError, and changes nothing', async () => {
  const ctx = await listener();
  await assert.rejects(ctx.actions.addToPlaylist(await ctx.user(), 'missing', 's1'), NotFoundError);
  assert.deepEqual(await ctx.changes(), []);
});

test('a playlist add carries details and returns the playlist as it now is', async () => {
  const ctx = await listener();
  const created = await ctx.actions.createPlaylist(await ctx.user(), { name: '  Late night  ' });
  assert.equal(created.name, 'Late night');

  const after = await ctx.actions.addToPlaylist(await ctx.user(), created.id, 's2');
  assert.deepEqual(after.songIds, ['s2']);
  const item = (await ctx.changes()).find((change) => change.kind === 'playlist_item');
  assert.ok(item && item.kind === 'playlist_item');
  assert.equal(item.song?.title, 'Song s2');
});

test('a saved copy of a shared playlist is private and carries every song’s details', async () => {
  const owner = await listener();
  const playlist = await owner.actions.createPlaylist(await owner.user(), { name: 'Road trip' });
  await owner.actions.addToPlaylist(await owner.user(), playlist.id, 'a');
  await owner.actions.addToPlaylist(await owner.user(), playlist.id, 'b');
  const { code, created } = await owner.actions.share(await owner.user(), playlist.id);
  assert.equal(created, true);
  assert.equal((await owner.user()).libraries[0]?.isPublic, true);
  assert.equal((await owner.actions.share(await owner.user(), playlist.id)).created, false);

  // Same services (one in-memory store), a second listener.
  const { userId: friendId } = await owner.auth.createGuest();
  const friend = await owner.auth.getUser(friendId);
  assert.ok(friend);
  const copy = await owner.actions.saveSharedCopy(friend, code);
  assert.ok(copy);
  assert.equal(copy.isPublic, false);
  assert.deepEqual(copy.songIds, ['a', 'b']);
  const items = (await owner.auth.library.changes(friendId, 0, 500)).changes.filter((change) => change.kind === 'playlist_item');
  assert.deepEqual(items.map((item) => (item.kind === 'playlist_item' ? item.song?.title : null)), ['Song a', 'Song b']);
});

test('turning a link off makes the playlist private and the code stops working', async () => {
  const ctx = await listener();
  const playlist = await ctx.actions.createPlaylist(await ctx.user(), { name: 'Mine' });
  const { code } = await ctx.actions.share(await ctx.user(), playlist.id);
  await ctx.actions.unshare(await ctx.user(), playlist.id);

  assert.equal((await ctx.user()).libraries[0]?.isPublic, false);
  assert.equal(await ctx.actions.openShare(code), null);
});
