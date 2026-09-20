import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BROWSER_HEADERS,
  SaavnProvider,
  type SaavnSong
} from './saavn.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const song: SaavnSong = {
  id: 'song-1',
  name: 'Test Song',
  duration: 245,
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
};

test('Saavn search uses the songs endpoint, query params, and browser headers', async () => {
  let requestedUrl = '';
  let requestedHeaders: HeadersInit | undefined;

  const provider = new SaavnProvider({
    baseUrl: 'https://saavn.example/api/',
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = init?.headers;
      return response({ success: true, data: { results: [song] } });
    }
  });

  const result = await provider.search('test song', 7, 2);

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, [song]);
  assert.equal(
    requestedUrl,
    'https://saavn.example/api/search/songs?query=test+song&limit=7&page=2'
  );
  assert.deepEqual(requestedHeaders, BROWSER_HEADERS);
});

test('Saavn song and suggestions calls parse their response shapes', async () => {
  const requestedUrls: string[] = [];
  const provider = new SaavnProvider({
    baseUrl: 'https://saavn.example/api',
    fetchImpl: async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith('/suggestions?limit=4')) {
        return response({ success: true, data: { results: [song] } });
      }
      return response({ success: true, data: song });
    }
  });

  const hydrated = await provider.getSong('song/1');
  const suggestions = await provider.getSuggestions('song/1', 4);

  assert.deepEqual(hydrated.data, song);
  assert.deepEqual(suggestions.data, [song]);
  assert.deepEqual(requestedUrls, [
    'https://saavn.example/api/songs/song%2F1',
    'https://saavn.example/api/songs/song%2F1/suggestions?limit=4'
  ]);
});

test('Saavn accepts live song and suggestion payloads with data arrays', async () => {
  const provider = new SaavnProvider({
    baseUrl: 'https://saavn.example/api',
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.includes('/suggestions')) {
        return response({ success: true, data: [song] });
      }
      return response({ success: true, data: [song] });
    }
  });

  const result = await provider.getSong('song-1');
  const suggestions = await provider.getSuggestions('song-1');
  assert.equal(result.data?.id, 'song-1');
  assert.equal(suggestions.data[0]?.id, 'song-1');
});

test('provider failures are isolated and preserve an error status for the catalog', async () => {
  const provider = new SaavnProvider({
    baseUrl: 'https://saavn.example/api',
    fetchImpl: async () => {
      throw new Error('upstream unavailable');
    }
  });

  const result = await provider.search('test');

  assert.equal(result.ok, false);
  assert.deepEqual(result.data, []);
});

test('4xx, 5xx, malformed JSON, and network failures do not throw', async () => {
  for (const fetchImpl of [
    async () => response({ success: false }, 404),
    async () => response({ success: false }, 500),
    async () => new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } }),
    async () => {
      throw new Error('network down');
    }
  ]) {
    const provider = new SaavnProvider({ baseUrl: 'https://saavn.example/api', fetchImpl });
    const result = await provider.search('test');
    assert.equal(result.ok, false);
    assert.deepEqual(result.data, []);
  }
});

test('provider requests abort at the configured timeout', async () => {
  let aborted = false;
  const provider = new SaavnProvider({
    baseUrl: 'https://saavn.example/api',
    timeoutMs: 5,
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      })
  });

  const result = await provider.search('slow');

  assert.equal(result.ok, false);
  assert.equal(aborted, true);
});
