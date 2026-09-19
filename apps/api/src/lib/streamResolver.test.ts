import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import type { Response as ExpressResponse } from 'express';

import { MemoryCacheStore } from './cache.js';
import { ProviderUnavailableError } from './errors.js';
import { StreamResolver } from './streamResolver.js';
import { SaavnProvider, type SaavnSong } from '../providers/saavn.js';

const song: SaavnSong = {
  id: 'song-1',
  name: 'Test Song',
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/song.mp4' }]
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeResponse(): ExpressResponse & { readonly headerMap: Map<string, string> } {
  const stream = new PassThrough();
  const headerMap = new Map<string, string>();
  Object.assign(stream, {
    statusCode: 0,
    headerMap,
    status(code: number) {
      (stream as PassThrough & { statusCode: number }).statusCode = code;
      return stream;
    },
    setHeader(name: string, value: string) {
      headerMap.set(name.toLowerCase(), value);
      return stream;
    },
    getHeader(name: string) {
      return headerMap.get(name.toLowerCase());
    }
  });
  return stream as unknown as ExpressResponse & { readonly headerMap: Map<string, string> };
}

test('Range requests preserve 206 and required headers and forward the exact Range', async () => {
  const requested: string[] = [];
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async (input) => {
        requested.push(`meta:${String(input)}`);
        return json({ success: true, data: song });
      }
    }),
    fetchImpl: async (input, init) => {
      requested.push(`cdn:${String(input)}:${new Headers(init?.headers).get('range')}`);
      return new Response('audio-bytes', {
        status: 206,
        headers: {
          'content-type': 'audio/mp4',
          'content-length': '11',
          'content-range': 'bytes 0-10/100',
          'accept-ranges': 'bytes'
        }
      });
    }
  });

  const response = fakeResponse();
  await resolver.pipe('song-1', 'bytes=0-10', response);
  assert.equal(response.statusCode, 206);
  assert.equal(response.headerMap.get('content-range'), 'bytes 0-10/100');
  assert.equal(response.headerMap.get('accept-ranges'), 'bytes');
  assert.equal(response.headerMap.get('content-type'), 'audio/mp4');
  assert.equal(response.headerMap.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(requested.at(-1), 'cdn:https://cdn.example/song.mp4:bytes=0-10');
});

test('no Range request returns 200', async () => {
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => json({ success: true, data: song })
    }),
    fetchImpl: async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('range'), null);
      return new Response('full-audio', {
        status: 200,
        headers: { 'content-type': 'audio/mp4', 'content-length': '10', 'accept-ranges': 'bytes' }
      });
    }
  });
  const response = fakeResponse();
  await resolver.pipe('song-1', undefined, response);
  assert.equal(response.statusCode, 200);
});

test('403 causes exactly one forced URL refresh', async () => {
  let songCalls = 0;
  let cdnCalls = 0;
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => {
        songCalls += 1;
        return json({
          success: true,
          data: {
            ...song,
            downloadUrl: [{ quality: '320kbps', url: `https://cdn.example/song-${songCalls}.mp4` }]
          }
        });
      }
    }),
    fetchImpl: async () => {
      cdnCalls += 1;
      if (cdnCalls === 1) {
        return new Response('expired', { status: 403 });
      }
      return new Response('audio-bytes', {
        status: 206,
        headers: { 'content-range': 'bytes 0-10/100', 'accept-ranges': 'bytes', 'content-type': 'audio/mp4' }
      });
    }
  });

  const response = fakeResponse();
  await resolver.pipe('song-1', 'bytes=0-10', response);
  assert.equal(songCalls, 2);
  assert.equal(cdnCalls, 2);
  assert.equal(response.statusCode, 206);
});

test('private stream URLs are rejected instead of being fetched', async () => {
  let cdnCalls = 0;
  const resolver = new StreamResolver({
    cache: new MemoryCacheStore(),
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => json({
        success: true,
        data: { ...song, downloadUrl: [{ quality: '320kbps', url: 'https://127.0.0.1/secret.mp4' }] }
      })
    }),
    fetchImpl: async () => {
      cdnCalls += 1;
      return new Response('nope');
    }
  });

  await assert.rejects(() => resolver.pipe('song-1', undefined, fakeResponse()), ProviderUnavailableError);
  assert.equal(cdnCalls, 0);
});
