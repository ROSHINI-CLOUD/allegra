import assert from 'node:assert/strict';
import test from 'node:test';

import { BetterLyricsProvider, ttmlToLrc } from './betterlyrics.js';

const TTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
<p begin="0:11.180" end="0:13.740"><span begin="0:11.180" end="0:11.900">Ishq</span> <span begin="0:11.900" end="0:12.500">mein</span> <span ttm:role="x-translation">In love</span></p>
<p begin="1:02.5" end="1:05">Dil &amp; jaan</p>
<p begin="00:01:10.000" end="00:01:12.000">   </p>
</div></body></tt>`;

test('ttmlToLrc joins word spans, decodes entities and drops translations', () => {
  assert.equal(ttmlToLrc(TTML), '[00:11.18] Ishq mein\n[01:02.50] Dil & jaan');
});

test('ttmlToLrc returns null when there are fewer than two timed lines', () => {
  assert.equal(ttmlToLrc('<tt><body><p begin="1.0">only one</p></body></tt>'), null);
  assert.equal(ttmlToLrc('not xml at all'), null);
});

test('provider sends song, artist and duration, plus the key when configured', async () => {
  const seen: Array<{ url: string; key: string | null }> = [];
  const provider = new BetterLyricsProvider({
    baseUrl: 'https://better.test',
    apiKey: 'secret-key',
    fetchImpl: async (input, init) => {
      seen.push({ url: String(input), key: new Headers(init?.headers).get('x-api-key') });
      return new Response(JSON.stringify({ ttml: TTML }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  const track = await provider.find('Chaleya', 'Anirudh Ravichander', 267.4);
  assert.equal(track?.source, 'BetterLyrics');
  assert.ok(track?.lyrics.startsWith('[00:11.18]'));
  assert.equal(seen[0]?.key, 'secret-key');
  assert.ok(seen[0]?.url.includes('/getLyrics?'));
  assert.ok(seen[0]?.url.includes('s=Chaleya'));
  assert.ok(seen[0]?.url.includes('d=267'));
});

test('401, 404, network errors and malformed bodies all resolve to null', async () => {
  const build = (fetchImpl: typeof fetch) => new BetterLyricsProvider({ baseUrl: 'https://better.test', fetchImpl });
  assert.equal(await build(async () => new Response('{"error":"API key required"}', { status: 401 })).find('a', 'b', undefined), null);
  assert.equal(await build(async () => new Response('', { status: 404 })).find('a', 'b', undefined), null);
  assert.equal(await build(async () => { throw new Error('offline'); }).find('a', 'b', undefined), null);
  assert.equal(await build(async () => new Response('{"ttml":42}', { status: 200 })).find('a', 'b', undefined), null);
});
