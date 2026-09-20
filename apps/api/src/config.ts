import { parseTrustedProviderUrl } from './lib/publicUrl.js';

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly version: string;
  readonly jwtSecret: string;
  readonly allowedOrigin?: string;
  /** Extra origins accepted in development only. Always empty in production. */
  readonly additionalOrigins?: readonly string[];
  readonly saavnApiUrl: string;
  readonly saavnSecondaryApiUrl?: string;
  readonly gaanaApiUrl: string;
  readonly lrclibApiUrl: string;
  readonly lyricaApiUrl?: string;
  readonly betterLyricsApiUrl?: string;
  readonly betterLyricsApiKey?: string;
  /** Convex deployment URL. Unset means user data stays in memory. */
  readonly convexUrl?: string;
  readonly convexServerSecret?: string;
  readonly enableRequestLogging: boolean;
  readonly ai: AiConfig;
}

/** Every field optional and independently configured — the AI cascade just skips whatever isn't set. */
export interface AiConfig {
  readonly geminiApiKey?: string;
  readonly geminiModel?: string;
  readonly openrouterApiKey?: string;
  readonly openrouterModel?: string;
  readonly nvidiaApiKey?: string;
  readonly nvidiaModel?: string;
  readonly groqApiKey?: string;
  readonly groqModel?: string;
  readonly awsAccessKeyId?: string;
  readonly awsSecretAccessKey?: string;
  readonly awsRegion?: string;
  readonly bedrockModelId?: string;
  /**
   * Name of the provider to try first, e.g. `bedrock`. The rest keep their
   * relative order behind it. A name with no configured key is simply ignored,
   * so setting this can never empty the cascade.
   */
  readonly primary?: string;
}

// These public community deployments are development fallbacks only. Production
// still requires an explicitly configured Saavn endpoint so a deployment never
// silently depends on an unmanaged third-party instance.
const DEFAULT_SAAVN = 'https://jiosaavn-api-byprats.vercel.app/api';
const DEFAULT_GAANA = 'https://gaanaapibyprats.vercel.app/api';
const DEFAULT_LRCLIB = 'https://lrclib.net/api';
const DEFAULT_LYRICA = 'https://test-0k.onrender.com/lyrics';
const DEFAULT_BETTER_LYRICS = 'https://lyrics-api.boidu.dev';

export function loadConfig(env: NodeJS.Dict<string>): AppConfig {
  const nodeEnv = parseNodeEnv(env.NODE_ENV);
  const production = nodeEnv === 'production';
  const port = Number.parseInt(env.PORT ?? '8080', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const jwtSecret = env.JWT_SECRET ?? (production ? '' : 'local-development-only');
  if (production && jwtSecret.trim().length < 16) {
    throw new Error('JWT_SECRET is required in production.');
  }

  const allowedOrigin = parseOrigin(
    env.ALLEGRA_ORIGIN ?? (production ? undefined : 'http://127.0.0.1:5173'),
    production
  );
  /*
   * Vite prints http://localhost:5173 but the default allowlist is the 127.0.0.1
   * form, so opening the printed link blocked every call and the app came up
   * empty. In development both spellings of loopback are accepted. Production is
   * untouched and still allows exactly one configured origin.
   */
  const additionalOrigins = production || !allowedOrigin ? [] : loopbackSiblings(allowedOrigin);
  const saavnApiUrl = readProviderUrl(env.SAAVN_API_URL, production ? undefined : DEFAULT_SAAVN, production, 'SAAVN_API_URL');
  const saavnSecondaryApiUrl = readOptionalProviderUrl(env.SAAVN_SECONDARY_API_URL, production, 'SAAVN_SECONDARY_API_URL');
  const gaanaApiUrl = readProviderUrl(env.GAANA_API_URL, DEFAULT_GAANA, production, 'GAANA_API_URL');
  const lrclibApiUrl = readProviderUrl(env.LRCLIB_API_URL, DEFAULT_LRCLIB, production, 'LRCLIB_API_URL');
  // Lyrics fallbacks are on by default (they only run when LRCLIB has nothing) and set to `off` to disable.
  const lyricaApiUrl = isOff(env.LYRICA_API_URL) ? undefined : readOptionalProviderUrl(env.LYRICA_API_URL, production, 'LYRICA_API_URL') ?? DEFAULT_LYRICA;
  const betterLyricsApiUrl = isOff(env.BETTERLYRICS_API_URL) ? undefined : readOptionalProviderUrl(env.BETTERLYRICS_API_URL, production, 'BETTERLYRICS_API_URL') ?? DEFAULT_BETTER_LYRICS;
  const betterLyricsApiKey = env.BETTERLYRICS_API_KEY?.trim() || undefined;

  const ai: AiConfig = {
    ...(env.GEMINI_API_KEY?.trim() ? { geminiApiKey: env.GEMINI_API_KEY.trim() } : {}),
    ...(env.GEMINI_MODEL?.trim() ? { geminiModel: env.GEMINI_MODEL.trim() } : {}),
    ...(env.OPENROUTER_API_KEY?.trim() ? { openrouterApiKey: env.OPENROUTER_API_KEY.trim() } : {}),
    ...(env.OPENROUTER_MODEL?.trim() ? { openrouterModel: env.OPENROUTER_MODEL.trim() } : {}),
    ...(env.NVIDIA_API_KEY?.trim() ? { nvidiaApiKey: env.NVIDIA_API_KEY.trim() } : {}),
    ...(env.NVIDIA_MODEL?.trim() ? { nvidiaModel: env.NVIDIA_MODEL.trim() } : {}),
    ...(env.GROQ_API_KEY?.trim() ? { groqApiKey: env.GROQ_API_KEY.trim() } : {}),
    ...(env.GROQ_MODEL?.trim() ? { groqModel: env.GROQ_MODEL.trim() } : {}),
    ...(env.AWS_ACCESS_KEY_ID?.trim() ? { awsAccessKeyId: env.AWS_ACCESS_KEY_ID.trim() } : {}),
    ...(env.AWS_SECRET_ACCESS_KEY?.trim() ? { awsSecretAccessKey: env.AWS_SECRET_ACCESS_KEY.trim() } : {}),
    ...(env.AWS_REGION?.trim() ? { awsRegion: env.AWS_REGION.trim() } : {}),
    ...(env.BEDROCK_MODEL_ID?.trim() ? { bedrockModelId: env.BEDROCK_MODEL_ID.trim() } : {}),
    ...(env.AI_PRIMARY?.trim() ? { primary: env.AI_PRIMARY.trim().toLowerCase() } : {})
  };

  const convexUrl = env.CONVEX_URL?.trim() || undefined;
  const convexServerSecret = env.CONVEX_SERVER_SECRET?.trim() || undefined;
  if (convexUrl) {
    try {
      const parsed = new URL(convexUrl);
      if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && !production)) throw new Error('scheme');
    } catch {
      throw new Error('CONVEX_URL must be an https URL.');
    }
    if (!convexServerSecret || convexServerSecret.length < 16) {
      throw new Error('CONVEX_SERVER_SECRET (16+ characters) is required when CONVEX_URL is set.');
    }
  }

  const config: AppConfig = {
    nodeEnv,
    port,
    version: env.APP_VERSION ?? '0.1.0',
    jwtSecret,
    saavnApiUrl,
    ...(saavnSecondaryApiUrl ? { saavnSecondaryApiUrl } : {}),
    gaanaApiUrl,
    lrclibApiUrl,
    ...(lyricaApiUrl ? { lyricaApiUrl } : {}),
    ...(betterLyricsApiUrl ? { betterLyricsApiUrl } : {}),
    ...(betterLyricsApiKey ? { betterLyricsApiKey } : {}),
    ...(convexUrl && convexServerSecret ? { convexUrl, convexServerSecret } : {}),
    enableRequestLogging: nodeEnv === 'production',
    ai
  };

  const withOrigin = allowedOrigin ? { ...config, allowedOrigin } : config;
  return additionalOrigins.length > 0 ? { ...withOrigin, additionalOrigins } : withOrigin;
}

function isOff(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'off';
}

function readOptionalProviderUrl(value: string | undefined, production: boolean, name: string): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  try {
    return parseTrustedProviderUrl(value, production);
  } catch {
    throw new Error(`${name} must be a trusted http(s) URL.`);
  }
}

function readProviderUrl(
  value: string | undefined,
  fallback: string | undefined,
  production: boolean,
  name: string
): string {
  const raw = value?.trim() || fallback;
  if (!raw) {
    throw new Error(`${name} is required.`);
  }
  try {
    return parseTrustedProviderUrl(raw, production);
  } catch {
    throw new Error(`${name} must be a trusted http(s) URL.`);
  }
}

function parseNodeEnv(value: string | undefined): AppConfig['nodeEnv'] {
  if (value === 'production' || value === 'test' || value === 'development') {
    return value;
  }
  return 'development';
}

function parseOrigin(value: string | undefined, required: boolean): string | undefined {
  if (!value?.trim()) {
    if (required) {
      throw new Error('ALLEGRA_ORIGIN is required in production.');
    }
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ALLEGRA_ORIGIN must be a valid origin.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ALLEGRA_ORIGIN must be an http(s) origin.');
  }
  if (url.username || url.password) {
    throw new Error('ALLEGRA_ORIGIN must not include credentials.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ALLEGRA_ORIGIN must be an origin without a path, query, or fragment.');
  }
  return url.origin;
}

/** The other spelling of loopback for the same port, so local dev works on either. */
function loopbackSiblings(origin: string): readonly string[] {
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost') return [`${url.protocol}//127.0.0.1:${url.port}`];
    if (url.hostname === '127.0.0.1') return [`${url.protocol}//localhost:${url.port}`];
    return [];
  } catch {
    return [];
  }
}
