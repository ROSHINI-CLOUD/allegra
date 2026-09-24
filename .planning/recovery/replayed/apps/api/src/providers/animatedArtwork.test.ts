import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryCacheStore } from '../lib/cache.js';
import { CanvasService } from '../services/canvas.js';
import { BoiduArtworkProvider, M8tecArtworkProvider, type CanvasProvider } from './animatedArtwork.js';

test('boidu prefers the direct MP4 and sends duration in whole seconds', async () => {
  let requested = '';
  const provider = new BoiduArtworkProvider({
    baseUrl: 'https://artwork.test/',
    fetchImpl: async (input) => {
      requested = String(input);
      return json({
        artist: 'Frank Ocean',
        animated: 'https://mvod.itunes.apple.com/itunes-assets/master.m3u8',
        videoUrl: 'https://mvod.itunes.apple.com/itunes-assets/best.mp4'
      });
    }
  });

  assert.deepEqual(await provider.find({ title: 'Nights', artist: 'Frank Ocean', album: 'Blonde', duration: 307.4 }), {
    source: 'Apple Music',
    videoUrl: 'https://mvod.itunes.apple.com/itunes-assets/best.mp4'
  });
  const url = new URL(requested);
  assert.equal(url.searchParams.get('s'), 'Nights');
  assert.equal(url.searchParams.get('a'), 'Frank Ocean');
  assert.equal(url.searchParams.get('al'), 'Blonde');
  assert.equal(url.searchParams.get('d'), '307');
});

test('boidu treats an error body, another artist, or a non-Apple host as no artwork', async () => {
  const bodies: unknown[] = [
    { error: 'No matching tracks found' },
    { artist: 'Someone Else', videoUrl: 'https://mvod.itunes.apple.com/a.mp4' },
    { artist: 'Frank Ocean', videoUrl: 'https://evil.example/a.mp4', animated: 'http://mvod.itunes.apple.com/a.m3u8' }
  ];
  for (const body of bodies) {
    const provider = new BoiduArtworkProvider({ baseUrl: 'https://artwork.test', fetchImpl: async () => json(body) });
    assert.equal(await provider.find({ title: 'Nights', artist: 'Frank Ocean' }), null);
  }
});

test('providers return null instead of throwing on network failure or 429', async () => {
  const failing = new BoiduArtworkProvider({ baseUrl: 'https://artwork.test', fetchImpl: async () => { throw new Error('offline'); } });
  const limited = new M8tecArtworkProvider({ baseUrl: 'https://m8.test', fetchImpl: async () => new Response('', { status: 429 }) });
  assert.equal(await failing.find({ title: 'a', artist: 'b' }), null);
  assert.equal(await limited.find({ title: 'a', artist: 'b', album: 'c' }), null);
});

test('m8tec needs an album and returns its HLS playlist', async () => {
  let calls = 0;
  const provider = new M8tecArtworkProvider({
    baseUrl: 'https://m8.test',
    fetchImpl: async (input) => {
      calls += 1;
      assert.match(String(input), /\/api\/v1\/artwork\/search\?artist=Linkin\+Park&album=Living\+Things/);
      return json({ url: 'https://mvod.itunes.apple.com/itunes-assets/square.m3u8', artist: 'Linkin Park' });
    }
  });

  assert.equal(await provider.find({ title: 'Castle of Glass', artist: 'Linkin Park' }), null);
  assert.equal(calls, 0);
  assert.deepEqual(await provider.find({ title: 'Castle of Glass', artist: 'Linkin Park', album: 'Living Things' }), {
    source: 'Apple Music',
    videoUrl: 'https://mvod.itunes.apple.com/itunes-assets/square.m3u8'
  });
});

test('canvas service falls through providers in order and caches the answer', async () => {
  const calls: string[] = [];
  const miss: CanvasProvider = { find: async () => { calls.push('first'); return null; } };
  const hit: CanvasProvider = { find: async () => { calls.push('second'); return { source: 'Apple Music', videoUrl: 'https://mvod.itunes.apple.com/x.mp4' }; } };
  const service = new CanvasService([miss, hit], new MemoryCacheStore());
  const query = { title: 'Song', artist: 'Artist', album: 'Album' };

  assert.equal((await service.find(query))?.videoUrl, 'https://mvod.itunes.apple.com/x.mp4');
  assert.equal((await service.find(query))?.videoUrl, 'https://mvod.itunes.apple.com/x.mp4');
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(await new CanvasService([], new MemoryCacheStore()).find(query), null);
});

test('a song filed under its single falls back to the full album that carries the motion art', async () => {
  const albumsTried: (string | undefined)[] = [];
  const provider: CanvasProvider = {
    find: async (query) => {
      albumsTried.push(query.album);
      return query.album === 'After Hours' ? { source: 'Apple Music', videoUrl: 'https://mvod.itunes.apple.com/after-hours.mp4' } : null;
    }
  };
  const lookups: string[] = [];
  const service = new CanvasService([provider], new MemoryCacheStore(), {
    albumsFor: async (title, artist) => { lookups.push(`${artist}/${title}`); return ['Blinding Lights', 'After Hours']; }
  });

  assert.equal((await service.find({ title: 'Blinding Lights', artist: 'The Weeknd', album: 'Blinding Lights' }))?.videoUrl, 'https://mvod.itunes.apple.com/after-hours.mp4');
  // The single is not retried under its own name; the album is tried once.
  assert.deepEqual(albumsTried, ['Blinding Lights', 'After Hours']);
  assert.deepEqual(lookups, ['The Weeknd/Blinding Lights']);
});

test('itunes albumsFor keeps only full albums carrying the exact song by that artist', async () => {
  const itunes = new ItunesProvider({
    baseUrl: 'https://itunes.test/search',
    fetchImpl: async () => json({
      results: [
        { trackName: 'Blinding Lights', artistName: 'The Weeknd', collectionName: 'Blinding Lights - Single', trackCount: 1 },
        { trackName: 'Blinding Lights', artistName: 'The Weeknd', collectionName: 'After Hours', trackCount: 14 },
        { trackName: 'Blinding Lights', artistName: 'The Weeknd', collectionName: 'After Hours', trackCount: 14 },
        { trackName: 'Blinding Lights (Remix)', artistName: 'The Weeknd & ROSALÍA', collectionName: 'The Highlights', trackCount: 18 },
        { trackName: 'Blinding Lights', artistName: 'Cover Band', collectionName: 'Covers Vol. 1', trackCount: 20 },
        { trackName: 'Blinding Lights', artistName: 'The Weeknd', collectionName: 'Blinding Lights - EP', trackCount: 5 }
      ]
    })
  });

  assert.deepEqual(await itunes.albumsFor('Blinding Lights', 'The Weeknd'), ['After Hours', 'The Highlights']);
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}
