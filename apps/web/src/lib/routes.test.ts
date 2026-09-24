import assert from 'node:assert/strict';
import test from 'node:test';

import { legacyHashToPath, parseRoute, paths } from './routes.ts';

test('every static view has a path that parses back to it', () => {
  for (const view of ['discover', 'library', 'liked', 'album', 'settings'] as const) {
    assert.equal(parseRoute(`/${view}`).view, view);
  }
  assert.equal(parseRoute(paths.settings).view, 'settings');
  assert.equal(parseRoute('/').view, 'home');
  assert.equal(parseRoute('/nonsense').view, 'home');
});

test('artist, playlist and shared routes round-trip awkward names', () => {
  assert.deepEqual(parseRoute(paths.artist('A. R. Rahman & Co/1')), {
    view: 'artist', artistName: 'A. R. Rahman & Co/1', playlistId: null, sharedCode: null
  });
  assert.equal(parseRoute(paths.playlist('lib 42')).playlistId, 'lib 42');
  assert.equal(parseRoute(paths.shared('AbC123')).sharedCode, 'abc123');
});

test('missing or malformed params fall back to a safe view', () => {
  assert.equal(parseRoute('/artist').view, 'home');
  assert.equal(parseRoute('/artist/%E0%A4%A').view, 'home');
  assert.equal(parseRoute('/playlist').view, 'library');
  assert.equal(parseRoute('/shared/').view, 'home');
});

test('old hash links redirect to real paths', () => {
  assert.equal(legacyHashToPath('#shared/abc'), '/shared/abc');
  assert.equal(legacyHashToPath('#artist/Arijit%20Singh'), '/artist/Arijit%20Singh');
  assert.equal(legacyHashToPath('#library'), '/library');
  assert.equal(legacyHashToPath('#home'), '/');
  assert.equal(legacyHashToPath('#main-content'), null);
  assert.equal(legacyHashToPath('#artist'), null);
  assert.equal(legacyHashToPath(''), null);
});
