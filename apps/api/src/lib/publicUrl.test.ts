import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePublicHttpsUrl, parseTrustedProviderUrl } from './publicUrl.js';

test('public https URLs are accepted and private or credentialed URLs are rejected', () => {
  assert.equal(parsePublicHttpsUrl('https://aac.saavncdn.com/song.mp4').hostname, 'aac.saavncdn.com');
  assert.throws(() => parsePublicHttpsUrl('http://aac.saavncdn.com/song.mp4'));
  assert.throws(() => parsePublicHttpsUrl('https://127.0.0.1/song.mp4'));
  assert.throws(() => parsePublicHttpsUrl('https://user:token@cdn.example/song.mp4'));
  assert.throws(() => parsePublicHttpsUrl('https://192.168.1.9/song.mp4'));
});

test('non-production provider URLs may use localhost http', () => {
  assert.equal(parseTrustedProviderUrl('http://localhost:8081/api', false), 'http://localhost:8081/api');
  assert.throws(() => parseTrustedProviderUrl('http://localhost:8081/api', true));
});
