import type { AiConfig } from './config.js';
import { AiClient } from './ai/aiClient.js';
import { GeminiProvider } from './ai/providers/gemini.js';
import { OpenAiCompatibleProvider } from './ai/providers/openaiCompatible.js';
import { BedrockProvider } from './ai/providers/bedrock.js';
import { ArtworkService } from './services/artwork.js';
import { LyricsService } from './services/lyrics.js';
import { RecommendationService } from './services/recommendations.js';
import { TranslationService } from './services/translation.js';
import { CatalogService } from './catalog/catalog.js';
import { ConvexUserStore } from './db/convex.js';
import { AuthService } from './auth/auth.js';
import { MemoryCacheStore, type CacheStore } from './lib/cache.js';
import { StreamResolver } from './lib/streamResolver.js';
import { GaanaProvider } from './providers/gaana.js';
import { ItunesProvider } from './providers/itunes.js';
import { LrclibProvider } from './providers/lrclib.js';
import { BetterLyricsProvider } from './providers/betterlyrics.js';
import { LyricaProvider } from './providers/lyrica.js';
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
  /** Optional key: without it only already-cached songs resolve. */
  readonly betterLyricsApiKey?: string;
  readonly cacheStore?: CacheStore;
  readonly userStore?: UserStore;
  /** With both set, user data lives in Convex; otherwise it stays in memory. */
  readonly convexUrl?: string;
  readonly convexServerSecret?: string;
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
  return new AiClient(providers);
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

  const ai = buildAiClient(options.ai, options.fetchImpl);

  return {
    catalog,
    stream: new StreamResolver({ saavn, cache, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }),
    artwork: new ArtworkService(new ItunesProvider({ ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }), catalog, cache),
    lyrics: new LyricsService(new LrclibProvider({
      ...(options.lrclibApiUrl ? { baseUrl: options.lrclibApiUrl } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
    }), cache, options.lyricaApiUrl ? new LyricaProvider({ baseUrl: options.lyricaApiUrl, timeoutMs: 25_000, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }) : undefined,
      options.betterLyricsApiUrl ? new BetterLyricsProvider({ baseUrl: options.betterLyricsApiUrl, ...(options.betterLyricsApiKey ? { apiKey: options.betterLyricsApiKey } : {}), ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) }) : undefined),
    auth: new AuthService(userStore, options.jwtSecret),
    translation: new TranslationService(ai, cache),
    recommendations: new RecommendationService(ai, catalog)
  };
}
