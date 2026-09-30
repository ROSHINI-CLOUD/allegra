import type { AppConfig } from './config.js';
import { ArtworkService } from './services/artwork.js';
import { LyricsService } from './services/lyrics.js';
import { RecommendationService } from './services/recommendations.js';
import { TranslationService } from './services/translation.js';
import { CatalogService } from './catalog/catalog.js';
import { ConvexCoverStorage, ConvexGrantLedger, ConvexUserStore } from './db/convex.js';
import { ConvexGateway } from './db/convexGateway.js';
import { MemoryGrantLedger, type GrantLedger } from './oauth/ledger.js';
import { AuthService } from './auth/auth.js';
import { ListenerActions } from './user/actions.js';
import { ConvexTokenVerifier, FirstMatchVerifier, GuestTokenVerifier, type TokenVerifier } from './auth/verifier.js';
import { MemoryCacheStore, type CacheStore } from './lib/cache.js';
import type { CoverStorage } from './lib/covers.js';
import { StreamResolver } from './lib/streamResolver.js';
import { GaanaProvider } from './providers/gaana.js';
import { ItunesProvider } from './providers/itunes.js';
import { LrclibProvider } from './providers/lrclib.js';
import { BetterLyricsProvider } from './providers/betterlyrics.js';
import { KuGouProvider } from './providers/kugou.js';
import { LyricaProvider } from './providers/lyrica.js';
import { UnisonProvider } from './providers/unison.js';
import { YouLyPlusProvider } from './providers/youlyplus.js';
import { MusicBrainzReleaseAuthority, type ReleaseAuthority } from './providers/musicbrainz.js';
import { SaavnProvider } from './providers/saavn.js';
import { MemoryUserStore, type UserStore } from './user/store.js';
import { ConvexLibraryStore } from './db/convexLibrary.js';

/**
 * Provider settings exactly as config.ts loads them (documented there). Each is optional here so a
 * test sets only what it uses; an unset optional provider is simply not built.
 */
type ProviderSettings = Partial<
  Pick<
    AppConfig,
    | 'version'
    | 'saavnApiUrl'
    | 'saavnSecondaryApiUrl'
    | 'gaanaApiUrl'
    | 'lrclibApiUrl'
    | 'lyricaApiUrl'
    | 'betterLyricsApiUrl'
    | 'betterLyricsApiKey'
    | 'youLyPlusServers'
    | 'unisonApiUrl'
    | 'kugouApiUrl'
    | 'musicBrainz'
    | 'translation'
    | 'convexUrl'
    | 'convexServerSecret'
    | 'convexSiteUrl'
  >
>;

export interface ServiceOptions extends ProviderSettings {
  readonly jwtSecret: string;
  readonly cacheStore?: CacheStore;
  readonly fetchImpl?: typeof fetch;
  /** Injected in tests so the election runs without reaching MusicBrainz. */
  readonly releaseAuthority?: ReleaseAuthority;
  readonly userStore?: UserStore;
  /** Verifier for signed-in accounts. Built from convexSiteUrl unless supplied (tests). */
  readonly accountVerifier?: TokenVerifier;
}

export interface AppServices {
  readonly catalog: CatalogService;
  readonly stream: StreamResolver;
  readonly artwork: ArtworkService;
  readonly lyrics: LyricsService;
  readonly auth: AuthService;
  /** What a listener does (likes, playlists, sharing, plays), for the routes and the MCP tools alike. */
  readonly actions: ListenerActions;
  readonly translation: TranslationService;
  readonly recommendations: RecommendationService;
  /** Playlist cover storage (Convex). Undefined without Convex: uploads answer 503. */
  readonly covers?: CoverStorage;
  /** Single use for MCP OAuth codes and refresh tokens. */
  readonly grants: GrantLedger;
  /** True when real (Google) accounts exist, so MCP connects require one rather than a guest. */
  readonly accountsEnabled: boolean;
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
  // Names the record behind a row the provider only has on a playlist.
  const releaseAuthority = options.releaseAuthority
    ?? (options.musicBrainz
      ? new MusicBrainzReleaseAuthority({
          baseUrl: options.musicBrainz.baseUrl,
          coverArtUrl: options.musicBrainz.coverArtUrl,
          contact: options.musicBrainz.contact,
          ...(options.version ? { appVersion: options.version } : {}),
          ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
        })
      : undefined);
  const catalog = new CatalogService({ saavn, gaana, cache, ...(releaseAuthority ? { releaseAuthority } : {}) });
  // With both set, listener data lives in Convex; otherwise it stays in memory.
  const convex = options.convexUrl && options.convexServerSecret
    ? new ConvexGateway({ url: options.convexUrl, serverSecret: options.convexServerSecret, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) })
    : undefined;
  const convexStore = convex ? new ConvexUserStore(convex) : undefined;
  const userStore = options.userStore ?? convexStore ?? new MemoryUserStore();

  // Guest tokens are ours; Convex Auth signs the ones that come back from Google.
  // Without a Convex site URL only guest sessions exist, which is how local dev runs.
  const guestVerifier = new GuestTokenVerifier(options.jwtSecret);
  const convexVerifier = options.accountVerifier
    ?? (options.convexSiteUrl ? new ConvexTokenVerifier({ siteUrl: options.convexSiteUrl }) : undefined);

  const fetchImpl = options.fetchImpl ? { fetchImpl: options.fetchImpl } : {};
  const stream = new StreamResolver({ saavn, cache, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const auth = new AuthService({
    store: userStore,
    guest: guestVerifier,
    verifier: new FirstMatchVerifier(guestVerifier, convexVerifier),
    ...(convexStore ? { directory: convexStore } : {}),
    // Likes and playlists live in Convex rows beside the profile; in memory otherwise.
    ...(convexStore && convex ? { library: new ConvexLibraryStore(convex) } : {})
  });
  // Playlist cover storage needs Convex; without it uploads answer 503.
  const covers = convex ? new ConvexCoverStorage(convex) : undefined;

  return {
    catalog,
    stream,
    artwork: new ArtworkService(new ItunesProvider({ ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }), catalog, cache),
    lyrics: new LyricsService(new LrclibProvider({
      ...(options.lrclibApiUrl ? { baseUrl: options.lrclibApiUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }), cache, {
      ...(options.lyricaApiUrl ? { lyrica: new LyricaProvider({ baseUrl: options.lyricaApiUrl, timeoutMs: 25_000, ...fetchImpl }) } : {}),
      ...(options.betterLyricsApiUrl ? { betterLyrics: new BetterLyricsProvider({ baseUrl: options.betterLyricsApiUrl, ...(options.betterLyricsApiKey ? { apiKey: options.betterLyricsApiKey } : {}), ...fetchImpl }) } : {}),
      ...(options.youLyPlusServers ? { youLyPlus: new YouLyPlusProvider({ servers: options.youLyPlusServers, ...fetchImpl }) } : {}),
      ...(options.unisonApiUrl ? { unison: new UnisonProvider({ baseUrl: options.unisonApiUrl, ...fetchImpl }) } : {}),
      ...(options.kugouApiUrl ? { kugou: new KuGouProvider({ baseUrl: options.kugouApiUrl, ...fetchImpl }) } : {})
    }),
    auth,
    actions: new ListenerActions(auth, userStore, catalog, covers),
    translation: new TranslationService(cache, {
      ...(options.translation?.baseUrl ? { baseUrl: options.translation.baseUrl } : {}),
      ...(options.translation?.contactEmail ? { contactEmail: options.translation.contactEmail } : {}),
      ...(options.translation?.fallbackBaseUrl ? { fallbackBaseUrl: options.translation.fallbackBaseUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }),
    recommendations: new RecommendationService(catalog, cache),
    ...(covers ? { covers } : {}),
    grants: convex ? new ConvexGrantLedger(convex) : new MemoryGrantLedger(),
    accountsEnabled: Boolean(convexVerifier)
  };
}
