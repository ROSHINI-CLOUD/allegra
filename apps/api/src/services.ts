import type { AiConfig, KaraokeAwsConfig, MusicBrainzConfig, UploadsConfig } from './config.js';
import { AiClient } from './ai/aiClient.js';
import { GeminiProvider } from './ai/providers/gemini.js';
import { OpenAiCompatibleProvider } from './ai/providers/openaiCompatible.js';
import { BedrockProvider } from './ai/providers/bedrock.js';
import { ArtworkService } from './services/artwork.js';
import { CacheKaraokeAssetStore } from './services/karaoke/asset-store.js';
import { KaraokeService } from './services/karaoke/karaoke.service.js';
import { AwsBatchStemSeparationProvider } from './services/karaoke/providers/aws-batch.provider.js';
import { DEFAULT_SEPARATION_VERSION } from './services/karaoke/types.js';
import { LyricsService } from './services/lyrics.js';
import { RecommendationService } from './services/recommendations.js';
import { TranslationService } from './services/translation.js';
import { CatalogService } from './catalog/catalog.js';
import { ConvexUserStore } from './db/convex.js';
import { AuthService } from './auth/auth.js';
import { ConvexTokenVerifier, FirstMatchVerifier, GuestTokenVerifier, type TokenVerifier } from './auth/verifier.js';
import { MemoryCacheStore, type CacheStore } from './lib/cache.js';
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
  readonly karaoke?: KaraokeAwsConfig;
  readonly uploads?: UploadsConfig;
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
  readonly ai?: AiConfig;
}

export interface AppServices {
  readonly catalog: CatalogService;
  readonly stream: StreamResolver;
  readonly artwork: ArtworkService;
  readonly lyrics: LyricsService;
  readonly auth: AuthService;
  readonly translation: TranslationService;
  readonly recommendations: RecommendationService;
  readonly karaoke: KaraokeService;
}

/**
 * Gemini -> OpenRouter -> NVIDIA -> Groq -> Bedrock. Only providers with a
 * configured key are included, and `AI_PRIMARY` (e.g. `bedrock`) moves one of
 * them to the front while the rest keep this relative order behind it.
 */
export function buildAiClient(ai: AiConfig | undefined, fetchImpl?: typeof fetch): AiClient {
  const providers = [];
  if (ai?.geminiApiKey) {
    providers.push(new GeminiProvider({ apiKey: ai.geminiApiKey, ...(ai.geminiModel ? { model: ai.geminiModel } : {}), ...(fetchImpl ? { fetchImpl } : {}) }));
  }
  if (ai?.openrouterApiKey) {
    providers.push(new OpenAiCompatibleProvider({
      name: 'openrouter',
      apiKey: ai.openrouterApiKey,
      model: ai.openrouterModel ?? 'meta-llama/llama-3.3-70b-instruct:free',
      baseUrl: 'https://openrouter.ai/api/v1',
      extraHeaders: { 'HTTP-Referer': 'https://allegra.app', 'X-Title': 'Allegra' },
      ...(fetchImpl ? { fetchImpl } : {})
    }));
  }
  if (ai?.nvidiaApiKey) {
    providers.push(new OpenAiCompatibleProvider({
      name: 'nvidia',
      apiKey: ai.nvidiaApiKey,
      model: ai.nvidiaModel ?? 'meta/llama-3.2-11b-vision-instruct',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      ...(fetchImpl ? { fetchImpl } : {})
    }));
  }
  if (ai?.groqApiKey) {
    providers.push(new OpenAiCompatibleProvider({
      name: 'groq',
      apiKey: ai.groqApiKey,
      model: ai.groqModel ?? 'openai/gpt-oss-20b',
      baseUrl: 'https://api.groq.com/openai/v1',
      ...(fetchImpl ? { fetchImpl } : {})
    }));
  }
  if (ai?.awsAccessKeyId && ai.awsSecretAccessKey) {
    providers.push(new BedrockProvider({
      accessKeyId: ai.awsAccessKeyId,
      secretAccessKey: ai.awsSecretAccessKey,
      ...(ai.awsSessionToken ? { sessionToken: ai.awsSessionToken } : {}),
      region: ai.awsRegion ?? 'us-east-1',
      ...(ai.bedrockModelId ? { modelId: ai.bedrockModelId } : {}),
      ...(fetchImpl ? { fetchImpl } : {})
    }));
  }
  // Array.prototype.sort is stable, so everything that is not the primary keeps
  // the cascade order above. A primary whose key is missing matches nothing and
  // leaves the list untouched rather than emptying it.
  if (ai?.primary) {
    const primary = ai.primary;
    providers.sort((left, right) => Number(right.name === primary) - Number(left.name === primary));
  }
  // With an explicit primary, try that provider plus one fallback — not the whole
  // paid cascade — so a slow Bedrock miss does not stack Gemini/NVIDIA/Groq bills.
  return new AiClient(providers, ai?.primary ? { maxAttempts: 2 } : {});
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

  const ai = buildAiClient(options.ai, options.fetchImpl);
  const stream = new StreamResolver({ saavn, cache, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
  const karaokeProvider = options.karaoke
    ? new AwsBatchStemSeparationProvider({
        region: options.karaoke.region,
        jobQueue: options.karaoke.jobQueue,
        jobDefinition: options.karaoke.jobDefinition,
        bucket: options.karaoke.bucket,
        separationVersion: options.karaoke.separationVersion,
        stemModel: options.karaoke.stemModel,
        ...(options.karaoke.accessKeyId ? { accessKeyId: options.karaoke.accessKeyId } : {}),
        ...(options.karaoke.secretAccessKey ? { secretAccessKey: options.karaoke.secretAccessKey } : {}),
        ...(options.karaoke.sessionToken ? { sessionToken: options.karaoke.sessionToken } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
      })
    : undefined;

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
    translation: new TranslationService(ai, cache),
    recommendations: new RecommendationService(ai, catalog, cache),
    karaoke: new KaraokeService({
      stream,
      store: new CacheKaraokeAssetStore(cache, options.karaoke?.separationVersion ?? DEFAULT_SEPARATION_VERSION),
      ...(karaokeProvider ? { provider: karaokeProvider } : {})
    })
  };
}
