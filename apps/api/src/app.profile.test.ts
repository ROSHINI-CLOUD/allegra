import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

const rawSong = (id: string) => ({
  id,
  name: `Song ${id}`,
  primaryArtists: `Artist ${id}`,
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

test('plays sent at the same moment from two devices are both kept', async () => {
  const ctx = await signedIn();
  const [web, phone] = await Promise.all([
    ctx.as(request(ctx.app).post('/api/me/recently-played').send({ songId: 'w1', playDuration: 120 })),
    ctx.as(request(ctx.app).post('/api/me/recently-played').send({ songId: 'p1', playDuration: 120 }))
  ]);
  assert.equal(web.status, 201);
  assert.equal(phone.status, 201);

  const recent = await ctx.as(request(ctx.app).get('/api/me/recently-played'));
  const ids = (recent.body.data as { id: string }[]).map((song) => song.id).sort();
  assert.deepEqual(ids, ['p1', 'w1']);
});

test('a settings change racing a play keeps both, and taste learns from the play', async () => {
  const ctx = await signedIn();
  const [settings, play] = await Promise.all([
    ctx.as(request(ctx.app).patch('/api/me/settings').send({ theme: 'dark' })),
    ctx.as(request(ctx.app).post('/api/me/taste/signal').send({ songId: 's1', seconds: 170 }))
  ]);
  assert.equal(settings.status, 200);
  assert.equal(play.status, 204);

  const saved = await ctx.as(request(ctx.app).get('/api/me/settings'));
  assert.equal(saved.body.data.theme, 'dark');
  const taste = await ctx.as(request(ctx.app).get('/api/me/taste'));
  assert.deepEqual((taste.body.data.topArtists as { name: string }[]).map((artist) => artist.name), ['Artist s1']);
});

test('a settings change answers with every setting, not only the changed ones', async () => {
  const ctx = await signedIn();
  await ctx.as(request(ctx.app).patch('/api/me/settings').send({ theme: 'dark' }));
  const reply = await ctx.as(request(ctx.app).patch('/api/me/settings').send({ languages: ['tamil'] }));
  assert.equal(reply.status, 200);
  assert.equal(reply.body.data.theme, 'dark');
  assert.equal(reply.body.data.languages, 'tamil');
});
