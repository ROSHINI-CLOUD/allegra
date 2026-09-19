import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from './app.js';

test('GET /api/health returns the App Runner health contract', async () => {
  const response = await request(
    createApp({ version: 'test-version', allowedOrigin: 'http://localhost:5173' })
  ).get('/api/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true, version: 'test-version' });
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.equal(
    response.headers['access-control-allow-origin'],
    'http://localhost:5173'
  );
});
