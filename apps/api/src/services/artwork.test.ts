import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogService } from '../catalog/catalog.js';
import { MemoryCacheStore } from '../lib/cache.js';
import { GaanaProvider } from '../providers/gaana.js';
import { ItunesProvider } from '../providers/itunes.js';
import { SaavnProvider } from '../providers/saavn.js';
import { ArtworkService, cleanArtworkQuery } from './artwork.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('artwork query cleaning strips parens, brackets, and feat noise', () => {
  assert.equal(cleanArtworkQuery('Song (From "Movie") [Official Video] ft. Friend'), 'Song');
});

test('iTunes two-pass search upgrades 100x100bb and falls back to Saavn art', async () => {
  const terms: string[] = [];
  const itunes = new ItunesProvider({
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      terms.push(url.searchParams.get('term') ?? '');
      if (url.searchParams.get('term') === 'Song (Official) Artist') {
        return json({ results: [] });
      }
      return json({ results: [{ artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg' }] });
    }
  });
  const cache = new MemoryCacheStore();
  const catalog = new CatalogService({
    saavn: new SaavnProvider({
      baseUrl: 'https://saavn.example/api',
      fetchImpl: async () => json({
        success: true,
        data: {
          results: [{
            id: 's1',
            name: 'Song',
            primaryArtists: 'Artist',
            image: [{ quality: '500x500', url: 'https://c.saavncdn.com/500.jpg' }],
            downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/s.mp4' }]
          }]
        }
      })
    }),
    gaana: new GaanaProvider({
      baseUrl: 'https://gaana.example/api',
      fetchImpl: async () => json({ success: true, data: { results: [] } })
    }),
    cache
  });
  const service = new ArtworkService(itunes, catalog, cache);

  const upgraded = await service.find('Clean Title', 'Artist', 5);
  assert.deepEqual(upgraded, ['https://is1-ssl.mzstatic.com/image/thumb/1000x1000bb.jpg']);

  const cleaned = await service.find('Song (Official)', 'Artist', 5);
  assert.equal(terms.includes('Song (Official) Artist'), true);
  assert.equal(terms.includes('Song Artist'), true);
  assert.ok(cleaned[0]?.includes('1000x1000bb'));

  const fallbackItunes = new ItunesProvider({
    fetchImpl: async () => json({ results: [] })
  });
  const fallback = new ArtworkService(fallbackItunes, catalog, new MemoryCacheStore());
  const saavnArt = await fallback.find('Song', 'Artist', 5);
  assert.deepEqual(saavnArt, ['https://c.saavncdn.com/500.jpg']);
});

test('artwork results are cached', async () => {
  let calls = 0;
  const service = new ArtworkService(
    new ItunesProvider({
      fetchImpl: async () => {
        calls += 1;
        return json({ results: [{ artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/100x100bb.jpg' }] });
      }
    }),
    new CatalogService({
      saavn: new SaavnProvider({ baseUrl: 'https://saavn.example/api', fetchImpl: async () => json({ success: true, data: { results: [] } }) }),
      gaana: new GaanaProvider({ baseUrl: 'https://gaana.example/api', fetchImpl: async () => json({ success: true, data: { results: [] } }) }),
      cache: new MemoryCacheStore()
    }),
    new MemoryCacheStore()
  );

  await service.find('Title', 'Artist', 5);
  await service.find('Title', 'Artist', 5);
  assert.equal(calls, 1);
});
