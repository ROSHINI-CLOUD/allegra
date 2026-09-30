/**
 * One song identity for Allegra web/API and LuvLyrics (apps/mobile).
 *
 * The same recording has a different id in each app: Allegra keeps the bare
 * catalog id plus a `source`, the phone uses `stream:saavn:<id>` for a streamed
 * song and a random id for a downloaded row. A `SongRef` ("saavn:<id>") is the
 * form that crosses between devices; `matchKey` finds the same song when there is
 * no id to compare (a download made before its origin was recorded, a local file).
 *
 * Imported by the phone through Metro, so this file imports nothing (see
 * tests/infra: shared packages import no npm packages).
 */

export const SONG_SOURCES = ['saavn', 'gaana'] as const;
export type SongSource = (typeof SONG_SOURCES)[number];
export type SongRef = `${SongSource}:${string}`;

/** Enough to show and find a song on another device without looking it up again. Duration in seconds. */
export interface SongSnapshot {
  readonly ref: SongRef;
  readonly title: string;
  readonly artist: string;
  readonly album?: string;
  readonly artwork: string;
  readonly duration: number;
}

const MOBILE_STREAM_PREFIX = 'stream:';

function isSource(value: string): value is SongSource {
  return (SONG_SOURCES as readonly string[]).includes(value);
}

/** `('Saavn', 'abc')` -> `'saavn:abc'`; null for a source other devices cannot play. */
export function songRef(source: string, id: string): SongRef | null {
  const lower = source.toLowerCase();
  const trimmed = id.trim();
  if (!isSource(lower) || !trimmed || trimmed.includes(':')) return null;
  return `${lower}:${trimmed}`;
}

export function parseSongRef(value: string): { readonly source: SongSource; readonly id: string } | null {
  const sep = value.indexOf(':');
  if (sep <= 0) return null;
  const ref = songRef(value.slice(0, sep), value.slice(sep + 1));
  return ref ? { source: ref.slice(0, sep) as SongSource, id: ref.slice(sep + 1) } : null;
}

/** An Allegra catalog row (`UnifiedSong`) -> its ref. */
export function fromAllegraSong(song: { readonly id: string; readonly source: string }): SongRef | null {
  return songRef(song.source, song.id);
}

/** The id Allegra's `/api/songs/:id` and `/api/stream/:id` take, or null (only Saavn rows hydrate by id). */
export function toAllegraId(ref: SongRef): string | null {
  const parsed = parseSongRef(ref);
  return parsed?.source === 'saavn' ? parsed.id : null;
}

/** A LuvLyrics song id -> its ref. Only streamed ids carry one (`stream:saavn:abc`). */
export function fromMobileId(id: string): SongRef | null {
  if (!id.startsWith(MOBILE_STREAM_PREFIX)) return null;
  const parsed = parseSongRef(id.slice(MOBILE_STREAM_PREFIX.length));
  return parsed ? `${parsed.source}:${parsed.id}` : null;
}

/** A ref -> the id LuvLyrics gives the streamed song. */
export function toMobileId(ref: SongRef): string {
  return `${MOBILE_STREAM_PREFIX}${ref}`;
}

// ── matchKey: the same song from any source ─────────────────────────────────
// Moved verbatim from apps/mobile/src/utils/downloadState.ts: the phone's
// download ticks and Liked songs already depend on exactly this behaviour.

/** The first credited artist: "A, B" / "A & B" / "A feat. B" -> "A". "Unknown Artist" -> "". */
export function leadArtist(artist: string | undefined | null): string {
  const lead = (artist ?? '').split(/,|&| feat\.? | ft\.? | x | with /i)[0]?.trim() ?? '';
  return lead && !/^unknown artist$/i.test(lead) ? lead : '';
}

function fold(value: string): string {
  let out = value.toLowerCase();
  try {
    out = out.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  } catch {
    // No normalize() on this engine: accents simply stay.
  }
  return out;
}

// Apostrophes and quotes go ("Don't" = "Dont"); other punctuation separates words.
function words(value: string): string {
  return value.replace(/['’"“”]/g, '').replace(/[\s\-_.,!?:;/&+·]+/g, ' ').trim();
}

function cleanTitle(title: string): string {
  return words(
    fold(title)
      .replace(/\s*[([].*?[)\]]/g, '') // (feat. …), [Official Video], (From "…")
      .replace(/\s+-\s+.*$/, '') // "Song - Remastered 2011"
      .replace(/\s+(feat|ft)\.?\s.*$/, '')
  );
}

function cleanArtist(artist: string | undefined | null): string {
  return words(fold(leadArtist(artist)));
}

/** The same song from any source: cleaned title + lead artist. */
export function matchKey(title: string, artist?: string | null): string {
  return `${cleanTitle(title)}|${cleanArtist(artist)}`;
}
