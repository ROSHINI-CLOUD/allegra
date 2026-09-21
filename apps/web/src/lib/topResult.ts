import type { UnifiedSong } from '@shared/types';

/**
 * Which row deserves the "Top result" card.
 *
 * The provider happily returns the same recording several times: once as its own
 * release, and again as a track on editorial compilations ("Ocean Waves Melodies of
 * Kollywood"). Those placements often carry a near-identical play count, so plain
 * result order regularly puts a playlist cover in the hero slot for a song the
 * listener obviously meant the official release of.
 *
 * Ranked on the signals that actually separate the two, strongest first:
 *   1. how closely the row answers what was typed
 *   2. an order-of-magnitude play lead, which no album signal should be able to argue
 *      with — this is what stops an obscure self-titled upload taking the slot from a
 *      row that is genuinely the popular one
 *   3. the album is the song's own release (album is the title, or the same "(From …)" film)
 *   4. how many other placements collapsed into this row — the official release is the
 *      one every compilation copies, so it carries the deepest variant list
 *   5. play count, once the lead is meaningful rather than a rounding gap
 */

function flatten(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

/** The film or album a title credits, as in `Hayyoda (From "Jawan")`. */
function creditedSource(title: string): string {
  const match = /(?:from|out of)\s*["\u201c']?([^)"\u201d']+)/iu.exec(title);
  return match?.[1] ? flatten(match[1]) : '';
}

/** True when the album is this song's own release rather than a playlist placement. */
export function isOwnRelease(song: UnifiedSong): boolean {
  if (!song.album) return false;
  const album = flatten(song.album);
  if (!album) return false;

  const fullTitle = flatten(song.title);
  if (album === fullTitle) return true;

  const bareTitle = flatten(song.title.replace(/[([][^)\]]*[)\]]/gu, ' '));
  if (bareTitle && (album === bareTitle || album.startsWith(`${bareTitle} `) || bareTitle.startsWith(album))) {
    return true;
  }

  // `Hayyoda (From "Jawan")` on the album `Jawan` is the soundtrack, not a compilation.
  const source = creditedSource(song.title);
  return source.length > 0 && (album === source || album.startsWith(`${source} `));
}

/**
 * Meaningful play-count comparison: a lead inside 2% or 2,000 plays counts as a tie,
 * so a compilation row cannot edge out the real release on noise.
 */
function playCountRank(left: number, right: number): number {
  const delta = right - left;
  if (delta === 0) return 0;
  const scale = Math.max(left, right, 1);
  if (Math.abs(delta) <= 2_000 || Math.abs(delta) / scale <= 0.02) return 0;
  return delta;
}

/**
 * A lead big enough that no album signal should override it. Saavn stamps a similar
 * play count on every placement of a hit, so only a full order of magnitude counts.
 */
function dominantPlayLead(left: number, right: number): number {
  if (left >= right * 10 && left > 10_000) return -1;
  if (right >= left * 10 && right > 10_000) return 1;
  return 0;
}

/** How closely the row answers what was typed. An exact title beats a near match. */
function queryRank(song: UnifiedSong, query: string): number {
  const needle = flatten(query);
  if (!needle) return 0;
  const title = flatten(song.title);
  const bare = flatten(song.title.replace(/[([][^)\]]*[)\]]/gu, ' '));
  if (title === needle || bare === needle) return 3;
  if (bare.startsWith(needle) || title.startsWith(needle)) return 2;
  if (title.includes(needle)) return 1;
  return 0;
}

/**
 * The row to feature, or null for an empty list.
 *
 * Only the first `depth` results are considered: past that the provider's own
 * relevance has fallen off far enough that a strong album match means little.
 */
export function pickTopResult(
  songs: readonly UnifiedSong[],
  query: string,
  depth = 8
): UnifiedSong | null {
  if (songs.length === 0) return null;

  const pool = songs.slice(0, depth);
  return [...pool].sort((left, right) => {
    const byQuery = queryRank(right, query) - queryRank(left, query);
    if (byQuery !== 0) return byQuery;

    const byDominance = dominantPlayLead(left.playCount, right.playCount);
    if (byDominance !== 0) return byDominance;

    const byRelease = Number(isOwnRelease(right)) - Number(isOwnRelease(left));
    if (byRelease !== 0) return byRelease;

    const byVariants = (right.variants?.length ?? 0) - (left.variants?.length ?? 0);
    if (byVariants !== 0) return byVariants;

    const byPlays = playCountRank(left.playCount, right.playCount);
    if (byPlays !== 0) return byPlays;

    // Stable leftover: keep the provider's order for genuine ties.
    return pool.indexOf(left) - pool.indexOf(right);
  })[0] ?? null;
}
