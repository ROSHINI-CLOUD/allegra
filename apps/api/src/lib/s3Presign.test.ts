import assert from 'node:assert/strict';
import test from 'node:test';

import { presignPutUrl } from './s3Presign.js';

const base = {
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  bucket: 'allegra-covers',
  key: 'covers/user-1/abc.jpg',
  contentType: 'image/jpeg',
  contentLength: 1024,
  expiresInSeconds: 120,
  now: new Date('2026-09-21T10:30:00Z')
};

test('presigns a PUT against the bucket virtual host with every required query parameter', () => {
  const url = new URL(presignPutUrl(base));
  assert.equal(url.host, 'allegra-covers.s3.us-east-1.amazonaws.com');
  assert.equal(url.pathname, '/covers/user-1/abc.jpg');
  assert.equal(url.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(url.searchParams.get('X-Amz-Credential'), 'AKIAIOSFODNN7EXAMPLE/20260921/us-east-1/s3/aws4_request');
  assert.equal(url.searchParams.get('X-Amz-Date'), '20260921T103000Z');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '120');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'content-length;content-type;host');
  assert.match(url.searchParams.get('X-Amz-Signature') ?? '', /^[0-9a-f]{64}$/);
});

test('the signed query string is in the sorted order S3 recomputes it in', () => {
  const query = presignPutUrl(base).split('?')[1]?.split('&').map((pair) => pair.split('=')[0]) ?? [];
  // X-Amz-Signature is appended after signing, so only the first five are signed.
  assert.deepEqual(query, [
    'X-Amz-Algorithm',
    'X-Amz-Credential',
    'X-Amz-Date',
    'X-Amz-Expires',
    'X-Amz-SignedHeaders',
    'X-Amz-Signature'
  ]);
});

test('the same inputs always produce the same signature', () => {
  assert.equal(presignPutUrl(base), presignPutUrl(base));
});

test('content type and content length are part of the signature, not just advice', () => {
  const signature = (url: string) => new URL(url).searchParams.get('X-Amz-Signature');
  const original = signature(presignPutUrl(base));
  assert.notEqual(original, signature(presignPutUrl({ ...base, contentType: 'image/png' })));
  assert.notEqual(original, signature(presignPutUrl({ ...base, contentLength: 2048 })));
  assert.notEqual(original, signature(presignPutUrl({ ...base, key: 'covers/user-1/other.jpg' })));
});

test('key segments are percent-encoded but the separating slashes are kept', () => {
  const url = new URL(presignPutUrl({ ...base, key: 'covers/user 1/a+b(c).jpg' }));
  assert.equal(url.pathname, '/covers/user%201/a%2Bb%28c%29.jpg');
});
