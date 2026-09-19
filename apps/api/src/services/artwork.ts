import { cacheKey, type CacheStore } from '../lib/cache.js';
import type { ItunesProvider } from '../providers/itunes.js';
import type { CatalogService } from '../catalog/catalog.js';

export class ArtworkService {
  public constructor(
    private readonly itunes: ItunesProvider,
    private readonly catalog: CatalogService,
    private readonly cache: CacheStore
  ) {}

  public async find(title: string, artist: string, limit: number): Promise<string[]> {
    const key = cacheKey('artwork', title, artist, String(limit));
    const cached = await this.cache.get<string[]>(key);
    if (cached) {
      return cached;
    }

    let urls = await this.itunes.search(`${title} ${artist}`, limit);
    const cleaned = clean(`${title} ${artist}`);
    if (urls.length === 0 && cleaned !== `${title} ${artist}`) {
      urls = await this.itunes.search(cleaned, limit);
    }
    if (urls.length === 0) {
      try {
        const result = await this.catalog.search(`${title} ${artist}`, limit, 0);
        urls = result.results.map((song) => song.artwork).filter(Boolean).slice(0, limit);
      } catch {
        urls = [];
      }
    }
    await this.cache.set(key, urls, 2_592_000);
    return urls;
  }
}

function clean(value: string): string {
  return value
    .replace(/\([^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\b(ft|feat|featuring|official|video|audio|lyrics)\b.*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}
