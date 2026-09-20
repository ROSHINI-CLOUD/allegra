import assert from 'node:assert/strict';
import test from 'node:test';

import { isOwnedCoverKey, publicCoverUrl, withCoverUrl } from './covers.js';

test('owned cover keys must sit under covers/<userId>/<libraryId>/', () => {
  const key = 'covers/user-1/lib-1/11111111-1111-4111-8111-111111111111.jpg';
  assert.equal(isOwnedCoverKey(key, 'user-1', 'lib-1'), true);
  assert.equal(isOwnedCoverKey(key, 'user-2', 'lib-1'), false);
  assert.equal(isOwnedCoverKey('covers/user-1/lib-1/../other.jpg', 'user-1', 'lib-1'), false);
  assert.equal(isOwnedCoverKey('/covers/user-1/lib-1/x.jpg', 'user-1', 'lib-1'), false);
});

test('withCoverUrl derives a public URL and never invents one without a key', () => {
  const library = {
    id: 'lib-1',
    name: 'Later',
    isPublic: false,
    songIds: [],
    createdAt: '2026-09-21T00:00:00.000Z',
    coverKey: 'covers/user-1/lib-1/11111111-1111-4111-8111-111111111111.jpg',
    coverUrl: 'https://stale.example/old.jpg'
  };
  assert.equal(
    withCoverUrl(library, 'https://cdn.example').coverUrl,
    'https://cdn.example/covers/user-1/lib-1/11111111-1111-4111-8111-111111111111.jpg'
  );
  const { coverKey: _drop, ...withoutKey } = library;
  void _drop;
  assert.equal(withCoverUrl(withoutKey, 'https://cdn.example').coverUrl, undefined);
  assert.equal(publicCoverUrl('https://cdn.example/', 'covers/a.jpg'), 'https://cdn.example/covers/a.jpg');
});
