import { cacheKey, type CacheStore } from '../lib/cache.js';
import { hasTimestamps, parseLyrics } from '../lib/lrc.js';
import { scoreLyrics } from '../lib/matcher.js';
import type { BetterLyricsProvider } from '../providers/betterlyrics.js';
import type { LrclibEntry, LrclibProvider } from '../providers/lrclib.js';
import type { LyricaProvider } from '../providers/lyrica.js';
import type { LyricsPayload } from '../types.js';

const HIT_TTL_SECONDS = 2_592_000;
const MISS_TTL_SECONDS = 86_400;

export class LyricsService {
  public constructor(
    private readonly lrclib: LrclibProvider,
    private readonly cache: CacheStore,
    private readonly lyrica?: LyricaProvider,
    private readonly betterLyrics?: BetterLyricsProvider
  ) {}

  /**
   * Cascade: LRCLIB (exact, then search, across title/artist variants) -> Lyrica and
   * BetterLyrics together -> a miss. Each tier is optional and never throws.
   */
  public async find(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsPayload | null> {
    const cleaned = cleanLyricsQuery(title, artist);
    const lead = leadArtist(cleaned.artist);
    const key = cacheKey('lyrics', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    const missKey = cacheKey('lyrics', 'miss', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    if (await this.cache.get<boolean>(missKey)) {
      return null;
    }
    const cached = await this.cache.get<LyricsPayload>(key);
    if (cached) {
      return cached;
    }

    // 1. LRCLIB. The first attempt is the song exactly as the catalog names it; later ones are
    //    looser (lead artist, each co-artist, title without a "- New Version" suffix) and must
    //    still resemble the requested title so a loose search never returns a different song.
    const attempts = lrclibAttempts(cleaned.title, cleaned.artist);
    for (const [index, attempt] of attempts.entries()) {
      const payload = await this.fromLrclib(attempt.title, attempt.artist, cleaned.title, duration, syncedOnly, index > 0);
      if (payload) {
        await this.cache.set(key, payload, HIT_TTL_SECONDS);
        return payload;
      }
    }
    if (lead) {
      const loose = (await this.lrclib.searchText(`${cleaned.title} ${lead}`)).filter((entry) => isUsable(entry, syncedOnly) && titlesAlike(entry.trackName, cleaned.title));
      const best = loose.sort((left, right) => scoreLyrics(right, cleaned.title, duration).score - scoreLyrics(left, cleaned.title, duration).score)[0];
      if (best) {
        const payload = toPayload(best, cleaned.title, duration, 'LRCLIB-search');
        await this.cache.set(key, payload, HIT_TTL_SECONDS);
        return payload;
      }
    }

    // 2. The optional aggregators, asked together so a slow one does not delay the other.
    const [better, lyrica] = await Promise.all([
      this.betterLyrics ? this.betterLyrics.find(cleaned.title, lead || cleaned.artist, duration) : Promise.resolve(null),
      this.findLyrica(cleaned.title, cleaned.artist, lead, duration, syncedOnly)
    ]);
    const found = [better, lyrica]
      .filter((candidate): candidate is { readonly lyrics: string; readonly source: string } => candidate !== null)
      .map((candidate) => toPayloadFromRaw(candidate.lyrics, cleaned.title, duration, candidate.source))
      // Synced beats plain; on a tie BetterLyrics (listed first) wins.
      .sort((left, right) => Number(right.type === 'synced') - Number(left.type === 'synced'))[0];
    if (found) {
      await this.cache.set(key, found, HIT_TTL_SECONDS);
      return found;
    }

    await this.cache.set(missKey, true, MISS_TTL_SECONDS);
    return null;
  }

  private async fromLrclib(
    title: string,
    artist: string,
    requestedTitle: string,
    duration: number | undefined,
    syncedOnly: boolean,
    requireSimilarTitle: boolean
  ): Promise<LyricsPayload | null> {
    const precise = await this.lrclib.get(title, artist, duration);
    const fromGet = precise && isUsable(precise, syncedOnly) ? precise : null;
    const candidates = fromGet
      ? [fromGet]
      : (await this.lrclib.search(title, artist, duration)).filter((candidate) => isUsable(candidate, syncedOnly) && (!requireSimilarTitle || titlesAlike(candidate.trackName, requestedTitle)));
    const best = candidates.sort((left, right) => scoreLyrics(right, requestedTitle, duration).score - scoreLyrics(left, requestedTitle, duration).score)[0];
    return best ? toPayload(best, requestedTitle, duration, fromGet === best ? 'LRCLIB' : 'LRCLIB-search') : null;
  }

  private async findLyrica(
    title: string,
    artist: string,
    lead: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<{ readonly lyrics: string; readonly source: string } | null> {
    if (!this.lyrica) {
      return null;
    }
    const first = await this.lyrica.find(title, lead || artist, duration, syncedOnly);
    if (first || !lead || lead === artist) {
      return first;
    }
    return this.lyrica.find(title, artist, duration, syncedOnly);
  }

  public async search(title: string, artist: string, duration?: number): Promise<Array<{
    readonly title: string;
    readonly artist: string;
    readonly duration?: number;
    readonly type: 'synced' | 'plain';
    readonly matchScore: number;
    readonly matchReason: string;
  }>> {
    const cleaned = cleanLyricsQuery(title, artist);
    const entries = await this.lrclib.search(cleaned.title, cleaned.artist, duration);
    return entries
      .filter((entry) => isUsable(entry, false))
      .map((entry) => {
        const score = scoreLyrics(entry, cleaned.title, duration);
        return {
          title: entry.trackName ?? cleaned.title,
          artist: entry.artistName ?? cleaned.artist,
          ...(entry.duration !== undefined ? { duration: entry.duration } : {}),
          type: entry.syncedLyrics?.trim() ? 'synced' as const : 'plain' as const,
          matchScore: score.score,
          matchReason: score.reason
        };
      })
      .sort((left, right) => right.matchScore - left.matchScore);
  }
}

export function cleanLyricsQuery(title: string, artist: string): { title: string; artist: string } {
  let cleanSong = title
    .replace(/\(Lyrics\)/gi, '')
    .replace(/\(Official.*?\)/gi, '')
    .replace(/\(MP3_\d+K\)/gi, '')
    .replace(/\(Audio\)/gi, '')
    // Catalog decorations that no lyrics database has in a track name: (From "Jawan"),
    // (Original Motion Picture Soundtrack), (Telugu), [Remastered] ...
    .replace(/\((?:from|original|remaster|feat|ft)\b[^)]*\)/gi, '')
    .replace(/\((?:hindi|telugu|tamil|kannada|malayalam|punjabi|bengali|marathi|english)\)/gi, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\s+-\s+(?:from|original|remaster)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  let cleanArtist = artist === 'Unknown Artist' ? '' : artist.trim();

  if (!cleanArtist && cleanSong.includes(' - ')) {
    const parts = cleanSong.split(' - ');
    cleanArtist = (parts[0] ?? '').trim();
    cleanSong = parts.slice(1).join(' - ').trim();
  }

  return {
    title: cleanSong || title.trim(),
    artist: cleanArtist || artist.trim()
  };
}

/** The first credited artist of "A, B & C feat. D". */
export function leadArtist(artist: string): string {
  return (artist.split(/,|&| feat\.? | ft\.? | x /i)[0] ?? artist).trim();
}

/** Ordered, de-duplicated (title, artist) pairs to try against LRCLIB, exact pair first. */
function lrclibAttempts(title: string, artist: string): Array<{ readonly title: string; readonly artist: string }> {
  const lead = leadArtist(artist);
  const shortTitle = (title.split(/\s+-\s+/)[0] ?? title).trim();
  const coArtists = artist.split(/,|&| feat\.? | ft\.? | x /i).map((name) => name.trim()).filter(Boolean).slice(1, 3);
  const candidates = [
    { title, artist },
    { title, artist: lead },
    ...(shortTitle && shortTitle !== title ? [{ title: shortTitle, artist: lead }] : []),
    ...coArtists.map((name) => ({ title, artist: name }))
  ];
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      const key = `${candidate.title.toLocaleLowerCase()}|${candidate.artist.toLocaleLowerCase()}`;
      if (!candidate.title || !candidate.artist || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

/** Loose title guard for fuzzy searches: one name contains the other after normalising. */
function titlesAlike(found: string | undefined, wanted: string): boolean {
  const normalise = (value: string): string => value.toLocaleLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const left = normalise(found ?? '');
  const right = normalise(wanted);
  return left.length > 0 && right.length > 0 && (left.includes(right) || right.includes(left));
}

function toPayload(best: LrclibEntry, title: string, duration: number | undefined, source: 'LRCLIB' | 'LRCLIB-search'): LyricsPayload {
  const raw = best.syncedLyrics?.trim() || best.plainLyrics?.trim() || '';
  const score = scoreLyrics(best, title, duration);
  const synced = Boolean(best.syncedLyrics?.trim());
  return {
    source: synced ? source : 'interpolated',
    type: synced ? 'synced' : 'plain',
    matchScore: score.score,
    matchReason: score.reason,
    lines: parseLyrics(raw, duration ?? best.duration ?? 180)
  };
}

function toPayloadFromRaw(raw: string, title: string, duration: number | undefined, source: string): LyricsPayload {
  const synced = hasTimestamps(raw);
  const lines = parseLyrics(raw, duration ?? 180);
  return {
    source: synced ? source : 'interpolated',
    type: synced ? 'synced' : 'plain',
    matchScore: synced ? 50 : 20,
    matchReason: `${title} • ${synced ? 'Synced' : 'Plain text'}`,
    lines
  };
}

function isUsable(entry: LrclibEntry, syncedOnly: boolean): boolean {
  const synced = entry.syncedLyrics?.trim() ?? '';
  const plain = entry.plainLyrics?.trim() ?? '';
  if (containsHtml(synced) || containsHtml(plain)) {
    return false;
  }
  return Boolean((syncedOnly ? synced : synced || plain));
}

function containsHtml(value: string): boolean {
  return /<div|<html|<!doctype/i.test(value);
}
