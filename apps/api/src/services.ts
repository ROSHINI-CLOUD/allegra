import type { MusicBrainzConfig, TranslationConfig } from './config.js';
import { ArtworkService } from './services/artwork.js';
import { LyricsService } from './services/lyrics.js';
import { RecommendationService } from './services/recommendations.js';
import { TranslationService } from './services/translation.js';
import { CatalogService } from './catalog/catalog.js';
import { ConvexCoverStorage, ConvexGrantLedger, ConvexUserStore } from './db/convex.js';
import { MemoryGrantLedger, type GrantLedger } from './oauth/ledger.js';
import { AuthService } from './auth/auth.js';
import { ConvexTokenVerifier, FirstMatchVerifier, GuestTokenVerifier, type TokenVerifier } from './auth/verifier.js';
import { MemoryCacheStore, type CacheStore } from './lib/cache.js';
import type { CoverStorage } from './lib/covers.js';
import { StreamResolver } from './lib/streamResolver.js';
import { GaanaProvider } from './providers/gaana.js';
import { ItunesProvider } from './providers/itunes.js';
import { LrclibProvider } from './providers/lrclib.js';
import { BetterLyricsProvider } from './providers/betterlyrics.js';
import { LyricaProvider } from './providers/lyrica.js';
import { MusicBrainzReleaseAuthority, type ReleaseAuthority } from './providers/musicbrainz.js';
import { SaavnProvider } from './providers/saavn.js';
import { MemoryUserStore, type UserStore } from './user/store.js';

export interface ServiceOptions {
  readonly saavnApiUrl?: string;
  readonly saavnSecondaryApiUrl?: string;
  readonly gaanaApiUrl?: string;
  readonly lrclibApiUrl?: string;
  readonly lyricaApiUrl?: string;
  /** Better Lyrics API base URL. Unset disables that tier. */
  readonly betterLyricsApiUrl?: string;
  readonly musicBrainz?: MusicBrainzConfig;
  /** Injected in tests so the election runs without reaching MusicBrainz. */
  readonly releaseAuthority?: ReleaseAuthority;
  readonly version?: string;
  /** Optional key: without it only already-cached songs resolve. */
  readonly betterLyricsApiKey?: string;
  readonly cacheStore?: CacheStore;
  readonly userStore?: UserStore;
  /** With both set, user data lives in Convex; otherwise it stays in memory. */
  readonly convexUrl?: string;
  readonly convexServerSecret?: string;
  /** Convex site origin (…convex.site) — the issuer of Convex Auth session tokens. */
  readonly convexSiteUrl?: string;
  /** Verifier for signed-in accounts. Built from convexSiteUrl unless supplied (tests). */
  readonly accountVerifier?: TokenVerifier;
  readonly fetchImpl?: typeof fetch;
  readonly jwtSecret: string;
  readonly translation?: TranslationConfig;
}

export interface AppServices {
  readonly catalog: CatalogService;
  readonly stream: StreamResolver;
  readonly artwork: ArtworkService;
  readonly lyrics: LyricsService;
  readonly auth: AuthService;
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
  const convexStore = options.convexUrl && options.convexServerSecret
    ? new ConvexUserStore({ url: options.convexUrl, serverSecret: options.convexServerSecret })
    : undefined;
  const userStore = options.userStore ?? convexStore ?? new MemoryUserStore();

  // Guest tokens are ours; Convex Auth signs the ones that come back from Google.
  // Without a Convex site URL only guest sessions exist, which is how local dev runs.
  const guestVerifier = new GuestTokenVerifier(options.jwtSecret);
  const convexVerifier = options.accountVerifier
    ?? (options.convexSiteUrl ? new ConvexTokenVerifier({ siteUrl: options.convexSiteUrl }) : undefined);

  const stream = new StreamResolver({ saavn, cache, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });

  return {
    catalog,
    stream,
    artwork: new ArtworkService(new ItunesProvider({ ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }), catalog, cache),
    lyrics: new LyricsService(new LrclibProvider({
      ...(options.lrclibApiUrl ? { baseUrl: options.lrclibApiUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }), cache, options.lyricaApiUrl ? new LyricaProvider({ baseUrl: options.lyricaApiUrl, timeoutMs: 25_000, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }) : undefined,
      options.betterLyricsApiUrl ? new BetterLyricsProvider({ baseUrl: options.betterLyricsApiUrl, ...(options.betterLyricsApiKey ? { apiKey: options.betterLyricsApiKey } : {}), ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }) : undefined),
    auth: new AuthService({
      store: userStore,
      guest: guestVerifier,
      verifier: new FirstMatchVerifier(guestVerifier, convexVerifier),
      ...(convexStore ? { directory: convexStore } : {})
    }),
    translation: new TranslationService(cache, {
      ...(options.translation?.baseUrl ? { baseUrl: options.translation.baseUrl } : {}),
      ...(options.translation?.contactEmail ? { contactEmail: options.translation.contactEmail } : {}),
      ...(options.translation?.fallbackBaseUrl ? { fallbackBaseUrl: options.translation.fallbackBaseUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }),
    recommendations: new RecommendationService(catalog, cache),
    ...(options.convexUrl && options.convexServerSecret
      ? { covers: new ConvexCoverStorage({ url: options.convexUrl, serverSecret: options.convexServerSecret }) }
      : {}),
    grants: options.convexUrl && options.convexServerSecret
      ? new ConvexGrantLedger({ url: options.convexUrl, serverSecret: options.convexServerSecret })
      : new MemoryGrantLedger(),
    accountsEnabled: Boolean(convexVerifier)
  };
}
