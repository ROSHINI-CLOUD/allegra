import { ArtworkService } from './services/artwork.js';
import { LyricsService } from './services/lyrics.js';
import { CatalogService } from './catalog/catalog.js';
import { DynamoCacheStore, DynamoUserStore } from './db/dynamo.js';
import { AuthService } from './auth/auth.js';
import { LayeredCacheStore, MemoryCacheStore, type CacheStore } from './lib/cache.js';
import { StreamResolver } from './lib/streamResolver.js';
import { GaanaProvider } from './providers/gaana.js';
import { ItunesProvider } from './providers/itunes.js';
import { LrclibProvider } from './providers/lrclib.js';
import { SaavnProvider } from './providers/saavn.js';
import { MemoryUserStore, type UserStore } from './user/store.js';

export interface ServiceOptions {
  readonly saavnApiUrl?: string;
  readonly gaanaApiUrl?: string;
  readonly lrclibApiUrl?: string;
  readonly cacheStore?: CacheStore;
  readonly userStore?: UserStore;
  readonly fetchImpl?: typeof fetch;
  readonly jwtSecret: string;
}

export interface AppServices {
  readonly catalog: CatalogService;
  readonly stream: StreamResolver;
  readonly artwork: ArtworkService;
  readonly lyrics: LyricsService;
  readonly auth: AuthService;
}

export function createServices(options: ServiceOptions): AppServices {
  const memoryCache = new MemoryCacheStore();
  let cache = options.cacheStore ?? memoryCache;
  const cacheTable = process.env.DDB_TABLE_CACHE;
  if (!options.cacheStore && cacheTable) {
    cache = new LayeredCacheStore(memoryCache, new DynamoCacheStore(cacheTable));
  }

  const saavn = new SaavnProvider({
    baseUrl: options.saavnApiUrl ?? 'https://example.invalid/api',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  const gaana = new GaanaProvider({
    baseUrl: options.gaanaApiUrl ?? 'https://example.invalid/api',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  const catalog = new CatalogService({ saavn, gaana, cache });
  const userStore = options.userStore ?? (process.env.DDB_TABLE_USERS
    ? new DynamoUserStore(process.env.DDB_TABLE_USERS)
    : new MemoryUserStore());

  return {
    catalog,
    stream: new StreamResolver({ saavn, cache, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }),
    artwork: new ArtworkService(new ItunesProvider({ ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }), catalog, cache),
    lyrics: new LyricsService(new LrclibProvider({
      ...(options.lrclibApiUrl ? { baseUrl: options.lrclibApiUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }), cache),
    auth: new AuthService(userStore, options.jwtSecret)
  };
}
