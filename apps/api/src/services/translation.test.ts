import assert from 'node:assert/strict';
import test from 'node:test';

import { AiClient } from '../ai/aiClient.js';
import type { AiProvider } from '../ai/types.js';
import { MemoryCacheStore } from '../lib/cache.js';
import { TranslationService } from './translation.js';

function fakeProvider(reply: string): AiProvider {
  return { name: 'fake', async complete() { return reply; } };
}

const lines = [
  { timestamp: 0, text: 'तू अगर मेरी', lineOrder: 0 },
  { timestamp: 5, text: '[INSTRUMENTAL]', lineOrder: 1 },
  { timestamp: 10, text: 'गहरा हुआ', lineOrder: 2 }
];

test('translates non-instrumental lines and preserves timestamps, order, and instrumental markers', async () => {
  const service = new TranslationService(new AiClient([fakeProvider(JSON.stringify(['If you are mine', null, 'It grew deeper']))]), new MemoryCacheStore());
  const result = await service.translate(lines, 'Gehra Hua', 'Arijit Singh');
  assert.ok(result);
  assert.equal(result.provider, 'fake');
  assert.deepEqual(result.lines.map((line) => line.text), ['If you are mine', '[INSTRUMENTAL]', 'It grew deeper']);
  assert.deepEqual(result.lines.map((line) => line.timestamp), [0, 5, 10]);
});

test('a response with the wrong number of lines is rejected rather than silently misaligning the lyrics', async () => {
  const service = new TranslationService(new AiClient([fakeProvider(JSON.stringify(['only one line']))]), new MemoryCacheStore());
  assert.equal(await service.translate(lines, 'Gehra Hua', 'Arijit Singh'), null);
});

test('no configured provider means unavailable, and translate never calls out at all', async () => {
  const service = new TranslationService(new AiClient([]), new MemoryCacheStore());
  assert.equal(service.isAvailable, false);
  assert.equal(await service.translate(lines, 'Gehra Hua', 'Arijit Singh'), null);
});

test('a second call for the same song is served from cache, not a second AI call', async () => {
  let calls = 0;
  const provider: AiProvider = { name: 'fake', async complete() { calls += 1; return JSON.stringify(['a', null, 'b']); } };
  const service = new TranslationService(new AiClient([provider]), new MemoryCacheStore());
  await service.translate(lines, 'Gehra Hua', 'Arijit Singh');
  await service.translate(lines, 'Gehra Hua', 'Arijit Singh');
  assert.equal(calls, 1);
});

test('a failed translate is negatively cached so Bedrock is not re-hit immediately', async () => {
  let calls = 0;
  const provider: AiProvider = { name: 'fake', async complete() { calls += 1; return 'not json'; } };
  const service = new TranslationService(new AiClient([provider]), new MemoryCacheStore());
  assert.equal(await service.translate(lines, 'Gehra Hua', 'Arijit Singh'), null);
  assert.equal(await service.translate(lines, 'Gehra Hua', 'Arijit Singh'), null);
  assert.equal(calls, 1);
});
