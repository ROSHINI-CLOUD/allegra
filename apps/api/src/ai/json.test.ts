import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJson } from './json.js';

test('parses a bare JSON array', () => {
  assert.deepEqual(extractJson<string[]>('["a", "b"]'), ['a', 'b']);
});

test('parses JSON wrapped in a markdown code fence with commentary around it', () => {
  const text = 'Sure, here you go:\n```json\n{"queries": ["lofi", "arijit singh"]}\n```\nHope that helps!';
  assert.deepEqual(extractJson<{ queries: string[] }>(text), { queries: ['lofi', 'arijit singh'] });
});

test('returns null for text with no JSON at all, instead of throwing', () => {
  assert.equal(extractJson('sorry, I cannot help with that'), null);
});

test('returns null for malformed JSON instead of throwing', () => {
  assert.equal(extractJson('{"broken": '), null);
});
