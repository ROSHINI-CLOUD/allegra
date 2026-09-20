import { ArtworkService } from './services/artwork.js';
import { LyricsService } from './services/lyrics.js';
import { CatalogService } from './catalog/catalog.js';
import { ConvexUserStore } from './db/convex.js';
import { AuthService } from './auth/auth.js';
import { MemoryCacheStore, type CacheStore } from './lib/cache.js';
import { StreamResolver } from './lib/streamResolver.js';
import { GaanaProvider } from './providers/gaana.js';
import { ItunesProvider } from './providers/itunes.js';
import { LrclibProvider } from './providers/lrclib.js';
import { LyricaProvider } from './providers/lyrica.js';
import { SaavnProvider } from './providers/saavn.js';
import { MemoryUserStore, type UserStore } from './user/store.js';

export interface ServiceOptions {
  readonly saavnApiUrl?: string;
  readonly saavnSecondaryApiUrl?: string;
  readonly gaanaApiUrl?: string;
  readonly lrclibApiUrl?: string;
  readonly lyricaApiUrl?: string;
  readonly cacheStore?: CacheStore;
  readonly userStore?: UserStore;
  /** With both set, user data lives in Convex; otherwise it stays in memory. */
  readonly convexUrl?: string;
  readonly convexServerSecret?: string;
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
  const cache = options.cacheStore ?? new MemoryCacheStore();

  const saavn = new SaavnProvider({
    baseUrl: options.saavnApiUrl ?? 'https://example.invalid/api',
    ...(options.saavnSecondaryApiUrl ? { secondaryBaseUrl: options.saavnSecondaryApiUrl } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  const gaana = new GaanaProvider({
    baseUrl: options.gaanaApiUrl ?? 'https://example.invalid/api',
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  const catalog = new CatalogService({ saavn, gaana, cache });
  const userStore = options.userStore ?? (options.convexUrl && options.convexServerSecret
    ? new ConvexUserStore({ url: options.convexUrl, serverSecret: options.convexServerSecret })
    : new MemoryUserStore());

  return {
    catalog,
    stream: new StreamResolver({ saavn, cache, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }),
    artwork: new ArtworkService(new ItunesProvider({ ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }), catalog, cache),
    lyrics: new LyricsService(new LrclibProvider({
      ...(options.lrclibApiUrl ? { baseUrl: options.lrclibApiUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }), cache, options.lyricaApiUrl ? new LyricaProvider({ baseUrl: options.lyricaApiUrl, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }) : undefined),
    auth: new AuthService(userStore, options.jwtSecret)
  };
}
