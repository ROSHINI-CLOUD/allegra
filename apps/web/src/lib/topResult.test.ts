import assert from 'node:assert/strict';
import test from 'node:test';

import type { UnifiedSong } from '@shared/types';

import { isOwnRelease, pickTopResult } from './topResult.ts';

function song(
  id: string,
  title: string,
  album: string,
  playCount = 10_000,
  variants = 0
): UnifiedSong {
  return {
    id,
    title,
    artist: 'Anirudh Ravichander',
    album,
    artwork: '',
    streamUrl: `/api/stream/${id}`,
    duration: 200,
    hasLyrics: true,
    playCount,
    source: 'Saavn',
    ...(variants > 0
      ? { variants: Array.from({ length: variants }, (_, index) => song(`${id}-v${index}`, title, album)) }
      : {})
  };
}

test('a self-titled album is the song own release', () => {
  assert.equal(isOwnRelease(song('a', 'Hayyoda (From "Jawan")', 'Hayyoda (From "Jawan")')), true);
  assert.equal(isOwnRelease(song('b', 'Hayyoda', 'Hayyoda')), true);
});

test('the soundtrack it was credited from counts as its own release', () => {
  assert.equal(isOwnRelease(song('a', 'Hayyoda (From "Jawan")', 'Jawan')), true);
});

test('an editorial compilation does not', () => {
  assert.equal(isOwnRelease(song('a', 'Hayyoda (From "Jawan")', 'Ocean Waves Melodies Of Kollywood')), false);
});

test('the official release wins the hero slot over a compilation placement', () => {
  const compilation = song('c', 'Hayyoda (From "Jawan")', 'Ocean Waves Melodies Of Kollywood', 12_000, 2);
  const official = song('o', 'Hayyoda (From "Jawan")', 'Hayyoda (From "Jawan")', 11_900, 19);
  // The compilation is listed first and even leads on plays — by a rounding gap.
  assert.equal(pickTopResult([compilation, official], 'hayoda')?.id, 'o');
});

test('a real play-count lead still wins', () => {
  const compilation = song('c', 'Hayyoda', 'Kollywood Hits', 900_000, 0);
  const official = song('o', 'Hayyoda', 'Hayyoda', 1_000, 0);
  assert.equal(pickTopResult([compilation, official], 'hayyoda')?.id, 'c');
});

test('an exact title match outranks a loose one', () => {
  const remix = song('r', 'Hayyoda Remix (Remix By Rion Music)', 'Hayyoda Remix', 50_000, 5);
  const original = song('o', 'Hayyoda', 'Hayyoda', 20_000, 0);
  assert.equal(pickTopResult([remix, original], 'hayyoda')?.id, 'o');
});

test('an empty list has no top result', () => {
  assert.equal(pickTopResult([], 'anything'), null);
});
