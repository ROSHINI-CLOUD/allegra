/**
 * Which artist the query was actually about.
 *
 * Typing "anirudh" means Anirudh Ravichander, not the eighteen people who happen to
 * share a credit with him on the results. Scored on how the query lines up with the
 * name — a whole name, a first name, a prefix of one — so the intended artist can be
 * featured and the rest listed as also-rans.
 */

function flatten(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

/**
 * 0 when the name has nothing to do with the query, 100 for a dead-on match.
 * Exported for tests; callers want {@link bestArtistMatch}.
 */
export function artistMatchScore(name: string, query: string): number {
  const needle = flatten(query);
  const hay = flatten(name);
  if (!needle || !hay) return 0;

  if (hay === needle) return 100;
  if (hay.startsWith(`${needle} `)) return 88;
  if (needle.startsWith(`${hay} `)) return 80;

  const words = hay.split(' ');
  const terms = needle.split(' ');

  // "anirudh" against "Anirudh Ravichander": a whole word of the name matched.
  if (words.some((word) => terms.includes(word))) return 72;

  // "anirud" against "Anirudh Ravichander": a word of the name starts with the query.
  // The prefix has to cover most of that word, or "ram" would claim Rammstein.
  const prefixHit = terms.some((term) =>
    term.length >= 4 && words.some((word) => word.startsWith(term) && term.length >= word.length * 0.6)
  );
  if (prefixHit) return 60;

  if (hay.includes(needle)) return 44;

  // Partial credit for shared words, so "ar rahman hits" still finds A R Rahman.
  const shared = terms.filter((term) => words.includes(term)).length;
  if (shared > 0) return Math.round((shared / Math.max(terms.length, words.length)) * 40);

  return 0;
}

export interface ArtistCandidate {
  readonly name: string;
}

export interface ArtistMatch<T extends ArtistCandidate> {
  /** The artist the query was about, or null when nothing scored well enough. */
  readonly feature: T | null;
  /** Everyone else, in their original order. */
  readonly rest: readonly T[];
}

/**
 * Splits the list into the artist to feature and the remainder.
 *
 * `minimum` is deliberately above a bare substring hit: a weak match in the hero slot
 * is worse than no hero at all, because it claims the search was about someone it
 * wasn't. Ties go to whoever the results ranked higher.
 */
export function bestArtistMatch<T extends ArtistCandidate>(
  artists: readonly T[],
  query: string,
  minimum = 60
): ArtistMatch<T> {
  let feature: T | null = null;
  let best = minimum - 1;

  for (const artist of artists) {
    const score = artistMatchScore(artist.name, query);
    if (score > best) {
      best = score;
      feature = artist;
    }
  }

  if (!feature) return { feature: null, rest: artists };
  return { feature, rest: artists.filter((artist) => artist !== feature) };
}
