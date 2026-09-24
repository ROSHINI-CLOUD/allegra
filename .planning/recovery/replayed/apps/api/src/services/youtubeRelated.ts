import { cachedLookup, cacheKey, type CacheStore } from '../lib/cache.js';
import { songIdentity } from '../lib/normalize.js';
import { plainTitle, sameSong, type YouTubeMusicTrack } from '../providers/youtubeMusic.js';
import type { UnifiedSong } from '../types.js';
import type { RelatedSongSource } from './recommendations.js';

/** The YouTube Music calls this needs — narrow so tests can fake them. */
export interface RadioSource {
  findSong(title: string, artist: string): Promise<YouTubeMusicTrack | null>;
  radio(videoId: string, limit: number): Promise<YouTubeMusicTrack[]>;
}

export interface MatchCatalog {
  search(query: string, limit: number, page: number): Promise<{ readonly results: readonly UnifiedSong[] }>;
}

const DAY_SECONDS = 86_400;
const RADIO_DEPTH = 25;
const MATCH_CONCURRENCY = 4;
const DURATION_TOLERANCE_SECONDS = 15;
const BUDGET_MS = 8_000;

/**
 * "Listeners who play this go on to play…", from YouTube Music's song radio, turned back into
 * catalog rows. YouTube is only ever the pointer: every song returned is a JioSaavn row found by
 * title and artist, so playback, the stream route and the byte-range rule are untouched. A track
 * with no confident catalog match is dropped rather than guessed.
 */
export class YouTubeRelatedSource implements RelatedSongSource {
  public constructor(
    private readonly youtube: RadioSource,
    private readonly catalog: MatchCatalog,
    private readonly cache: CacheStore,
    private readonly budgetMs = BUDGET_MS
  ) {}

  public async related(seed: UnifiedSong, limit: number): Promise<UnifiedSong[]> {
    // A slow provider must not hold the shelf up. Matches that land after the deadline are
    // still cached, so the next shelf build gets them.
    return withDeadline(this.load(seed, limit), this.budgetMs, []);
  }

  private async load(seed: UnifiedSong, limit: number): Promise<UnifiedSong[]> {
    const tracks = await cachedLookup(this.cache, {
      key: cacheKey('ytm-radio', 'v1', songIdentity(seed)),
      hitTtlSeconds: DAY_SECONDS,
      // Short: a miss is as likely to be YouTube briefly refusing as a song it does not have.
      missTtlSeconds: 3_600,
      load: async () => {
        const match = await this.youtube.findSong(seed.title, leadArtist(seed.artist));
        if (!match) return null;
        const radio = await this.youtube.radio(match.videoId, RADIO_DEPTH);
        return radio.length > 0 ? radio : null;
      }
    });
    if (!tracks) return [];
    const matched = await mapLimit(tracks.slice(0, limit), MATCH_CONCURRENCY, (track) => this.toCatalog(track));
    return matched.filter((song): song is UnifiedSong => song !== null);
  }

  private async toCatalog(track: YouTubeMusicTrack): Promise<UnifiedSong | null> {
    const artist = track.artists[0];
    if (!artist) return null;
    try {
      return await cachedLookup(this.cache, {
        key: cacheKey('ytm-match', 'v1', track.videoId),
        hitTtlSeconds: 7 * DAY_SECONDS,
        missTtlSeconds: DAY_SECONDS,
        load: async () => {
          const { results } = await this.catalog.search(`${plainTitle(track.title)} ${artist}`, 5, 0);
          return results.find((song) => sameSong(track, song.title, song.artist) && closeDuration(track, song)) ?? null;
        }
      });
    } catch {
      // A catalog error is not "no match": leave it uncached so the next build retries.
      return null;
    }
  }
}

function leadArtist(artist: string): string {
  return artist.split(/\s*(?:,|&)\s*/)[0]?.trim() || artist;
}

function closeDuration(track: YouTubeMusicTrack, song: UnifiedSong): boolean {
  if (!track.duration || !song.duration) return true;
  return Math.abs(track.duration - song.duration) <= DURATION_TOLERANCE_SECONDS;
}

async function mapLimit<T, R>(items: readonly T[], concurrency: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([work.catch(() => fallback), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
