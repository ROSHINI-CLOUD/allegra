import { cacheKey, type CacheStore } from '../lib/cache.js';
import { parseLyrics } from '../lib/lrc.js';
import { scoreLyrics } from '../lib/matcher.js';
import type { LrclibEntry, LrclibProvider } from '../providers/lrclib.js';
import type { LyricsPayload } from '../types.js';

export class LyricsService {
  public constructor(
    private readonly lrclib: LrclibProvider,
    private readonly cache: CacheStore
  ) {}

  public async find(
    title: string,
    artist: string,
    duration: number | undefined,
    syncedOnly: boolean
  ): Promise<LyricsPayload | null> {
    const key = cacheKey('lyrics', title, artist, String(duration ?? 0), String(syncedOnly));
    const missKey = cacheKey('lyrics', 'miss', title, artist, String(duration ?? 0), String(syncedOnly));
    if (await this.cache.get<boolean>(missKey)) {
      return null;
    }
    const cached = await this.cache.get<LyricsPayload>(key);
    if (cached) {
      return cached;
    }

    const precise = await this.lrclib.get(title, artist, duration);
    const candidates = precise ? [precise] : await this.lrclib.search(title, artist, duration);
    const valid = candidates.filter((candidate) => isUsable(candidate, syncedOnly));
    const best = valid.sort((left, right) => scoreLyrics(right, title, duration).score - scoreLyrics(left, title, duration).score)[0];
    if (!best) {
      await this.cache.set(missKey, true, 86_400);
      return null;
    }

    const raw = best.syncedLyrics?.trim() || best.plainLyrics?.trim() || '';
    const score = scoreLyrics(best, title, duration);
    const payload: LyricsPayload = {
      source: best.syncedLyrics?.trim() ? precise === best ? 'LRCLIB' : 'LRCLIB-search' : 'interpolated',
      type: best.syncedLyrics?.trim() ? 'synced' : 'plain',
      matchScore: score.score,
      matchReason: score.reason,
      lines: parseLyrics(raw, duration ?? best.duration ?? 180)
    };
    await this.cache.set(key, payload, 2_592_000);
    return payload;
  }

  public async search(title: string, artist: string, duration?: number): Promise<Array<{
    readonly title: string;
    readonly artist: string;
    readonly duration?: number;
    readonly type: 'synced' | 'plain';
    readonly matchScore: number;
    readonly matchReason: string;
  }>> {
    const entries = await this.lrclib.search(title, artist, duration);
    return entries
      .filter((entry) => isUsable(entry, false))
      .map((entry) => {
        const score = scoreLyrics(entry, title, duration);
        return {
          title: entry.trackName ?? title,
          artist: entry.artistName ?? artist,
          ...(entry.duration !== undefined ? { duration: entry.duration } : {}),
          type: entry.syncedLyrics?.trim() ? 'synced' as const : 'plain' as const,
          matchScore: score.score,
          matchReason: score.reason
        };
      })
      .sort((left, right) => right.matchScore - left.matchScore);
  }
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
