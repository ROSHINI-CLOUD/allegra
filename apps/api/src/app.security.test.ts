import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

function app(rateLimit?: false | { api: { windowMs: number; limit: number } }) {
  return createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    allowedOrigin: 'http://localhost:5173',
    saavnApiUrl: 'https://saavn.test/api',
    rateLimit: rateLimit ?? false
  });
}

test('helmet, CORS allowlist, and JSON size limits are enforced', async () => {
  const server = app();
  const health = await request(server).get('/api/health').set('Origin', 'http://localhost:5173');
  assert.equal(health.headers['x-powered-by'], undefined);
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.equal(health.headers['access-control-allow-origin'], 'http://localhost:5173');

  const blocked = await request(server).get('/api/health').set('Origin', 'http://evil.example');
  assert.notEqual(blocked.headers['access-control-allow-origin'], 'http://evil.example');

  const huge = await request(server)
    .post('/api/libraries')
    .set('Content-Type', 'application/json')
    .send({ name: 'x'.repeat(40_000) });
  assert.equal(huge.status, 400);
  assert.equal(huge.body.success, false);
  assert.equal(huge.body.data, null);
});

test('rate limiting returns the frozen 429 envelope', async () => {
  const server = app({ api: { windowMs: 60_000, limit: 1 } });
  await request(server).get('/api/search?q=test');
  const limited = await request(server).get('/api/search?q=test');
  assert.equal(limited.status, 429);
  assert.equal(limited.body.success, false);
  assert.equal(limited.body.error, 'Too many requests — give it a moment.');
});

test('unknown routes and provider failures do not leak internals', async () => {
  const missing = await request(app()).get('/api/not-a-real-route');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.success, false);
  assert.equal(missing.body.error, "We couldn't find that.");

  const down = createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    saavnApiUrl: 'https://saavn.test/api',
    rateLimit: false,
    fetchImpl: async () => {
      throw new Error('ECONNRESET from saavn-internal-host');
    }
  });
  const search = await request(down).get('/api/search?q=test');
  assert.equal(search.status, 502);
  assert.equal(search.body.success, false);
  assert.equal(String(search.body.error).includes('saavn-internal-host'), false);
  assert.equal(String(search.body.error).includes('ECONNRESET'), false);
});
