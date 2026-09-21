import assert from 'node:assert/strict';
import test from 'node:test';

import { collapseRecordings, normalizeSong, songIdentity } from './normalize.js';
import type { UnifiedSong } from '../types.js';

function makeSong(partial: Partial<UnifiedSong> & Pick<UnifiedSong, 'id' | 'title' | 'artist'>): UnifiedSong {
  return {
    artwork: '',
    streamUrl: `/api/stream/${partial.id}`,
    duration: 180,
    hasLyrics: false,
    playCount: 0,
    source: 'Saavn',
    ...partial
  };
}

test('normalization decodes entities, supports array artists, selects quality, and parses counts', () => {
  const song = normalizeSong({
    id: 'abc',
    name: '&quot;Track&#39;s&#x20;Name&quot;',
    artists: { primary: [{ name: 'A &amp; B' }, { name: 'C' }] },
    playCount: '1,234,567 plays',
    duration: 240,
    image: [
      { quality: '150x150', url: 'https://img/150.jpg' },
      { quality: '500x500', url: 'https://img/500.jpg' }
    ],
    downloadUrl: [
      { quality: '96kbps', url: 'https://audio/96.mp4' },
      { quality: '320kbps', url: 'https://audio/320.mp4' }
    ]
  }, 'Saavn');

  assert.deepEqual(song, {
    id: 'abc',
    title: '"Track\'s Name"',
    artist: 'A & B, C',
    artwork: 'https://img/500.jpg',
    streamUrl: '/api/stream/abc',
    duration: 240,
    hasLyrics: false,
    playCount: 1_234_567,
    source: 'Saavn'
  });
});

test('primaryArtists string, missing artist fallback, last-quality fallback, and seconds duration', () => {
  const named = normalizeSong({
    id: 'str',
    name: 'Named',
    primaryArtists: 'Solo',
    duration: '245',
    image: [{ quality: '150x150', url: 'https://img/150.jpg' }],
    downloadUrl: [{ quality: '160kbps', url: 'https://audio/160.mp4' }]
  }, 'Saavn');
  const unknown = normalizeSong({
    id: 'unk',
    name: 'No Artist',
    downloadUrl: [{ url: 'https://audio/song.mp4' }]
  }, 'Saavn');

  assert.equal(named?.artist, 'Solo');
  assert.equal(named?.duration, 245);
  assert.equal(named?.artwork, 'https://img/150.jpg');
  assert.equal(named?.streamUrl, '/api/stream/str');
  assert.equal(unknown?.artist, 'Unknown Artist');
});

test('hex apostrophe decoding is distinct from decimal', () => {
  const song = normalizeSong({
    id: 'hex',
    name: 'It&#x27;s Time',
    primaryArtists: 'A',
    downloadUrl: [{ quality: '320kbps', url: 'https://audio/320.mp4' }]
  }, 'Saavn');
  assert.equal(song?.title, "It's Time");
});

test('Gaana play counts are always zero and songs without audio are dropped', () => {
  const song = normalizeSong({
    id: 'gaana',
    name: 'Gaana song',
    primaryArtists: 'Artist',
    playCount: 99_999,
    downloadUrl: [{ quality: '160kbps', url: 'https://audio/song.mp4' }]
  }, 'Gaana');
  const missingAudio = normalizeSong({ id: 'missing', name: 'Missing' }, 'Saavn');

  assert.equal(song?.playCount, 0);
  assert.equal(missingAudio, null);
});

test('songIdentity strips bracketed trailers and sorts artists', () => {
  assert.equal(
    songIdentity(makeSong({ id: '1', title: 'Please Please Please (From "Short n Sweet")', artist: 'Sabrina Carpenter' })),
    songIdentity(makeSong({ id: '2', title: 'Please Please Please', artist: 'Sabrina Carpenter' }))
  );
  assert.equal(
    songIdentity(makeSong({ id: 'a', title: 'Duets', artist: 'A, B' })),
    songIdentity(makeSong({ id: 'b', title: 'Duets', artist: 'B, A' }))
  );
});

test('collapseRecordings elects highest playCount and attaches variants', () => {
  const official = makeSong({
    id: 'official',
    title: 'Please Please Please',
    artist: 'Sabrina Carpenter',
    album: 'Short n\' Sweet',
    playCount: 500_000_000
  });
  const chic = makeSong({
    id: 'chic',
    title: 'Please Please Please',
    artist: 'Sabrina Carpenter',
    album: 'Chic Pop',
    playCount: 12_000
  });
  const cozy = makeSong({
    id: 'cozy',
    title: 'Please Please Please',
    artist: 'Sabrina Carpenter',
    album: 'Cozy Gaming',
    playCount: 800
  });
  const other = makeSong({
    id: 'other',
    title: 'Espresso',
    artist: 'Sabrina Carpenter',
    album: 'Short n\' Sweet',
    playCount: 600_000_000
  });

  const collapsed = collapseRecordings([chic, cozy, official, other]);
  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0]?.id, 'official');
  assert.deepEqual(collapsed[0]?.variants?.map((entry) => entry.id).sort(), ['chic', 'cozy']);
  assert.equal(collapsed[0]?.variants?.some((entry) => entry.variants !== undefined), false);
  assert.equal(collapsed[1]?.id, 'other');
  assert.equal(collapsed[1]?.variants, undefined);
});

test('collapseRecordings prefers a real album over a shared compilation when playCounts tie', () => {
  const mixed = [
    makeSong({ id: 'c1', title: 'Track', artist: 'A', album: 'Comp Pack', playCount: 5 }),
    makeSong({ id: 'c2', title: 'Other', artist: 'B', album: 'Comp Pack', playCount: 5 }),
    makeSong({ id: 'canon', title: 'Track', artist: 'A', album: 'Real Album', playCount: 5 })
  ];
  const result = collapseRecordings(mixed);
  assert.equal(result.find((entry) => entry.title === 'Track')?.id, 'canon');
  assert.deepEqual(result.find((entry) => entry.title === 'Track')?.variants?.map((entry) => entry.id), ['c1']);
});

test('collapseRecordings prefers the official single over playlist covers with near-tied playCounts', () => {
  // Mirrors Saavn: every placement shares ~the same playCount; only album differs.
  const playlist = makeSong({
    id: 'kaffee',
    title: 'Please Please Please',
    artist: 'Sabrina Carpenter',
    album: 'Kaffee und Kuchen',
    playCount: 2_111_351
  });
  const single = makeSong({
    id: 'single',
    title: 'Please Please Please',
    artist: 'Sabrina Carpenter',
    album: 'Please Please Please',
    playCount: 2_111_351
  });
  const studio = makeSong({
    id: 'short',
    title: 'Please Please Please',
    artist: 'Sabrina Carpenter',
    album: "Short n' Sweet",
    playCount: 2_111_350
  });
  const chic = makeSong({
    id: 'chic',
    title: 'Please Please Please',
    artist: 'Sabrina Carpenter',
    album: 'Chic Pop',
    playCount: 2_111_350
  });

  const collapsed = collapseRecordings([playlist, chic, studio, single]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0]?.id, 'single');
  assert.equal(collapsed[0]?.album, 'Please Please Please');
  assert.deepEqual(
    collapsed[0]?.variants?.map((entry) => entry.id).sort(),
    ['chic', 'kaffee', 'short']
  );
});

test('collapseRecordings still lets a true playCount blowout win', () => {
  const official = makeSong({
    id: 'official',
    title: 'Espresso',
    artist: 'Sabrina Carpenter',
    album: "Short n' Sweet",
    playCount: 500_000_000
  });
  const single = makeSong({
    id: 'single',
    title: 'Espresso',
    artist: 'Sabrina Carpenter',
    album: 'Espresso',
    playCount: 12_000
  });
  const collapsed = collapseRecordings([single, official]);
  assert.equal(collapsed[0]?.id, 'official');
});

test('collapseRecordings prefers the studio album over a World Music Day shell', () => {
  const dayList = makeSong({
    id: 'day',
    title: 'Tum Hi Ho',
    artist: 'Arijit Singh',
    album: 'World Music Day',
    playCount: 8_000_000
  });
  const soundtrack = makeSong({
    id: 'ashiqui',
    title: 'Tum Hi Ho',
    artist: 'Arijit Singh',
    album: 'Aashiqui 2',
    playCount: 7_500_000
  });
  const collapsed = collapseRecordings([dayList, soundtrack]);
  assert.equal(collapsed[0]?.id, 'ashiqui');
  assert.equal(collapsed[0]?.album, 'Aashiqui 2');
});
