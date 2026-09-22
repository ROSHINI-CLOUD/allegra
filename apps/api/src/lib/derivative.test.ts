import assert from 'node:assert/strict';
import test from 'node:test';

import { derivativeKind, isDerivative, queryWantsDerivative } from './derivative.js';

test('the edits that outrank an original on a real search are all recognised', () => {
  // Every one of these is a row Saavn returned for "another love", above or beside
  // Tom Odell's own recording.
  assert.equal(derivativeKind('Another Love (Tom Odell) (slowed down)', 'sped up + slowed'), 'speed');
  assert.equal(derivativeKind('another love (slowed + reverb)', 'slowed + reverb viral audios'), 'speed');
  assert.equal(derivativeKind('Another Love (Tiësto Remix)', 'Tom Odell, Tiësto'), 'remix');
  assert.equal(derivativeKind('Another Love (Piano Version)', 'Flying Fingers'), 'cover');
  assert.equal(derivativeKind('Another Love', 'Lofi Fruits Music, Chill Fruits Music'), 'speed');
});

test('an original recording is not mistaken for an edit', () => {
  assert.equal(derivativeKind('Another Love', 'Tom Odell'), null);
  assert.equal(derivativeKind('Tum Hi Ho', 'Mithoon, Arijit Singh'), null);
  assert.equal(derivativeKind('Saiyaara', 'Tanishk Bagchi, Faheem Abdullah'), null);
});

test('a marker in the bare title is not enough — only a qualifier or the artist counts', () => {
  // The words are real song titles. Demoting these would be worse than the bug.
  assert.equal(derivativeKind('Live and Let Die', 'Wings'), null);
  assert.equal(derivativeKind('Cover Me', 'Bruce Springsteen'), null);
  assert.equal(derivativeKind('Reverb', 'Some Band'), null);
  assert.equal(derivativeKind('Slow Hands', 'Niall Horan'), null);
  // The same words inside a qualifier do count.
  assert.equal(derivativeKind('Let It Be (Live at Wembley)', 'The Beatles'), 'live');
});

test('a dash introduces a qualifier the same way brackets do', () => {
  assert.equal(derivativeKind('Heal - Live from Abbey Road', 'Tom Odell'), 'live');
  assert.equal(derivativeKind('Heal - Sped Up', 'Tom Odell'), 'speed');
  // A dash inside the name itself is not a qualifier.
  assert.equal(derivativeKind('Jack-in-the-Box', 'Artist'), null);
});

test('asking for an edit is not the same as being one', () => {
  assert.equal(queryWantsDerivative('another love slowed'), true);
  assert.equal(queryWantsDerivative('bohemian rhapsody karaoke'), true);
  assert.equal(queryWantsDerivative('tiesto remix'), true);
  assert.equal(queryWantsDerivative('another love'), false);
  assert.equal(queryWantsDerivative('tom odell'), false);
});

test('isDerivative reads a song row', () => {
  assert.equal(isDerivative({ title: 'Another Love (slowed)', artist: 'x' }), true);
  assert.equal(isDerivative({ title: 'Another Love', artist: 'Tom Odell' }), false);
});
