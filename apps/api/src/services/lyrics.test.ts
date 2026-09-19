import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../lib/cache.js';
import { LrclibProvider } from '../providers/lrclib.js';
import { LyricsService, cleanLyricsQuery } from './lyrics.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('lyrics query cleaning strips decorations and splits artist-title', () => {
  assert.deepEqual(
    cleanLyricsQuery('Song (Lyrics) (Official Video) (Audio)', 'Unknown Artist'),
    { title: 'Song', artist: 'Unknown Artist' }
  );
  assert.deepEqual(
    cleanLyricsQuery('Artist Name - Track Title', 'Unknown Artist'),
    { title: 'Track Title', artist: 'Artist Name' }
  );
});

test('LRCLIB /get is tried before /search and duration is forwarded', async () => {
  const urls: string[] = [];
  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        urls.push(String(input));
        return json({
          trackName: 'Night Drive',
          syncedLyrics: '[00:01.00] go\n[00:02.00] further\n[00:03.00] now\n[00:04.00] stay\n[00:05.00] here\n[00:06.00] with\n[00:07.00] me\n[00:08.00] until\n[00:09.00] dawn\n[00:10.00] light',
          duration: 200
        });
      }
    }),
    new MemoryCacheStore()
  );

  const payload = await service.find('Night Drive', 'Driver', 200, false);
  assert.equal(payload?.type, 'synced');
  assert.equal(payload?.source, 'LRCLIB');
  assert.ok((payload?.lines.length ?? 0) >= 10);
  assert.ok(urls[0]?.includes('/get?'));
  assert.ok(urls[0]?.includes('duration=200'));
  assert.equal(urls.some((url) => url.includes('/search?')), false);
});

test('404 and HTML bodies fall through to search', async () => {
  const urls: string[] = [];
  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes('/get?')) {
          if (urls.filter((item) => item.includes('/get?')).length === 1) {
            return json({}, 404);
          }
          return json({ trackName: 'x', syncedLyrics: '<html><div>error</div></html>' });
        }
        return json([{
          trackName: 'Night Drive',
          syncedLyrics: '[0:3.75]Hello\n[00:10.25]World',
          duration: 200
        }]);
      }
    }),
    new MemoryCacheStore()
  );

  const from404 = await service.find('Night Drive', 'Driver', 200, false);
  assert.equal(from404?.source, 'LRCLIB-search');
  assert.equal(from404?.lines[0]?.text, 'Hello');

  const fromHtml = await service.find('Other', 'Driver', 200, false);
  assert.equal(fromHtml?.source, 'LRCLIB-search');
  assert.ok(urls.filter((url) => url.includes('/search?')).length >= 2);
});

test('plain lyrics interpolate and syncedOnly ignores unsynced hits', async () => {
  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        if (String(input).includes('/get?')) {
          return json({}, 404);
        }
        return json([{ trackName: 'Night Drive', plainLyrics: 'one\ntwo\nthree', duration: 90 }]);
      }
    }),
    new MemoryCacheStore()
  );

  const plain = await service.find('Night Drive', 'Driver', 90, false);
  assert.equal(plain?.type, 'plain');
  assert.equal(plain?.source, 'interpolated');
  assert.deepEqual(plain?.lines.map((line) => line.timestamp), [0, 30, 60]);

  const syncedOnly = await service.find('Night Drive', 'Driver', 90, true);
  assert.equal(syncedOnly, null);
});

test('positive hits cache for 30 days and misses cache for 24 hours', async () => {
  const sets: Array<{ key: string; ttl: number }> = [];
  const cache = new MemoryCacheStore();
  const originalSet = cache.set.bind(cache);
  cache.set = async (key, value, ttl) => {
    sets.push({ key, ttl });
    return originalSet(key, value, ttl);
  };

  const service = new LyricsService(
    new LrclibProvider({
      baseUrl: 'https://lrclib.test/api',
      fetchImpl: async (input) => {
        if (String(input).includes('miss')) {
          return json({}, 404);
        }
        if (String(input).includes('/get?')) {
          return json({ trackName: 'Hit', syncedLyrics: '[00:01.00] a', duration: 10 });
        }
        return json([]);
      }
    }),
    cache
  );

  await service.find('Hit', 'Artist', 10, false);
  await service.find('miss song', 'Artist', 10, false);

  assert.equal(sets.some((entry) => entry.ttl === 2_592_000), true);
  assert.equal(sets.some((entry) => entry.key.includes('miss') && entry.ttl === 86_400), true);
});
