/** Calm defaults when there is no signed-in taste yet. Never leave the chip row empty. */
export const GUEST_MOOD_PROMPTS = ['late night', 'soft focus', 'golden hour', 'focus flow'] as const;

export interface MoodTasteInput {
  readonly topArtists: readonly { readonly name: string; readonly score: number }[];
  readonly languages: readonly { readonly name: string; readonly score: number }[];
  readonly onboarded: boolean;
}

const LANGUAGE_CHIPS: Record<string, readonly string[]> = {
  hindi: ['Hindi essentials', 'Bollywood nights'],
  tamil: ['Tamil nights', 'Kollywood heat'],
  telugu: ['Telugu grooves', 'Tollywood pulse'],
  punjabi: ['Punjabi energy', 'Bhangra drive'],
  english: ['English essentials', 'Indie english'],
  malayalam: ['Malayalam moods', 'Mollywood nights'],
  kannada: ['Kannada classics'],
  bengali: ['Bengali evenings'],
  marathi: ['Marathi mornings'],
  gujarati: ['Gujarati grooves'],
  urdu: ['Urdu ghazals'],
  spanish: ['Spanish heat'],
  korean: ['K-pop nights'],
  japanese: ['J-pop focus']
};

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function timeOfDayChip(now: Date): string {
  const hour = now.getHours();
  if (hour >= 22 || hour < 5) return 'late night';
  if (hour >= 5 && hour < 11) return 'morning light';
  if (hour >= 16 && hour < 19) return 'golden hour';
  if (hour >= 19) return 'evening unwind';
  return 'soft focus';
}

function languageChip(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  const mapped = LANGUAGE_CHIPS[key];
  if (mapped?.[0]) return mapped[0];
  return `${titleCase(name)} essentials`;
}

function artistChip(name: string): string {
  const clean = name.trim();
  if (!clean) return 'artist radio';
  const first = clean.split(/\s+/)[0] ?? clean;
  return `${first} radio`;
}

/**
 * Derive 3-6 search chips from taste. Guests / not-onboarded -> calm static defaults.
 */
export function deriveMoodPrompts(taste: MoodTasteInput | null | undefined, now = new Date()): string[] {
  if (!taste || !taste.onboarded) {
    return [...GUEST_MOOD_PROMPTS];
  }

  const seen = new Set<string>();
  const chips: string[] = [];

  const push = (label: string | null | undefined): void => {
    const value = label?.trim();
    if (!value) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    chips.push(value);
  };

  for (const language of taste.languages.slice(0, 3)) {
    push(languageChip(language.name));
    if (chips.length >= 4) break;
  }

  for (const artist of taste.topArtists.slice(0, 3)) {
    push(artistChip(artist.name));
    if (chips.length >= 5) break;
  }

  push(timeOfDayChip(now));

  for (const fallback of GUEST_MOOD_PROMPTS) {
    if (chips.length >= 4) break;
    push(fallback);
  }

  return chips.slice(0, 6);
}
