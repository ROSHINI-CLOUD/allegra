import { cacheKey, cachedLookup, type CacheStore } from '../lib/cache.js';
import type { CanvasProvider, CanvasQuery } from '../providers/animatedArtwork.js';
import type { MotionArtwork } from '../types.js';

const HIT_TTL_SECONDS = 86_400;
const MISS_TTL_SECONDS = 21_600;

/** Finds the full albums a song appears on (the iTunes provider implements this). */
export interface AlbumLookup {
  albumsFor(title: string, artist: string): Promise<string[]>;
}

/**
 * Tries each motion-artwork provider in order (official Apple token first when configured, then
 * the public artwork APIs). The first match wins; each song reaches upstream once per TTL.
 *
 * Apple attaches motion artwork to albums, while catalogs often file a hit under its single — so
 * when every provider misses, the song's full albums are looked up and tried once each.
 */
export class CanvasService {
  public constructor(
    private readonly providers: readonly CanvasProvider[],
    private readonly cache: CacheStore,
    private readonly albums?: AlbumLookup
  ) {}

  public async find(query: CanvasQuery): Promise<MotionArtwork | null> {
    if (this.providers.length === 0) return null;
    return cachedLookup(this.cache, {
      key: cacheKey('apple-motion-art', query.title, query.artist, query.album ?? ''),
      hitTtlSeconds: HIT_TTL_SECONDS,
      missTtlSeconds: MISS_TTL_SECONDS,
      load: async () => {
        const direct = await this.firstMatch(query);
        if (direct || !this.albums) return direct;
        const current = query.album?.trim().toLocaleLowerCase();
        const parents = (await this.albums.albumsFor(query.title, query.artist))
          .filter((album) => album.trim().toLocaleLowerCase() !== current);
        for (const album of parents) {
          const artwork = await this.firstMatch({ ...query, album });
          if (artwork) return artwork;
        }
        return null;
      }
    });
  }

  private async firstMatch(query: CanvasQuery): Promise<MotionArtwork | null> {
    for (const provider of this.providers) {
      const artwork = await provider.find(query);
      if (artwork) return artwork;
    }
    return null;
  }
}
