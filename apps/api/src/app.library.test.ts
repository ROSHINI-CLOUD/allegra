import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';
import type { LibraryChange } from './shared/library.js';

const rawSong = (id: string) => ({
  id,
  name: `Song ${id}`,
  primaryArtists: 'Test Artist',
  duration: 180,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
});

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const match = String(input).match(/\/songs\/([^/?]+)/);
  const body = match ? { success: true, data: rawSong(decodeURIComponent(match[1] ?? '')) } : { success: false };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

async function signedIn() {
  const app = createApp({ version: 'test', jwtSecret: 'test-secret', saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api', fetchImpl: fakeFetch, rateLimit: false });
  const session = await request(app).post('/api/auth/anon');
  const token = String(session.body.data.token);
  const as = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  return { app, as };
}

async function allChanges(ctx: Awaited<ReturnType<typeof signedIn>>, limit = 500): Promise<LibraryChange[]> {
  const out: LibraryChange[] = [];
  let since = 0;
  for (let guard = 0; guard < 50; guard++) {
    const page = await ctx.as(request(ctx.app).get(`/api/me/library/changes?since=${since}&limit=${limit}`));
    assert.equal(page.status, 200);
    out.push(...(page.body.data.changes as LibraryChange[]));
    since = page.body.data.rev;
    if (!page.body.data.more) break;
  }
  return out;
}

const song = (id: string) => ({ ref: `saavn:${id}`, title: `Song ${id}`, artist: 'Test Artist', artwork: 'https://img/song.jpg', duration: 180 });

test('a like from the phone and a like from the website both land', async () => {
  const ctx = await signedIn();
  const phone = await ctx.as(request(ctx.app).post('/api/me/library/ops').send({ ops: [{ op: 'like', ref: 'saavn:p1', song: song('p1'), at: Date.now() }] }));
  assert.equal(phone.status, 200);
  assert.deepEqual(phone.body.data.rejected, []);
  assert.equal((await ctx.as(request(ctx.app).post('/api/me/liked').send({ songId: 'w1' }))).status, 201);

  const likes = (await allChanges(ctx)).filter((change) => change.kind === 'like' && change.liked);
  assert.deepEqual(likes.map((change) => (change.kind === 'like' ? change.ref : '')).sort(), ['saavn:p1', 'saavn:w1']);
  // The website's like carries what the phone needs to show it.
  const fromWeb = likes.find((change) => change.kind === 'like' && change.ref === 'saavn:w1');
  assert.equal(fromWeb?.kind === 'like' ? fromWeb.song?.title : undefined, 'Song w1');
});

test("an offline phone's older removal does not undo the website's newer add", async () => {
  const ctx = await signedIn();
  const created = await ctx.as(request(ctx.app).post('/api/libraries').send({ name: 'Road trip' }));
  assert.equal(created.status, 201);
  const id = String(created.body.data.id);
  await ctx.as(request(ctx.app).post(`/api/libraries/${id}/songs`).send({ songId: 's1' }));

  await ctx.as(request(ctx.app).post('/api/me/library/ops').send({ ops: [{ op: 'playlist_remove', playlistId: id, ref: 'saavn:s1', at: Date.now() - 60_000 }] }));
  let libraries = await ctx.as(request(ctx.app).get('/api/libraries'));
  assert.deepEqual(libraries.body.data[0].songIds, ['s1']);

  await ctx.as(request(ctx.app).post('/api/me/library/ops').send({ ops: [{ op: 'playlist_remove', playlistId: id, ref: 'saavn:s1', at: Date.now() + 1000 }] }));
  libraries = await ctx.as(request(ctx.app).get('/api/libraries'));
  assert.deepEqual(libraries.body.data[0].songIds, []);
});

test('a playlist made on the phone shows on the website with its songs in order', async () => {
  const ctx = await signedIn();
  const at = Date.now() - 5000;
  const reply = await ctx.as(
    request(ctx.app)
      .post('/api/me/library/ops')
      .send({
        ops: [
          { op: 'playlist_upsert', playlistId: 'phone-list-1', name: 'From the phone', at },
          { op: 'playlist_add', playlistId: 'phone-list-1', ref: 'saavn:b', song: song('b'), at: at + 1 },
          { op: 'playlist_add', playlistId: 'phone-list-1', ref: 'saavn:a', song: song('a'), at: at + 2 },
          { op: 'playlist_add', playlistId: 'nowhere', ref: 'saavn:a', at: at + 3 }
        ]
      })
  );
  assert.deepEqual(reply.body.data.rejected, [{ index: 3, reason: 'no_playlist' }]);
  const libraries = await ctx.as(request(ctx.app).get('/api/libraries'));
  assert.deepEqual(
    libraries.body.data.map((library: { id: string; name: string; songIds: string[] }) => [library.id, library.name, library.songIds]),
    [['phone-list-1', 'From the phone', ['b', 'a']]]
  );
});

test('a malformed batch is refused whole, so nothing half-applies', async () => {
  const ctx = await signedIn();
  const reply = await ctx.as(
    request(ctx.app)
      .post('/api/me/library/ops')
      .send({ ops: [{ op: 'like', ref: 'saavn:ok', at: 1 }, { op: 'like', ref: 'not a ref', at: 1 }] })
  );
  assert.equal(reply.status, 400);
  assert.equal(reply.body.success, false);
  assert.deepEqual(await allChanges(ctx), []);
});

test('the change feed pages through everything and says where to resume', async () => {
  const ctx = await signedIn();
  const now = Date.now();
  await ctx.as(
    request(ctx.app)
      .post('/api/me/library/ops')
      .send({ ops: Array.from({ length: 7 }, (_, i) => ({ op: 'like', ref: `saavn:x${i}`, at: now - 100 + i })) })
  );
  const revs = (await allChanges(ctx, 2)).map((change) => change.rev);
  assert.deepEqual(revs, [1, 2, 3, 4, 5, 6, 7]);
  const after = await ctx.as(request(ctx.app).get('/api/me/library/changes?since=7'));
  assert.deepEqual(after.body.data, { rev: 7, changes: [], more: false });
});

test('a play made offline lands at the time it happened', async () => {
  const ctx = await signedIn();
  await ctx.as(request(ctx.app).post('/api/me/recently-played').send({ songId: 'now', playDuration: 30 }));
  const earlier = new Date(Date.now() - 3600_000).toISOString();
  const reply = await ctx.as(request(ctx.app).post('/api/me/recently-played').send({ songId: 'offline', playDuration: 30, playedAt: earlier }));
  assert.equal(reply.body.data.playedAt, earlier);
  const tooOld = await ctx.as(request(ctx.app).post('/api/me/recently-played').send({ songId: 'old', playDuration: 30, playedAt: '2020-01-01T00:00:00.000Z' }));
  assert.notEqual(tooOld.body.data.playedAt, '2020-01-01T00:00:00.000Z');
});
