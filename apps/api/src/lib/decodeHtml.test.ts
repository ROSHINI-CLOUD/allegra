import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeHtml, repairMojibake } from './decodeHtml.js';

test('decodeHtml handles named, decimal, and hex entities', () => {
  assert.equal(decodeHtml('&quot;A&amp;B&quot;'), '"A&B"');
  assert.equal(decodeHtml('It&#39;s'), "It's");
  assert.equal(decodeHtml('It&#x27;s'), "It's");
  assert.equal(decodeHtml('keep &unknown;'), 'keep &unknown;');
});

test('repairMojibake restores double-encoded quotes and dashes', () => {
  assert.equal(repairMojibake('said, \u00e2\u20ac\u0153hi\u00e2\u20ac\u009d \u00e2\u20ac\u2122s'), 'said, \u201chi\u201d \u2019s');
  assert.equal(repairMojibake('plain text'), 'plain text');
});
