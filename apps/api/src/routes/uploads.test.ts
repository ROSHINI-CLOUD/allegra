import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';

import { createApp } from '../app.js';

const uploads = {
  bucket: 'allegra-covers',
  region: 'us-east-1',
  publicBaseUrl: 'https://covers.example',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  expiresInSeconds: 120
};

function appWithUploads() {
  return createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    lrclibApiUrl: 'https://lrclib.test/api',
    rateLimit: false,
    allowedOrigin: 'http://localhost:5173',
    uploads,
    fetchImpl: async () => new Response(JSON.stringify({ success: true, data: { results: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  });
}

async function authedLibrary() {
  const server = appWithUploads();
  const auth = await request(server).post('/api/auth/anon');
  const token = auth.body.data.token as string;
  const created = await request(server)
    .post('/api/libraries')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Covers' });
  return { server, token, libraryId: created.body.data.id as string, userId: auth.body.data.userId as string };
}

test('POST /api/uploads/sign returns a presigned PUT URL and owned coverKey', async () => {
  const { server, token, libraryId, userId } = await authedLibrary();
  const signed = await request(server)
    .post('/api/uploads/sign')
    .set('Authorization', `Bearer ${token}`)
    .send({ libraryId, contentType: 'image/jpeg', contentLength: 2048 });

  assert.equal(signed.status, 200);
  assert.equal(signed.body.success, true);
  assert.match(signed.body.data.uploadUrl, /^https:\/\/allegra-covers\.s3\.us-east-1\.amazonaws\.com\//);
  assert.match(signed.body.data.coverKey, new RegExp(`^covers/${userId}/${libraryId}/[0-9a-f-]{36}\\.jpg$`));
  assert.equal(signed.body.data.coverUrl, `https://covers.example/${signed.body.data.coverKey}`);
  assert.equal(signed.body.data.headers['Content-Type'], 'image/jpeg');
  assert.equal(signed.body.data.headers['Content-Length'], '2048');
  assert.equal(signed.body.data.expiresInSeconds, 120);
});

test('POST /api/uploads/sign rejects bad types and oversized files', async () => {
  const { server, token, libraryId } = await authedLibrary();
  const badType = await request(server)
    .post('/api/uploads/sign')
    .set('Authorization', `Bearer ${token}`)
    .send({ libraryId, contentType: 'image/gif', contentLength: 100 });
  assert.equal(badType.status, 400);

  const tooBig = await request(server)
    .post('/api/uploads/sign')
    .set('Authorization', `Bearer ${token}`)
    .send({ libraryId, contentType: 'image/png', contentLength: 3 * 1024 * 1024 });
  assert.equal(tooBig.status, 400);
});

test('PATCH /api/libraries/:id accepts a signed coverKey and derives coverUrl', async () => {
  const { server, token, libraryId, userId } = await authedLibrary();
  const coverKey = `covers/${userId}/${libraryId}/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.webp`;
  const patched = await request(server)
    .patch(`/api/libraries/${libraryId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ coverKey });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.data.coverKey, coverKey);
  assert.equal(patched.body.data.coverUrl, `https://covers.example/${coverKey}`);

  const cleared = await request(server)
    .patch(`/api/libraries/${libraryId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ coverKey: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.data.coverKey, undefined);
  assert.equal(cleared.body.data.coverUrl, undefined);
});

test('PATCH rejects a coverKey that does not belong to this library', async () => {
  const { server, token, libraryId } = await authedLibrary();
  const rejected = await request(server)
    .patch(`/api/libraries/${libraryId}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ coverKey: 'covers/other-user/other-lib/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.jpg' });
  assert.equal(rejected.status, 400);
});

test('POST /api/uploads/sign is 503 when uploads are not configured', async () => {
  const server = createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    lrclibApiUrl: 'https://lrclib.test/api',
    rateLimit: false
  });
  const auth = await request(server).post('/api/auth/anon');
  const response = await request(server)
    .post('/api/uploads/sign')
    .set('Authorization', `Bearer ${auth.body.data.token}`)
    .send({ libraryId: 'x', contentType: 'image/jpeg', contentLength: 100 });
  assert.equal(response.status, 503);
  assert.equal(response.body.success, false);
});
