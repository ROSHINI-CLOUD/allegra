import { parseTrustedProviderUrl } from './lib/publicUrl.js';
import { DEFAULT_SEPARATION_VERSION } from './services/karaoke/types.js';

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
  /** AWS Batch karaoke. Unset disables karaoke routes (503). */
  readonly karaoke?: KaraokeAwsConfig;
  /** Convex deployment URL. Unset means user data stays in memory. */
  readonly convexUrl?: string;
  readonly convexServerSecret?: string;
  /** Convex site origin, which issues Convex Auth session tokens. Unset disables Google sign-in. */
  readonly convexSiteUrl?: string;
  readonly enableRequestLogging: boolean;
  readonly ai: AiConfig;
  /** Playlist-cover uploads. Unset disables POST /api/uploads/sign. */
  readonly uploads?: UploadsConfig;
  /** DynamoDB TTL cache. Unset keeps an in-process memory cache only. */
  readonly cache?: CacheConfig;
  /**
   * MusicBrainz + Cover Art Archive, which name the record a song was released on.
   * Unset (`MUSICBRAINZ_API_URL=off`) leaves the provider's album and cover alone.
   */
  readonly musicBrainz?: MusicBrainzConfig;
}

/** Both hosts are free and keyless; the contact goes in the User-Agent they require. */
export interface MusicBrainzConfig {
  readonly baseUrl: string;
  readonly coverArtUrl: string;
  readonly contact: string;
}

/** AWS Batch + S3 stem separation. Creds optional when the host has an IAM role. */
export interface KaraokeAwsConfig {
  readonly region: string;
  readonly jobQueue: string;
  readonly jobDefinition: string;
  readonly bucket: string;
  readonly separationVersion: string;
  readonly stemModel: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
}

/** Hand-rolled DynamoDB cache (no AWS SDK). Instance-role creds work via container URI. */
export interface CacheConfig {
  readonly tableName: string;
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly sessionToken?: string;
}

/** Credentials + bucket for hand-rolled S3 PUT presigning (no AWS SDK). */
export interface UploadsConfig {
  readonly bucket: string;
  readonly region: string;
  /** CloudFront or public S3 website/base URL used to build coverUrl for the browser. */
  readonly publicBaseUrl: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly expiresInSeconds: number;
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
  /** Temporary session from `aws login` / STS — required when the access key starts with ASIA. */
  readonly awsSessionToken?: string;
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
const DEFAULT_MUSICBRAINZ = 'https://musicbrainz.org/ws/2';
const DEFAULT_COVERART = 'https://coverartarchive.org';
// MusicBrainz throttles anonymous agents harder, so it wants a way to reach whoever is calling.
const DEFAULT_MUSICBRAINZ_CONTACT = 'https://github.com/peterish8/allegra';

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
  // On by default: it only runs for a row whose album is somebody's playlist.
  const musicBrainz: MusicBrainzConfig | undefined = isOff(env.MUSICBRAINZ_API_URL)
    ? undefined
    : {
        baseUrl: readOptionalProviderUrl(env.MUSICBRAINZ_API_URL, production, 'MUSICBRAINZ_API_URL') ?? DEFAULT_MUSICBRAINZ,
        coverArtUrl: readOptionalProviderUrl(env.COVERART_API_URL, production, 'COVERART_API_URL') ?? DEFAULT_COVERART,
        contact: env.MUSICBRAINZ_CONTACT?.trim() || DEFAULT_MUSICBRAINZ_CONTACT
      };
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
    ...(env.AWS_SESSION_TOKEN?.trim() ? { awsSessionToken: env.AWS_SESSION_TOKEN.trim() } : {}),
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

  // Convex serves functions from .convex.cloud and HTTP (including auth) from
  // .convex.site. Deriving it keeps one URL to configure instead of two that must agree.
  const convexSiteUrl = env.CONVEX_SITE_URL?.trim() || convexUrl?.replace(/\.convex\.cloud$/, '.convex.site');

  const uploads = loadUploadsConfig(env, ai);
  const cache = loadCacheConfig(env, ai);
  const karaoke = loadKaraokeConfig(env, ai);

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
    ...(karaoke ? { karaoke } : {}),
    ...(convexUrl && convexServerSecret ? { convexUrl, convexServerSecret } : {}),
    ...(convexSiteUrl ? { convexSiteUrl } : {}),
    enableRequestLogging: nodeEnv === 'production',
    ai,
    ...(uploads ? { uploads } : {}),
    ...(cache ? { cache } : {}),
    ...(musicBrainz ? { musicBrainz } : {})
  };

  const withOrigin = allowedOrigin ? { ...config, allowedOrigin } : config;
  return additionalOrigins.length > 0 ? { ...withOrigin, additionalOrigins } : withOrigin;
}

function isOff(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'off';
}

/**
 * Cover uploads need a bucket, a public base URL, and the same AWS keys Bedrock
 * already uses. Any missing piece leaves uploads disabled (503) rather than
 * half-configured.
 */
/**
 * Optional DynamoDB cache table. When set, the API layers memory + Dynamo so
 * lyrics/search/AI hits survive restarts. Credentials may be static env keys or
 * the container role (`AWS_CONTAINER_CREDENTIALS_*`).
 */
function loadCacheConfig(env: NodeJS.Dict<string>, ai: AiConfig): CacheConfig | undefined {
  const tableName = env.DDB_TABLE_CACHE?.trim();
  if (!tableName) return undefined;
  const region = (env.AWS_REGION?.trim() || ai.awsRegion || '').trim();
  if (!region) {
    throw new Error('DDB_TABLE_CACHE requires AWS_REGION (or ai.awsRegion).');
  }
  return {
    tableName,
    region,
    ...(ai.awsAccessKeyId ? { accessKeyId: ai.awsAccessKeyId } : {}),
    ...(ai.awsSecretAccessKey ? { secretAccessKey: ai.awsSecretAccessKey } : {}),
    ...(ai.awsSessionToken ? { sessionToken: ai.awsSessionToken } : {})
  };
}

/**
 * Karaoke needs Batch queue + job definition + stem bucket. Missing any piece
 * leaves karaoke disabled (503) rather than half-configured.
 */
function loadKaraokeConfig(env: NodeJS.Dict<string>, ai: AiConfig): KaraokeAwsConfig | undefined {
  const jobQueue = env.AWS_BATCH_JOB_QUEUE?.trim();
  const jobDefinition = env.AWS_BATCH_JOB_DEFINITION?.trim();
  const bucket = env.KARAOKE_S3_BUCKET?.trim();
  if (!jobQueue && !jobDefinition && !bucket) return undefined;
  if (!jobQueue || !jobDefinition || !bucket) {
    throw new Error(
      'Karaoke needs AWS_BATCH_JOB_QUEUE, AWS_BATCH_JOB_DEFINITION, and KARAOKE_S3_BUCKET together (or leave all blank to disable).'
    );
  }
  const region = (env.AWS_REGION?.trim() || ai.awsRegion || '').trim();
  if (!region) {
    throw new Error('Karaoke needs AWS_REGION.');
  }
  // Dedicated keys: the shared AWS_* pair on Vercel is a short-lived Bedrock session token.
  const accessKeyId = env.KARAOKE_AWS_ACCESS_KEY_ID?.trim() || ai.awsAccessKeyId;
  const secretAccessKey = env.KARAOKE_AWS_SECRET_ACCESS_KEY?.trim() || ai.awsSecretAccessKey;
  const sessionToken = env.KARAOKE_AWS_ACCESS_KEY_ID?.trim() ? env.KARAOKE_AWS_SESSION_TOKEN?.trim() : ai.awsSessionToken;
  return {
    region,
    jobQueue,
    jobDefinition,
    bucket,
    separationVersion: env.STEM_SEPARATION_VERSION?.trim() || DEFAULT_SEPARATION_VERSION,
    stemModel: env.STEM_MODEL?.trim() || 'htdemucs',
    ...(accessKeyId ? { accessKeyId } : {}),
    ...(secretAccessKey ? { secretAccessKey } : {}),
    ...(sessionToken ? { sessionToken } : {})
  };
}

function loadUploadsConfig(env: NodeJS.Dict<string>, ai: AiConfig): UploadsConfig | undefined {
  const bucket = env.S3_COVERS_BUCKET?.trim();
  const publicBaseUrl = env.S3_COVERS_PUBLIC_BASE_URL?.trim();
  const region = (env.S3_COVERS_REGION?.trim() || env.AWS_REGION?.trim() || ai.awsRegion || '').trim();
  const accessKeyId = ai.awsAccessKeyId?.trim();
  const secretAccessKey = ai.awsSecretAccessKey?.trim();
  const sessionToken = ai.awsSessionToken?.trim();
  if (!bucket && !publicBaseUrl) return undefined;
  if (!bucket || !publicBaseUrl || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3 cover uploads need S3_COVERS_BUCKET, S3_COVERS_PUBLIC_BASE_URL, AWS_REGION (or S3_COVERS_REGION), and AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.'
    );
  }
  try {
    const parsed = new URL(publicBaseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('scheme');
  } catch {
    throw new Error('S3_COVERS_PUBLIC_BASE_URL must be an http(s) URL.');
  }
  const expiresRaw = env.S3_COVERS_UPLOAD_EXPIRES_SECONDS?.trim();
  const expiresInSeconds = expiresRaw ? Number.parseInt(expiresRaw, 10) : 120;
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 30 || expiresInSeconds > 900) {
    throw new Error('S3_COVERS_UPLOAD_EXPIRES_SECONDS must be an integer between 30 and 900.');
  }
  return {
    bucket,
    region,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
    expiresInSeconds
  };
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
