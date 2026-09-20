import { cacheKey, type CacheStore } from '../lib/cache.js';
import { hasTimestamps, parseLyrics } from '../lib/lrc.js';
import { scoreLyrics } from '../lib/matcher.js';
import type { LrclibEntry, LrclibProvider } from '../providers/lrclib.js';
import type { LyricaProvider } from '../providers/lyrica.js';
import type { LyricsPayload } from '../types.js';

const HIT_TTL_SECONDS = 2_592_000;
const MISS_TTL_SECONDS = 86_400;

export class LyricsService {
  public constructor(
    private readonly lrclib: LrclibProvider,
    private readonly cache: CacheStore,
    private readonly lyrica?: LyricaProvider
  ) {}

  public async find(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsPayload | null> {
    const cleaned = cleanLyricsQuery(title, artist);
    const key = cacheKey('lyrics', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    const missKey = cacheKey('lyrics', 'miss', cleaned.title, cleaned.artist, String(duration ?? 0), String(syncedOnly));
    if (await this.cache.get<boolean>(missKey)) {
      return null;
    }
    const cached = await this.cache.get<LyricsPayload>(key);
    if (cached) {
      return cached;
    }

    const precise = await this.lrclib.get(cleaned.title, cleaned.artist, duration);
    const fromGet = precise && isUsable(precise, syncedOnly) ? precise : null;
    const candidates = fromGet ? [fromGet] : (await this.lrclib.search(cleaned.title, cleaned.artist, duration)).filter((candidate) => isUsable(candidate, syncedOnly));
    const best = candidates.sort((left, right) => scoreLyrics(right, cleaned.title, duration).score - scoreLyrics(left, cleaned.title, duration).score)[0];
    if (best) {
      const payload = toPayload(best, cleaned.title, duration, fromGet === best ? 'LRCLIB' : 'LRCLIB-search');
      await this.cache.set(key, payload, HIT_TTL_SECONDS);
      return payload;
    }

    const lyrica = this.lyrica ? await this.lyrica.find(cleaned.title, cleaned.artist, duration, syncedOnly) : null;
    if (lyrica) {
      const payload = toPayloadFromRaw(lyrica.lyrics, cleaned.title, duration, lyrica.source);
      await this.cache.set(key, payload, HIT_TTL_SECONDS);
      return payload;
    }

    await this.cache.set(missKey, true, MISS_TTL_SECONDS);
    return null;
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
