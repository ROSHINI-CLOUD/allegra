import assert from 'node:assert/strict';
import test from 'node:test';

import { YouTubeMusicProvider, plainTitle, sameSong } from './youtubeMusic.js';

// Shapes trimmed from real music.youtube.com/youtubei/v1 responses (captured 2026-09-24).
const artistRun = (text: string) => ({
  text,
  navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ARTIST' } } } }
});
const albumRun = (text: string) => ({
  text,
  navigationEndpoint: { browseEndpoint: { browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_ALBUM' } } } }
});
const dot = { text: ' • ' };

function searchRow(videoId: string, title: string, byline: readonly object[]) {
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: byline } } }
      ]
    }
  };
}

function searchBody(rows: readonly object[]) {
  return { contents: { tabbedSearchResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: rows } }] } } } }] } } };
}

function queueRow(videoId: string, title: string, byline: readonly object[], length: string) {
  return { playlistPanelVideoRenderer: { videoId, title: { runs: [{ text: title }] }, longBylineText: { runs: byline }, lengthText: { runs: [{ text: length }] } } };
}

function nextBody(rows: readonly object[]) {
  return {
    contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: { watchNextTabbedResultsRenderer: { tabs: [{ tabRenderer: { content: { musicQueueRenderer: { content: { playlistPanelRenderer: { contents: rows } } } } } }] } } } }
  };
}

function provider(respond: (endpoint: string, body: Record<string, unknown>) => Response | Promise<Response>) {
  return new YouTubeMusicProvider({
    baseUrl: 'https://ytm.test/youtubei/v1/',
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      return respond(url.pathname.split('/').pop() ?? '', JSON.parse(String(init?.body)) as Record<string, unknown>);
    }
  });
}

test('findSong picks the row that is the same song, not just the first row', async () => {
  const youtube = provider((endpoint, body) => {
    assert.equal(endpoint, 'search');
    assert.equal(body.query, 'Tum Hi Ho Arijit Singh');
    assert.equal((body.context as { client: { clientName: string } }).client.clientName, 'WEB_REMIX');
    return Response.json(searchBody([
      searchRow('cover000001', 'Tum Hi Ho (Cover)', [{ text: 'Some Cover Band' }, dot, { text: '3:10' }]),
      searchRow('fsiPzT50ZiM', 'Tum Hi Ho', [artistRun('Arijit Singh'), dot, albumRun('Aashiqui 2'), dot, { text: '4:22' }])
    ]));
  });
  const song = await youtube.findSong('Tum Hi Ho', 'Arijit Singh');
  assert.deepEqual(song, { videoId: 'fsiPzT50ZiM', title: 'Tum Hi Ho', artists: ['Arijit Singh'], duration: 262 });
});

test('findSong returns null rather than a different song', async () => {
  const youtube = provider(() => Response.json(searchBody([searchRow('other000001', 'Another Song', [artistRun('Arijit Singh')])])));
  assert.equal(await youtube.findSong('Tum Hi Ho', 'Arijit Singh'), null);
});

test('radio reads the queue in order, drops the seed, and reads unlinked artist credits', async () => {
  const youtube = provider((endpoint, body) => {
    assert.equal(endpoint, 'next');
    assert.equal(body.playlistId, 'RDAMVMfsiPzT50ZiM');
    return Response.json(nextBody([
      queueRow('fsiPzT50ZiM', 'Tum Hi Ho', [artistRun('Arijit Singh')], '4:22'),
      queueRow('DsWmEF-NjWU', 'Janam Janam', [artistRun('Arijit Singh'), dot, albumRun('Popular Songs'), dot, { text: '2020' }], '3:59'),
      { playlistPanelVideoWrapperRenderer: { primaryRenderer: queueRow('wrapped0001', 'Sun Saathiya', [{ text: 'Priya Saraiya, Divya Kumar' }, dot, { text: 'ABCD 2' }], '4:17') } },
      queueRow('third000001', 'Humnava Mere', [artistRun('Jubin Nautiyal')], '4:23')
    ]));
  });
  const radio = await youtube.radio('fsiPzT50ZiM', 2);
  assert.deepEqual(radio, [
    { videoId: 'DsWmEF-NjWU', title: 'Janam Janam', artists: ['Arijit Singh'], duration: 239 },
    { videoId: 'wrapped0001', title: 'Sun Saathiya', artists: ['Priya Saraiya', 'Divya Kumar'], duration: 257 }
  ]);
});

test('failures return empty, and repeated failures stop calling out', async () => {
  let calls = 0;
  const youtube = provider(() => {
    calls += 1;
    return new Response('blocked', { status: 429 });
  });
  for (let attempt = 0; attempt < 5; attempt += 1) assert.deepEqual(await youtube.radio('x', 10), []);
  assert.equal(calls, 3);

  const garbled = provider(() => new Response('<html>', { status: 200 }));
  assert.equal(await garbled.findSong('A', 'B'), null);
});

test('titles compare without film and version trailers; artists need one shared credit', () => {
  assert.equal(plainTitle('Ishq (From "Lost; Found")'), 'ishq');
  assert.equal(plainTitle('Tum Hi Ho - From Aashiqui 2'), 'tum hi ho');
  assert.ok(sameSong({ videoId: 'v', title: 'Kesariya (From "Brahmastra")', artists: ['Arijit Singh'] }, 'Kesariya', 'Pritam, Arijit Singh'));
  assert.ok(!sameSong({ videoId: 'v', title: 'Kesariya', artists: ['A Cover Artist'] }, 'Kesariya', 'Arijit Singh'));
});
