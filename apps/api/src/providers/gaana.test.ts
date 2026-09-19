import assert from 'node:assert/strict';
import test from 'node:test';

import { BROWSER_HEADERS } from './saavn.js';
import { GaanaProvider } from './gaana.js';

test('Gaana search uses browser headers and does not throw on failure', async () => {
  let headers: HeadersInit | undefined;
  const provider = new GaanaProvider({
    baseUrl: 'https://gaana.example/api',
    fetchImpl: async (_input, init) => {
      headers = init?.headers;
      throw new Error('network');
    }
  });

  const result = await provider.search('empty');
  assert.equal(result.ok, false);
  assert.deepEqual(result.data, []);
  assert.deepEqual(headers, BROWSER_HEADERS);
});
