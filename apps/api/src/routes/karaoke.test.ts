import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from '../app.js';
import { MemoryCacheStore } from '../lib/cache.js';
import { createServices } from '../services.js';

test('karaoke routes answer 503 when AWS Batch karaoke is not configured', async () => {
  const app = createApp({
    version: 'test',
    jwtSecret: 'test-secret-at-least-16',
    rateLimit: false,
    services: createServices({
      jwtSecret: 'test-secret-at-least-16',
      cacheStore: new MemoryCacheStore(),
      saavnApiUrl: 'https://example.invalid/api',
      gaanaApiUrl: 'https://example.invalid/api'
    })
  });

  const get = await request(app).get('/api/songs/song-1/karaoke');
  assert.equal(get.status, 503);
  assert.equal(get.body.success, false);

  const post = await request(app).post('/api/songs/song-1/karaoke');
  assert.equal(post.status, 503);
});
