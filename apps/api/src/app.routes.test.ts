import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';
import { createServices } from './services.js';
import type { UserStore } from './user/store.js';

const rawSong = {
  id: 'song-1',
  name: 'Test Song',
  primaryArtists: 'Test Artist',
  duration: 180,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
};

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url.includes('/search/songs')) {
    return Promise.resolve(jsonResponse({ success: true, data: { results: [rawSong] } }));
  }
  if (url.includes('/suggestions')) {
    return Promise.resolve(jsonResponse({ success: true, data: { results: [rawSong] } }));
  }
  if (url.includes('/songs/')) {
    return Promise.resolve(jsonResponse({ success: true, data: rawSong }));
  }
  if (url.includes('itunes.apple.com')) {
    return Promise.resolve(jsonResponse({
      results: [{ artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg' }]
    }));
  }
  if (url.includes('/get?')) {
    return Promise.resolve(jsonResponse({
      trackName: 'Test Song',
      artistName: 'Test Artist',
      duration: 180,
      syncedLyrics: '[00:01.00] one\n[00:02.00] two\n[00:03.00] three\n[00:04.00] four\n[00:05.00] five\n[00:06.00] six\n[00:07.00] seven\n[00:08.00] eight\n[00:09.00] nine\n[00:10.00] ten'
    }));
  }
  if (url.includes('lrclib')) {
    return Promise.resolve(jsonResponse([]));
  }
  if (url === 'https://cdn.example/song.mp4') {
    const range = new Headers(init?.headers).get('range');
    if (range) {
      return Promise.resolve(new Response('audio-bytes', {
        status: 206,
        headers: {
          'content-type': 'audio/mp4',
          'content-length': '11',
          'content-range': 'bytes 0-10/100',
          'accept-ranges': 'bytes'
        }
      }));
    }
    return Promise.resolve(new Response('full-audio', {
      status: 200,
      headers: {
        'content-type': 'audio/mp4',
        'content-length': '10',
        'accept-ranges': 'bytes'
      }
    }));
  }
  return Promise.resolve(jsonResponse({ success: true, data: { results: [] } }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function app() {
  return createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    lrclibApiUrl: 'https://lrclib.test/api',
    fetchImpl: fakeFetch,
    rateLimit: false,
    allowedOrigin: 'http://localhost:5173'
  });
}

test('search returns the frozen envelope and normalized song', async () => {
  const response = await request(app()).get('/api/search?q=test');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.results[0].streamUrl, '/api/stream/song-1');
  assert.equal(response.body.data.results[0].artist, 'Test Artist');
  assert.equal(response.body.data.results[0].downloadUrl, undefined);
  assert.equal(response.body.data.source, 'Saavn');
});

test('search rejects a missing query and caps limit/page', async () => {
  const missing = await request(app()).get('/api/search');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.success, false);
  assert.equal(missing.body.data, null);
  assert.equal(missing.body.error, "Something's missing from that request.");

  const bounded = await request(app()).get('/api/search?q=test&limit=999&page=-4');
  assert.equal(bounded.status, 200);
  assert.equal(bounded.body.success, true);
});

test('anonymous auth and library persistence work through the API', async () => {
  const server = app();
  const auth = await request(server).post('/api/auth/anon');
  assert.equal(auth.status, 200);
  assert.equal(typeof auth.body.data.token, 'string');
  assert.equal(typeof auth.body.data.userId, 'string');
  assert.equal(auth.body.data.user, undefined);
  const token = auth.body.data.token as string;

  const created = await request(server)
    .post('/api/libraries')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Favorites' });
  assert.equal(created.status, 201);

  const listed = await request(server)
    .get('/api/libraries')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data[0].name, 'Favorites');

  const libraryId = listed.body.data[0].id as string;
  const renamed = await request(server)
    .patch(`/api/libraries/${libraryId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Later' });
  assert.equal(renamed.body.data.name, 'Later');

  const added = await request(server)
    .post(`/api/libraries/${libraryId}/songs`)
    .set('Authorization', `Bearer ${token}`)
    .send({ songId: 'song-1' });
  assert.deepEqual(added.body.data.songIds, ['song-1']);

  await request(server)
    .delete(`/api/libraries/${libraryId}/songs/song-1`)
    .set('Authorization', `Bearer ${token}`);
  const afterRemove = await request(server)
    .get('/api/libraries')
    .set('Authorization', `Bearer ${token}`);
  assert.deepEqual(afterRemove.body.data[0].songIds, []);

  const liked = await request(server)
    .post('/api/me/liked')
    .set('Authorization', `Bearer ${token}`)
    .send({ songId: 'song-1' });
  assert.equal(liked.status, 201);

  const recent = await request(server)
    .post('/api/me/recently-played')
    .set('Authorization', `Bearer ${token}`)
    .send({ songId: 'song-1', playDuration: 12 });
  assert.equal(recent.status, 201);

  const settings = await request(server)
    .patch('/api/me/settings')
    .set('Authorization', `Bearer ${token}`)
    .send({ theme: 'dark', __proto__: { admin: true } });
  assert.equal(settings.body.data.theme, 'dark');
  assert.equal(settings.body.data.admin, undefined);

  const deleted = await request(server)
    .delete(`/api/libraries/${libraryId}`)
    .set('Authorization', `Bearer ${token}`);
  assert.equal(deleted.status, 204);
});

test('invalid tokens are rejected and persistence failures stay in the envelope', async () => {
  const missing = await request(app()).get('/api/libraries');
  assert.equal(missing.status, 401);

  const invalid = await request(app()).get('/api/libraries').set('Authorization', 'Bearer not-a-jwt');
  assert.equal(invalid.status, 401);

  const store: UserStore = {
    async get() {
      return null;
    },
    async save() {
      throw new Error('dynamo down');
    }
  };
  const services = createServices({
    jwtSecret: 'test-secret',
    userStore: store,
    fetchImpl: fakeFetch,
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api'
  });
  const withStore = createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    services,
    rateLimit: false
  });
  const auth = await request(withStore).post('/api/auth/anon');
  assert.equal(auth.status, 502);
  assert.equal(auth.body.success, false);
  assert.equal(auth.body.data, null);
  assert.equal(auth.body.error.includes('moment'), true);
  assert.equal(auth.body.error.toLowerCase().includes('dynamo'), false);
});

test('stream preserves 206 and range headers', async () => {
  const response = await request(app())
    .get('/api/stream/song-1')
    .set('Range', 'bytes=0-10');

  assert.equal(response.status, 206);
  assert.equal(response.headers['content-range'], 'bytes 0-10/100');
  assert.equal(response.headers['accept-ranges'], 'bytes');
  assert.equal(response.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal(Buffer.from(response.body as Buffer).toString(), 'audio-bytes');
});

test('stream without Range returns 200 and rejects URL identities', async () => {
  const full = await request(app()).get('/api/stream/song-1');
  assert.equal(full.status, 200);
  assert.equal(full.headers['accept-ranges'], 'bytes');

  const ssrf = await request(app()).get('/api/stream/https%3A%2F%2F127.0.0.1%2Fsecret');
  assert.equal(ssrf.status, 400);
  assert.equal(ssrf.body.success, false);
});

test('catalog, artwork, lyrics, and home smoke endpoints keep the frozen envelope', async () => {
  const server = app();
  const song = await request(server).get('/api/songs/song-1');
  assert.equal(song.status, 200);
  assert.equal(song.body.data.id, 'song-1');

  const suggestions = await request(server).get('/api/songs/song-1/suggestions');
  assert.equal(suggestions.status, 200);
  assert.equal(Array.isArray(suggestions.body.data), true);

  const home = await request(server).get('/api/home');
  assert.equal(home.status, 200);
  assert.equal(Array.isArray(home.body.data.trending), true);

  const artwork = await request(server).get('/api/artwork?title=test&artist=artist');
  assert.equal(artwork.status, 200);
  assert.equal(artwork.body.data.urls[0], 'https://is1-ssl.mzstatic.com/image/thumb/1000x1000bb.jpg');

  const lyrics = await request(server).get('/api/lyrics?title=test&artist=artist&duration=180');
  assert.equal(lyrics.status, 200);
  assert.equal(lyrics.body.data.type, 'synced');
  assert.ok(lyrics.body.data.lines.length >= 10);
});
