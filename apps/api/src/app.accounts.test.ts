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

function app() {
  const services = createServices({ jwtSecret: 'test-secret', fetchImpl: fakeFetch, saavnApiUrl: 'https://saavn.test/api', gaanaApiUrl: 'https://gaana.test/api' });
  return createApp({ version: 'test', jwtSecret: 'test-secret', services, rateLimit: false });
}

async function guest(server: ReturnType<typeof app>): Promise<string> {
  const response = await request(server).post('/api/auth/anon');
  return response.body.data.token as string;
}

test('a guest becomes an account and keeps what they had; the email cannot be registered twice', async () => {
  const server = app();
  const token = await guest(server);
  await request(server).post('/api/libraries').set('Authorization', `Bearer ${token}`).send({ name: 'Late night' });

  const registered = await request(server)
    .post('/api/auth/register')
    .set('Authorization', `Bearer ${token}`)
    .send({ email: 'Asha@Example.com', password: 'correct horse', displayName: 'Asha' });
  assert.equal(registered.status, 201);
  const accountToken = registered.body.data.token as string;

  const me = await request(server).get('/api/auth/me').set('Authorization', `Bearer ${accountToken}`);
  assert.equal(me.body.data.isGuest, false);
  assert.equal(me.body.data.displayName, 'Asha');
  assert.equal(me.body.data.email, 'asha@example.com');
  assert.equal('passwordHash' in me.body.data, false);

  const libraries = await request(server).get('/api/libraries').set('Authorization', `Bearer ${accountToken}`);
  assert.equal(libraries.body.data[0].name, 'Late night');

  const again = await request(server).post('/api/auth/register').send({ email: 'asha@example.com', password: 'another one!!' });
  assert.equal(again.status, 409);
});

test('login checks the password, and folds a guest session on this device into the account', async () => {
  const server = app();
  await request(server).post('/api/auth/register').send({ email: 'ravi@example.com', password: 'a-long-password' });

  const wrong = await request(server).post('/api/auth/login').send({ email: 'ravi@example.com', password: 'not-it-at-all' });
  assert.equal(wrong.status, 401);
  const unknown = await request(server).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'a-long-password' });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.error, unknown.body.error);

  const visitor = await guest(server);
  await request(server).post('/api/me/liked').set('Authorization', `Bearer ${visitor}`).send({ songId: 'song-1' });

  const login = await request(server).post('/api/auth/login').set('Authorization', `Bearer ${visitor}`).send({ email: 'ravi@example.com', password: 'a-long-password' });
  assert.equal(login.status, 200);
  const liked = await request(server).get('/api/me/liked').set('Authorization', `Bearer ${login.body.data.token}`);
  assert.equal(liked.body.data.length, 1);
});

test('short passwords and bad emails are refused before anything is stored', async () => {
  const server = app();
  assert.equal((await request(server).post('/api/auth/register').send({ email: 'nope', password: 'long-enough-1' })).status, 400);
  assert.equal((await request(server).post('/api/auth/register').send({ email: 'a@b.co', password: 'short' })).status, 400);
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
