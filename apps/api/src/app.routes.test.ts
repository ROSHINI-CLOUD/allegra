import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

const rawSong = {
  id: 'song-1',
  name: 'Test Song',
  primaryArtists: 'Test Artist',
  duration: 180,
  image: [{ quality: '500x500', url: 'https://img/song.jpg' }],
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn/song.mp4' }]
};

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url.includes('/search/songs')) {
    return Promise.resolve(jsonResponse({ success: true, data: { results: [rawSong] } }));
  }
  if (url.includes('/songs/song-1')) {
    return Promise.resolve(jsonResponse({ success: true, data: rawSong }));
  }
  if (url === 'https://cdn/song.mp4') {
    assert.equal(new Headers(init?.headers).get('range'), 'bytes=0-10');
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
  return Promise.resolve(jsonResponse({ success: true, data: { results: [] } }));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

function app() {
  return createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    fetchImpl: fakeFetch
  });
}

test('search returns the frozen envelope and normalized song', async () => {
  const response = await request(app()).get('/api/search?q=test');

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.data.results[0].streamUrl, '/api/stream/song-1');
  assert.equal(response.body.data.results[0].artist, 'Test Artist');
});

test('anonymous auth and library persistence work through the API', async () => {
  const server = app();
  const auth = await request(server).post('/api/auth/anon');
  assert.equal(auth.status, 200);
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
