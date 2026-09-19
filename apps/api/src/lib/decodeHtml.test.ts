import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeHtml } from './decodeHtml.js';

test('decodeHtml handles named, decimal, and hex entities', () => {
  assert.equal(decodeHtml('&quot;A&amp;B&quot;'), '"A&B"');
  assert.equal(decodeHtml('It&#39;s'), "It's");
  assert.equal(decodeHtml('It&#x27;s'), "It's");
  assert.equal(decodeHtml('keep &unknown;'), 'keep &unknown;');
});
