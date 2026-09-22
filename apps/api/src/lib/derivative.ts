/**
 * Telling an original recording from an edit of one.
 *
 * Searching a popular song returns the studio master once and then a long tail of
 * things made *from* it: sped up, slowed, reverbed, remixed, covered on a piano,
 * sung over on TikTok. The provider ranks those by play count like anything else, so
 * a viral edit regularly sits above the record it was cut from.
 *
 * Markers are only trusted inside a qualifier — a bracketed segment or the part after
 * a dash — or in the artist credit. A song genuinely called "Cover Me" or "Live and
 * Let Die" keeps its place; `Another Love (slowed + reverb)` does not.
 */

export type DerivativeKind = 'speed' | 'remix' | 'cover' | 'live';

interface Rule {
  readonly kind: DerivativeKind;
  /** Matched against bracketed segments and anything after a dash. */
  readonly inQualifier: RegExp;
  /** Matched against the artist credit. Narrower — artist names are real words. */
  readonly inArtist?: RegExp;
}

/*
 * Order matters: a title can carry two markers ("slowed remix") and the first rule to
 * match names it. Speed edits come first because they are the ones that go viral.
 */
const RULES: readonly Rule[] = [
  {
    kind: 'speed',
    inQualifier: /\b(sped\s*up|speed(?:ed)?\s*up|slowed|slow(?:ed)?\s*down|reverb|nightcore|daycore|chopped|screwed|8d\s*audio|lo-?fi)\b/iu,
    inArtist: /\b(sped\s*up|slowed|nightcore|daycore|lo-?fi|8d\s*audio)\b/iu
  },
  {
    kind: 'remix',
    inQualifier: /\b(remix|bootleg|mash-?up|vip\s*mix|re-?edit|rework|extended\s*mix|club\s*mix|radio\s*edit|flip)\b/iu
  },
  {
    kind: 'cover',
    inQualifier: /\b(covers?|karaoke|tribute|made\s*famous\s*by|in\s*the\s*style\s*of|(?:piano|acoustic|guitar|violin|female|male|reprise)\s*version|instrumental|backing\s*track)\b/iu,
    inArtist: /\b(karaoke|tribute\s*band|instrumental)\b/iu
  },
  {
    kind: 'live',
    inQualifier: /\b(live\s*(?:at|from|in|on|session|version)|unplugged)\b/iu
  }
];

/**
 * The parts of a title where an edit announces itself: `(slowed down)`, `[Remix]`,
 * `Song - Live at Wembley`. The bare title is deliberately excluded.
 */
function qualifierScope(title: string): string {
  const parts: string[] = [];
  for (const match of title.matchAll(/[([{]([^)\]}]*)[)\]}]/gu)) {
    parts.push(match[1] ?? '');
  }
  const [, ...afterDash] = title.split(/\s[-–—]\s/u);
  parts.push(...afterDash);
  return parts.join(' ');
}

/** What kind of edit this row is, or null when it reads as an original recording. */
export function derivativeKind(title: string, artist: string): DerivativeKind | null {
  const scope = qualifierScope(title);
  for (const rule of RULES) {
    if (scope && rule.inQualifier.test(scope)) return rule.kind;
    if (rule.inArtist?.test(artist)) return rule.kind;
  }
  return null;
}

export function isDerivative(song: { readonly title: string; readonly artist: string }): boolean {
  return derivativeKind(song.title, song.artist) !== null;
}

/**
 * True when the listener asked for an edit — "another love slowed", "karaoke bohemian
 * rhapsody". Demoting edits then would hide exactly what they typed.
 */
export function queryWantsDerivative(query: string): boolean {
  return RULES.some((rule) => rule.inQualifier.test(query));
}
