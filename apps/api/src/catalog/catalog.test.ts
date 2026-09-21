import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogService } from './catalog.js';
import { MemoryCacheStore } from '../lib/cache.js';
import { ProviderUnavailableError } from '../lib/errors.js';
import { GaanaProvider } from '../providers/gaana.js';
import { SaavnProvider, type SaavnSong } from '../providers/saavn.js';

const saavnSong: SaavnSong = {
  id: 's1',
  name: 'Saavn Hit',
  primaryArtists: 'Artist',
  playCount: 50,
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/s1.mp4' }]
};
const gaanaSong: SaavnSong = {
  id: 'g1',
  name: 'Gaana Hit',
  primaryArtists: 'Artist',
  playCount: 99,
  downloadUrl: [{ quality: '320kbps', url: 'https://cdn.example/g1.mp4' }]
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function catalog(fetchImpl: typeof fetch): CatalogService {
  return new CatalogService({
    saavn: new SaavnProvider({ baseUrl: 'https://saavn.example/api', fetchImpl }),
    gaana: new GaanaProvider({ baseUrl: 'https://gaana.example/api', fetchImpl }),
    cache: new MemoryCacheStore()
  });
}

test('Gaana runs only when Saavn successfully returns zero results', async () => {
  const urls: string[] = [];
  const service = catalog(async (input) => {
    urls.push(String(input));
    if (String(input).includes('gaana.example')) {
      return json({ success: true, data: { results: [gaanaSong] } });
    }
    return json({ success: true, data: { results: [] } });
  });

  const result = await service.search('rare', 20, 0);
  assert.equal(result.source, 'Gaana');
  assert.equal(result.results[0]?.id, 'g1');
  assert.equal(result.results[0]?.playCount, 0);
  assert.equal(urls.some((url) => url.includes('gaana.example')), true);
});

test('Gaana does not run when Saavn errors', async () => {
  let gaanaCalled = false;
  const service = catalog(async (input) => {
    if (String(input).includes('gaana.example')) {
      gaanaCalled = true;
      return json({ success: true, data: { results: [gaanaSong] } });
    }
    return json({ success: false }, 500);
  });

  await assert.rejects(() => service.search('test', 20, 0), ProviderUnavailableError);
  assert.equal(gaanaCalled, false);
});

test('search caches results and does not leak provider fields', async () => {
  let searches = 0;
  const service = catalog(async () => {
    searches += 1;
    return json({ success: true, data: { results: [saavnSong] } });
  });

  const first = await service.search('hit', 20, 0);
  const second = await service.search('hit', 20, 0);
  assert.equal(searches, 1);
  assert.equal(first.results[0]?.streamUrl, '/api/stream/s1');
  assert.equal('downloadUrl' in (first.results[0] ?? {}), false);
  assert.deepEqual(first, second);
});

test('circuit breaker skips Saavn after consecutive failures', async () => {
  let calls = 0;
  const service = catalog(async () => {
    calls += 1;
    throw new Error('down');
  });

  await assert.rejects(() => service.search('a', 20, 0), ProviderUnavailableError);
  await assert.rejects(() => service.search('b', 20, 0), ProviderUnavailableError);
  await assert.rejects(() => service.search('c', 20, 0), ProviderUnavailableError);
  await assert.rejects(() => service.search('d', 20, 0), ProviderUnavailableError);
  assert.equal(calls, 3);
});

test('artist profile picks the exact-name match and maps photo, followers, songs and albums', async () => {
  const urls: string[] = [];
  const service = catalog(async (input) => {
    const url = new URL(String(input));
    urls.push(url.pathname);
    if (url.pathname.endsWith('/search/artists')) {
      return json({ success: true, data: { results: [
        { id: '9', name: 'Anirudh Ravichander Feat. Someone', image: [{ quality: '500x500', url: 'https://cdn.example/wrong.jpg' }] },
        { id: '1', name: 'Anirudh Ravichander', image: [{ quality: '500x500', url: 'https://cdn.example/face.jpg' }] }
      ] } });
    }
    return json({ success: true, data: {
      id: '1', name: 'Anirudh Ravichander', isVerified: true, followerCount: '9357740',
      image: [{ quality: '150x150', url: 'https://cdn.example/small.jpg' }, { quality: '500x500', url: 'https://cdn.example/face.jpg' }],
      topSongs: [saavnSong],
      topAlbums: [{ id: 'a1', name: 'Jawan', year: '2023', image: [{ quality: '500x500', url: 'https://cdn.example/jawan.jpg' }] }],
      singles: [{ id: 'a1', name: 'Jawan', year: '2023' }],
      similarArtists: [{ id: '2', name: 'Arijit Singh', image: [{ quality: '500x500', url: 'https://cdn.example/arijit.jpg' }] }]
    } });
  });

  const profile = await service.getArtist('anirudh ravichander');
  assert.equal(profile.id, '1');
  assert.equal(profile.image, 'https://cdn.example/face.jpg');
  assert.equal(profile.isVerified, true);
  assert.equal(profile.followerCount, 9357740);
  assert.equal(profile.songs.length, 1);
  assert.equal(profile.albums.length, 1, 'an album listed as both top album and single appears once');
  assert.equal(profile.albums[0]?.year, '2023');
  assert.equal(profile.similar[0]?.name, 'Arijit Singh');
  assert.ok(urls.some((path) => path.endsWith('/artists')));
  // A second call is served from cache.
  const before = urls.length;
  await service.getArtist('Anirudh Ravichander');
  assert.equal(urls.length, before);
});

test('artist faces omit names without a photo and unknown names', async () => {
  const service = catalog(async (input) => {
    const query = new URL(String(input)).searchParams.get('query');
    if (query === 'Known') {
      return json({ success: true, data: { results: [{ id: '1', name: 'Known', image: [{ quality: '500x500', url: 'https://cdn.example/known.jpg' }] }] } });
    }
    if (query === 'NoPhoto') {
      return json({ success: true, data: { results: [{ id: '2', name: 'NoPhoto', image: [] }] } });
    }
    return json({ success: true, data: { results: [] } });
  });
  const faces = await service.getArtistFaces(['Known', 'NoPhoto', 'Nobody']);
  assert.deepEqual(faces.map((face) => face.name), ['Known']);
});
