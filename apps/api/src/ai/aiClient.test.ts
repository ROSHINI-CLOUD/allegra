import assert from 'node:assert/strict';
import test from 'node:test';

import { AiClient } from './aiClient.js';
import type { AiProvider } from './types.js';

function fakeProvider(name: string, response: string | null | 'throw'): AiProvider {
  return {
    name,
    async complete() {
      if (response === 'throw') throw new Error('boom');
      return response;
    }
  };
}

test('the first provider to return text wins', async () => {
  const client = new AiClient([fakeProvider('a', null), fakeProvider('b', 'hello'), fakeProvider('c', 'unreachable')]);
  assert.deepEqual(await client.complete('prompt'), { text: 'hello', provider: 'b' });
});

test('an empty provider list is reported as unconfigured and returns null without calling anything', async () => {
  const client = new AiClient([]);
  assert.equal(client.isConfigured, false);
  assert.equal(await client.complete('prompt'), null);
});

test('a provider throwing is treated as a miss, not a crash, and the next provider still runs', async () => {
  const client = new AiClient([fakeProvider('a', 'throw'), fakeProvider('b', 'recovered')]);
  assert.deepEqual(await client.complete('prompt'), { text: 'recovered', provider: 'b' });
});

test('all providers failing returns null instead of throwing', async () => {
  const client = new AiClient([fakeProvider('a', null), fakeProvider('b', '')]);
  assert.equal(await client.complete('prompt'), null);
});

test('maxAttempts stops the cascade before later providers are billed', async () => {
  let cCalls = 0;
  const client = new AiClient(
    [
      fakeProvider('a', null),
      fakeProvider('b', null),
      {
        name: 'c',
        async complete() {
          cCalls += 1;
          return 'should-not-run';
        }
      }
    ],
    { maxAttempts: 2 }
  );
  assert.equal(await client.complete('prompt'), null);
  assert.equal(cCalls, 0);
});
