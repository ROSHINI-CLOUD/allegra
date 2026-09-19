import { parseTrustedProviderUrl } from './lib/publicUrl.js';

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly version: string;
  readonly jwtSecret: string;
  readonly allowedOrigin?: string;
  readonly saavnApiUrl: string;
  readonly gaanaApiUrl: string;
  readonly lrclibApiUrl: string;
  readonly enableRequestLogging: boolean;
}

const DEFAULT_SAAVN = 'https://example.invalid/api';
const DEFAULT_GAANA = 'https://example.invalid/api';
const DEFAULT_LRCLIB = 'https://lrclib.net/api';

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

  const allowedOrigin = parseOrigin(env.ALLEGRA_ORIGIN, production);
  const saavnApiUrl = readProviderUrl(env.SAAVN_API_URL, production ? undefined : DEFAULT_SAAVN, production, 'SAAVN_API_URL');
  const gaanaApiUrl = readProviderUrl(env.GAANA_API_URL, DEFAULT_GAANA, production, 'GAANA_API_URL');
  const lrclibApiUrl = readProviderUrl(env.LRCLIB_API_URL, DEFAULT_LRCLIB, production, 'LRCLIB_API_URL');

  const config: AppConfig = {
    nodeEnv,
    port,
    version: env.APP_VERSION ?? '0.1.0',
    jwtSecret,
    saavnApiUrl,
    gaanaApiUrl,
    lrclibApiUrl,
    enableRequestLogging: nodeEnv === 'production'
  };

  return allowedOrigin ? { ...config, allowedOrigin } : config;
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
