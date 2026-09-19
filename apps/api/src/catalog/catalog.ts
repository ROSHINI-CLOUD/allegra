import { ProviderUnavailableError, NotFoundError, TimeoutError } from '../lib/errors.js';
import { cacheKey, type CacheStore } from '../lib/cache.js';
import { CircuitBreaker } from '../lib/circuitBreaker.js';
import { normalizeSong } from '../lib/normalize.js';
import type { GaanaProvider } from '../providers/gaana.js';
import type { ProviderResult, SaavnProvider, SaavnSong } from '../providers/saavn.js';
import type { HomePayload, UnifiedSong } from '../types.js';

export interface CatalogSearch {
  readonly results: UnifiedSong[];
  readonly source: 'Saavn' | 'Gaana';
}

export interface CatalogOptions {
  readonly saavn: SaavnProvider;
  readonly gaana: GaanaProvider;
  readonly cache: CacheStore;
}

export class CatalogService {
  private readonly saavn: SaavnProvider;
  private readonly gaana: GaanaProvider;
  private readonly cache: CacheStore;
  private readonly saavnBreaker = new CircuitBreaker();
  private readonly gaanaBreaker = new CircuitBreaker();

  public constructor(options: CatalogOptions) {
    this.saavn = options.saavn;
    this.gaana = options.gaana;
    this.cache = options.cache;
  }

  public async search(query: string, limit: number, page: number): Promise<CatalogSearch> {
    const key = cacheKey('search', query, String(limit), String(page));
    const cached = await this.cache.get<CatalogSearch>(key);
    if (cached) {
      return cached;
    }

    const saavn = await this.call(this.saavnBreaker, () => this.saavn.search(query, limit, page));
    if (!saavn.ok) {
      throw unavailable(saavn.reason);
    }

    let raw = saavn.data;
    let source: 'Saavn' | 'Gaana' = 'Saavn';
    if (raw.length === 0) {
      const gaana = await this.tryGaana(query, limit, page);
      if (gaana) {
        raw = gaana;
        source = 'Gaana';
      }
    }

    const value = {
      results: normalizeMany(raw, source),
      source
    } satisfies CatalogSearch;
    await this.cache.set(key, value, 3600);
    return value;
  }

  public async getSong(id: string): Promise<UnifiedSong> {
    const key = cacheKey('song', id);
    const cached = await this.cache.get<UnifiedSong>(key);
    if (cached) {
      return cached;
    }

    const result = await this.call(this.saavnBreaker, () => this.saavn.getSong(id));
    if (!result.ok) {
      throw result.reason === 'timeout' ? new TimeoutError() : new NotFoundError();
    }
    if (!result.data) {
      throw new NotFoundError();
    }
    const song = normalizeSong(result.data, 'Saavn');
    if (!song) {
      throw new NotFoundError();
    }
    await this.cache.set(key, song, 21_600);
    return song;
  }

  public async getSongs(ids: string[]): Promise<UnifiedSong[]> {
    const songs = await Promise.all(ids.map(async (id) => {
      try {
        return await this.getSong(id);
      } catch {
        return null;
      }
    }));
    return songs.filter((song): song is UnifiedSong => song !== null);
  }

  public async getSuggestions(id: string, limit: number): Promise<UnifiedSong[]> {
    const key = cacheKey('suggestions', id, String(limit));
    const cached = await this.cache.get<UnifiedSong[]>(key);
    if (cached) {
      return cached;
    }

    const result = await this.call(this.saavnBreaker, () => this.saavn.getSuggestions(id, limit));
    if (!result.ok) {
      throw unavailable(result.reason);
    }
    const songs = normalizeMany(result.data, 'Saavn');
    await this.cache.set(key, songs, 86_400);
    return songs;
  }

  public async getHome(): Promise<HomePayload> {
    const cached = await this.cache.get<HomePayload>('home:default');
    if (cached) {
      return cached;
    }

    const [trending, madeForYou, recommended] = await Promise.all([
      this.search('top songs', 10, 0),
      this.search('made for you', 10, 0),
      this.search('new music', 10, 0)
    ]);
    const home = {
      trending: trending.results,
      madeForYou: madeForYou.results,
      recommended: recommended.results
    } satisfies HomePayload;
    await this.cache.set('home:default', home, 3600);
    return home;
  }

  private async tryGaana(query: string, limit: number, page: number): Promise<SaavnSong[] | null> {
    try {
      const gaana = await this.call(this.gaanaBreaker, () => this.gaana.search(query, limit, page));
      if (gaana.ok && gaana.data.length > 0) {
        return gaana.data;
      }
    } catch {
      return null;
    }
    return null;
  }

  private async call<T>(
    breaker: CircuitBreaker,
    operation: () => Promise<ProviderResult<T>>
  ): Promise<ProviderResult<T>> {
    if (breaker.isOpen) {
      throw new ProviderUnavailableError();
    }
    const result = await operation();
    if (result.ok) {
      breaker.success();
    } else {
      breaker.failure();
    }
    return result;
  }
}

function unavailable(reason: 'timeout' | 'error' | undefined): Error {
  return reason === 'timeout' ? new TimeoutError() : new ProviderUnavailableError();
}

function normalizeMany(raw: SaavnSong[], source: 'Saavn' | 'Gaana'): UnifiedSong[] {
  return raw
    .map((song) => normalizeSong(song, source))
    .filter((song): song is UnifiedSong => song !== null)
    .sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === 'Saavn' ? -1 : 1;
      }
      return right.playCount - left.playCount;
    });
}
