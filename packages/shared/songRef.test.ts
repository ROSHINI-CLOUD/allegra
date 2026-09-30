import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fromAllegraSong,
  fromMobileId,
  leadArtist,
  matchKey,
  parseSongRef,
  songRef,
  toAllegraId,
  toMobileId
} from './songRef.ts';

test('a catalog song keeps one ref across Allegra and the phone', () => {
  const ref = fromAllegraSong({ id: 'Ab12_x', source: 'Saavn' });
  assert.equal(ref, 'saavn:Ab12_x');
  assert.ok(ref);
  assert.equal(toMobileId(ref), 'stream:saavn:Ab12_x');
  assert.equal(fromMobileId('stream:saavn:Ab12_x'), ref);
  assert.equal(toAllegraId(ref), 'Ab12_x');
});

test('Gaana refs cross devices but do not hydrate by id on Allegra', () => {
  const ref = songRef('Gaana', '991');
  assert.equal(ref, 'gaana:991');
  assert.ok(ref);
  assert.equal(toAllegraId(ref), null);
  assert.equal(fromMobileId('stream:gaana:991'), ref);
});

test('ids that cannot cross devices have no ref', () => {
  assert.equal(songRef('Local', 'x'), null);
  assert.equal(songRef('saavn', ''), null);
  assert.equal(songRef('saavn', 'a:b'), null);
  assert.equal(fromMobileId('5f1c-local-row'), null);
  assert.equal(fromMobileId('stream:wynk:1'), null);
  assert.equal(parseSongRef('nope'), null);
  assert.deepEqual(parseSongRef('SAAVN:q1'), { source: 'saavn', id: 'q1' });
});

test('matchKey finds the same song across releases and credits', () => {
  const key = matchKey("Don't Start Now", 'Dua Lipa');
  assert.equal(matchKey('Dont Start Now (Official Video)', 'Dua Lipa, DaBaby'), key);
  assert.equal(matchKey("DON'T START NOW - Remastered 2021", 'Dua Lipa feat. Someone'), key);
  assert.equal(matchKey('Déjà Vu', 'Olivia Rodrigo'), matchKey('Deja Vu', 'Olivia Rodrigo'));
  assert.notEqual(matchKey('Levitating', 'Dua Lipa'), key);
});

test('leadArtist drops featured artists and the placeholder', () => {
  assert.equal(leadArtist('A.R. Rahman & Shreya Ghoshal'), 'A.R. Rahman');
  assert.equal(leadArtist('Unknown Artist'), '');
  assert.equal(leadArtist(undefined), '');
});
