import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';
import { createServices } from './services.js';
import { applySeeds, applySignal, mergeTaste, playWeight, SIGNAL_WEIGHT } from './user/taste.js';

const rawSong = {
  id: 'song-1',
  name: 'Tum Hi Ho',
  primaryArtists: 'Arijit Singh, Mithoon',
  language: 'hindi',
  duration: 240,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes('/songs/') || url.includes('/songs?')) return Promise.resolve(jsonResponse({ success: true, data: rawSong }));
  return Promise.resolve(jsonResponse({ success: true, data: { results: [rawSong] } }));
}

/**
 * Stands in for Convex Auth: `convex:<userId>` is a signed-in account. The real
 * RS256/JWKS verification is proved against generated keys in auth/verifier.test.ts;
 * here we only need a caller the API treats as signed in.
 */
const fakeAccountVerifier = {
  verify: async (token: string) =>
    token.startsWith('convex:') ? { userId: token.slice('convex:'.length), source: 'convex' as const } : null
};

function app() {
  const services = createServices({
    jwtSecret: 'test-secret',
    fetchImpl: fakeFetch,
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    accountVerifier: fakeAccountVerifier
  });
  return createApp({ version: 'test', jwtSecret: 'test-secret', services, rateLimit: false });
}

async function guest(server: ReturnType<typeof app>): Promise<string> {
  const response = await request(server).post('/api/auth/anon');
  return response.body.data.token as string;
}

test('signing in with Google keeps the playlists and likes made as a guest', async () => {
  const server = app();
  const token = await guest(server);
  await request(server).post('/api/libraries').set('Authorization', `Bearer ${token}`).send({ name: 'Late night' });
  await request(server).post('/api/me/liked').set('Authorization', `Bearer ${token}`).send({ songId: 'song-1' });

  const account = 'convex:user_asha';
  const linked = await request(server)
    .post('/api/auth/link')
    .set('Authorization', `Bearer ${account}`)
    .send({ guestToken: token });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.data.isGuest, false);

  const libraries = await request(server).get('/api/libraries').set('Authorization', `Bearer ${account}`);
  assert.equal(libraries.body.data[0].name, 'Late night');
  const liked = await request(server).get('/api/me/liked').set('Authorization', `Bearer ${account}`);
  assert.equal(liked.body.data.length, 1);
});

test('a signed-in listener is not a guest and never sees credentials', async () => {
  const server = app();
  const me = await request(server).get('/api/auth/me').set('Authorization', 'Bearer convex:user_ravi');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.isGuest, false);
  assert.equal(me.body.data.userId, 'user_ravi');
  assert.equal('passwordHash' in me.body.data, false);
});

test('linking refuses an unverified caller and a missing guest token', async () => {
  const server = app();
  const token = await guest(server);

  const noAuth = await request(server).post('/api/auth/link').send({ guestToken: token });
  assert.equal(noAuth.status, 401);

  const forged = await request(server)
    .post('/api/auth/link')
    .set('Authorization', 'Bearer not-a-real-token')
    .send({ guestToken: token });
  assert.equal(forged.status, 401);

  const noGuest = await request(server).post('/api/auth/link').set('Authorization', 'Bearer convex:user_x').send({});
  assert.equal(noGuest.status, 400);
});

test('an unknown bearer token cannot reach a library at all', async () => {
  const server = app();
  const response = await request(server).get('/api/libraries').set('Authorization', 'Bearer made-up');
  assert.equal(response.status, 401);
});

test('liking and playing teach the taste profile, and onboarding seeds it', async () => {
  const server = app();
  const token = await guest(server);
  const auth = { Authorization: `Bearer ${token}` };

  assert.equal((await request(server).get('/api/me/taste').set(auth)).body.data.onboarded, false);
  await request(server).post('/api/me/liked').set(auth).send({ songId: 'song-1' });
  const learned = (await request(server).get('/api/me/taste').set(auth)).body.data;
  assert.equal(learned.topArtists[0].name, 'Arijit Singh');
  assert.equal(learned.languages[0].name, 'hindi');

  const seeded = await request(server).post('/api/me/taste/seed').set(auth).send({ artists: ['Anirudh Ravichander'], languages: ['tamil'] });
  assert.equal(seeded.body.data.onboarded, true);
  assert.equal(seeded.body.data.topArtists[0].name, 'Anirudh Ravichander');
});

test('a share link is public, live, revocable, and can be saved as a copy', async () => {
  const server = app();
  const owner = { Authorization: `Bearer ${await guest(server)}` };
  const library = (await request(server).post('/api/libraries').set(owner).send({ name: 'Road trip' })).body.data;
  await request(server).post(`/api/libraries/${library.id}/songs`).set(owner).send({ songId: 'song-1' });

  const shared = await request(server).post(`/api/libraries/${library.id}/share`).set(owner);
  assert.equal(shared.status, 201);
  const code = shared.body.data.code as string;

  const open = await request(server).get(`/api/shared/${code}`);
  assert.equal(open.status, 200);
  assert.equal(open.body.data.name, 'Road trip');
  assert.equal(open.body.data.songs.length, 1);

  const friend = { Authorization: `Bearer ${await guest(server)}` };
  const saved = await request(server).post(`/api/shared/${code}/save`).set(friend);
  assert.equal(saved.status, 201);
  assert.notEqual(saved.body.data.id, library.id);
  assert.equal(saved.body.data.isPublic, false);

  assert.equal((await request(server).delete(`/api/libraries/${library.id}/share`).set(owner)).status, 204);
  assert.equal((await request(server).get(`/api/shared/${code}`)).status, 404);
  assert.equal((await request(server).get('/api/shared/x')).status, 404);
});

test('taste decays old habits, weighs skips against plays, and merges two profiles', () => {
  const now = new Date('2026-09-21T00:00:00Z');
  let taste = applySignal(undefined, { artist: 'A, B', language: 'hindi' }, SIGNAL_WEIGHT.like, now);
  assert.equal(taste.artists[0]?.name, 'A');
  assert.ok((taste.artists.find((entry) => entry.name === 'B')?.score ?? 0) < (taste.artists[0]?.score ?? 0));

  for (let index = 0; index < 20; index += 1) taste = applySignal(taste, { artist: 'C' }, SIGNAL_WEIGHT.play, now);
  assert.equal(taste.artists[0]?.name, 'C');
  assert.equal(taste.onboarded, true);

  assert.ok(playWeight(3, 200) < 0);
  assert.equal(playWeight(150, 200), SIGNAL_WEIGHT.play);
  assert.equal(playWeight(20, 200), 0.4);

  const merged = mergeTaste(applySeeds(undefined, ['X'], [], now), applySeeds(undefined, ['X', 'Y'], [], now));
  assert.equal(merged.artists[0]?.name, 'X');
  assert.ok((merged.artists[0]?.score ?? 0) > SIGNAL_WEIGHT.seed * 1.9);
});
