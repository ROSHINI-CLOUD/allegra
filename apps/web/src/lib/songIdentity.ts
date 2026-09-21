import type { UnifiedSong } from '@shared/types';

/**
 * Same recording under different release ids (cover/album variants).
 * Mirrors `apps/api/src/lib/normalize.ts` so queue/radio and shelves agree.
 */
export function songIdentity(song: Pick<UnifiedSong, 'title' | 'artist'>): string {
  const title = flatten(song.title.replace(/[([][^)\]]*[)\]]/gu, ' '));
  const artists = flatten(song.artist).split(' ').sort().join(' ');
  return `${title}|${artists}`;
}

/** Keep first occurrence of each recording identity. */
export function uniqueByIdentity(songs: readonly UnifiedSong[]): UnifiedSong[] {
  const seen = new Set<string>();
  const out: UnifiedSong[] = [];
  for (const song of songs) {
    const key = songIdentity(song);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(song);
  }
  return out;
}

function baseTitle(song: Pick<UnifiedSong, 'title'>): string {
  return flatten(song.title.replace(/[([][^)\]]*[)\]]/gu, ' '));
}

/**
 * Prefer radio (seed + similar) when the handed queue is thin, remaster-heavy,
 * or mostly the same title with remix/credit variants — typical title search.
 */
export function shouldStartRadio(seed: UnifiedSong, queue: readonly UnifiedSong[]): boolean {
  const distinct = uniqueByIdentity(queue);
  if (distinct.length >= 8) return false;
  const others = queue.filter((song) => song.id !== seed.id);
  if (others.length === 0) return true;
  const seedKey = songIdentity(seed);
  const seedTitle = baseTitle(seed);
  const remasters = others.filter((song) => songIdentity(song) === seedKey).length;
  const sameTitle = others.filter((song) => {
    const title = baseTitle(song);
    return title === seedTitle || title.startsWith(seedTitle) || seedTitle.startsWith(title);
  }).length;
  if (remasters / others.length >= 0.4) return true;
  if (sameTitle / others.length >= 0.5) return true;
  return distinct.length < 3;
}

function flatten(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
