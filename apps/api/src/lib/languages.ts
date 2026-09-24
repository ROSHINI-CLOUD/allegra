/**
 * Song languages as the catalog spells them (lowercase), in the order the app offers them.
 * A listener's language setting is a subset of these; an empty setting means every language.
 * Mirrored for the web in packages/shared/languages.ts.
 */
export const LANGUAGES = [
  'hindi',
  'english',
  'tamil',
  'telugu',
  'punjabi',
  'malayalam',
  'kannada',
  'bengali',
  'marathi',
  'gujarati',
  'bhojpuri',
  'urdu',
  'odia',
  'haryanvi',
  'rajasthani',
  'assamese'
] as const;

export type Language = (typeof LANGUAGES)[number];

const KNOWN = new Set<string>(LANGUAGES);
const MAX_LANGUAGES = 8;

/**
 * Accepts `"hindi,tamil"`, `["Hindi", "Tamil"]` or anything else a client sends, and keeps only
 * known languages, deduplicated, in the app's order. Anything unrecognised is dropped, never an error.
 */
export function parseLanguages(value: unknown): Language[] {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const wanted = new Set(
    parts
      .filter((part): part is string => typeof part === 'string')
      .map((part) => part.trim().toLowerCase())
      .filter((part) => KNOWN.has(part))
  );
  return LANGUAGES.filter((language) => wanted.has(language)).slice(0, MAX_LANGUAGES);
}

/** Stable, order-independent form for cache keys and settings storage. */
export function languagesKey(languages: readonly string[]): string {
  return [...languages].sort().join(',');
}

/**
 * Whether a song belongs on a language-filtered surface. With no preference everything passes;
 * with one, a song must carry one of the chosen languages — an unlabelled song is left out, since
 * the listener asked for only these.
 */
export function inLanguages(song: { readonly language?: string | undefined }, languages: readonly string[]): boolean {
  if (languages.length === 0) return true;
  const language = song.language?.trim().toLowerCase();
  return Boolean(language) && languages.includes(language!);
}

/** ISO 639 codes for the translation provider. Dialects without their own code read as Hindi. */
const ISO: Readonly<Record<Language, string>> = {
  hindi: 'hi',
  english: 'en',
  tamil: 'ta',
  telugu: 'te',
  punjabi: 'pa',
  malayalam: 'ml',
  kannada: 'kn',
  bengali: 'bn',
  marathi: 'mr',
  gujarati: 'gu',
  bhojpuri: 'hi',
  urdu: 'ur',
  odia: 'or',
  haryanvi: 'hi',
  rajasthani: 'hi',
  assamese: 'as'
};

/** ISO code for a language name ("Hindi", "tamil", "en"), or null when unknown. */
export function isoLanguage(value: string | undefined): string | null {
  const name = value?.trim().toLowerCase();
  if (!name) return null;
  if (KNOWN.has(name)) return ISO[name as Language];
  return Object.values(ISO).includes(name) ? name : null;
}
