import assert from 'node:assert/strict';
import test from 'node:test';

import { artistMatchScore, bestArtistMatch } from './artistMatch.ts';

test('a first name matches the artist it belongs to', () => {
  assert.ok(artistMatchScore('Anirudh Ravichander', 'anirudh') >= 60);
  assert.equal(artistMatchScore('Shilpa Rao', 'anirudh'), 0);
});

test('the whole name beats a first name', () => {
  assert.ok(
    artistMatchScore('Anirudh Ravichander', 'anirudh ravichander') >
      artistMatchScore('Anirudh Ravichander', 'anirudh')
  );
});

test('a typo-length prefix still matches', () => {
  assert.ok(artistMatchScore('Anirudh Ravichander', 'anirud') >= 60);
});

test('punctuation and case do not matter', () => {
  assert.ok(artistMatchScore('A.R. Rahman', 'ar rahman') >= 60);
});

test('the matching artist is featured and the rest keep their order', () => {
  const artists = [{ name: 'Kumaar' }, { name: 'Anirudh Ravichander' }, { name: 'Arijit Singh' }];
  const { feature, rest } = bestArtistMatch(artists, 'anirudh');
  assert.equal(feature?.name, 'Anirudh Ravichander');
  assert.deepEqual(rest.map((artist) => artist.name), ['Kumaar', 'Arijit Singh']);
});

test('a query about no one in the list features nobody', () => {
  const artists = [{ name: 'Kumaar' }, { name: 'Arijit Singh' }];
  const { feature, rest } = bestArtistMatch(artists, 'late night');
  assert.equal(feature, null);
  assert.equal(rest.length, 2);
});

test('a bare substring is not enough to claim the hero slot', () => {
  // "ram" appears inside "Rammstein" but the search was not about them.
  assert.ok(artistMatchScore('Rammstein', 'ram') < 60);
});
