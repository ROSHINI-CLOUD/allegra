import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import type { MusicBrainzConfig, TranslationConfig } from './config.js';
import { createServices, type AppServices } from './services.js';
import type { TokenVerifier } from './auth/verifier.js';
import type { CacheStore } from './lib/cache.js';
import { createLogger, REDACTED_PATHS } from './lib/logger.js';
import { artworkRouter } from './routes/artwork.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { discoveryRouter } from './routes/discovery.js';
import { sendFailure } from './routes/common.js';
import { lyricsRouter } from './routes/lyrics.js';
import { mcpRouter } from './mcp/server.js';
import { OAuthClients } from './oauth/clients.js';
import { oauthRouter } from './oauth/router.js';
import { OAuthSigner } from './oauth/tokens.js';
import { MemoryCacheStore } from './lib/cache.js';
import { sharedRouter } from './routes/shared.js';
import { streamRouter } from './routes/stream.js';
import { uploadsRouter } from './routes/uploads.js';
import { userRouter } from './routes/user.js';

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly limit: number;
}

export interface AppOptions {
  readonly version: string;
  readonly allowedOrigin?: string;
  readonly additionalOrigins?: readonly string[];
  readonly jwtSecret?: string;
  readonly services?: AppServices;
  readonly saavnApiUrl?: string;
  readonly saavnSecondaryApiUrl?: string;
  readonly gaanaApiUrl?: string;
  readonly lrclibApiUrl?: string;
  readonly musicBrainz?: MusicBrainzConfig;
  readonly lyricaApiUrl?: string;
  readonly betterLyricsApiUrl?: string;
  readonly betterLyricsApiKey?: string;
  readonly convexUrl?: string;
  readonly convexServerSecret?: string;
  /** Convex Auth issuer; used to verify Google session tokens at the API boundary. */
  readonly convexSiteUrl?: string;
  /** Injectable account-token verifier for tests and alternate identity providers. */
  readonly accountVerifier?: TokenVerifier;
  readonly translation?: TranslationConfig;
  readonly cacheStore?: CacheStore;
  readonly fetchImpl?: typeof fetch;
  readonly rateLimit?: false | {
    readonly api?: RateLimitConfig;
    readonly stream?: RateLimitConfig;
    readonly auth?: RateLimitConfig;
    readonly discovery?: RateLimitConfig;
    readonly mcp?: RateLimitConfig;
    readonly oauth?: RateLimitConfig;
  };
  readonly enableRequestLogging?: boolean;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  // MCP clients (some run in a browser) call discovery, registration, token and the MCP endpoint
  // from their own origin. Those carry no cookies and are bearer- or PKCE-protected, so any origin
  // may call them; everything else stays locked to the app's origin.
  const openCors = cors({ origin: '*', credentials: false, exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'] });
  const appCors = cors({
    /*
     * A string origin makes cors echo the header unconditionally; an array makes
     * it echo only on a match. Keep the string form whenever there is exactly one
     * origin so production behaviour is byte-identical, and only widen to an
     * array when development actually added a sibling host.
     */
    origin: resolveCorsOrigin(options),
    credentials: false
  });
  app.use((request, response, next) => {
    const path = request.path;
    const open = path.startsWith('/.well-known/') || path === '/api/mcp' || path === '/api/oauth/token' || path === '/api/oauth/register';
    (open ? openCors : appCors)(request, response, next);
  });

  if (options.enableRequestLogging) {
    app.use(
      pinoHttp({
        logger: createLogger(true),
        redact: [...REDACTED_PATHS]
      })
    );
  }

  const services = options.services ?? createServices({
    jwtSecret: options.jwtSecret ?? process.env.JWT_SECRET ?? 'local-development-only',
    ...(options.saavnApiUrl ? { saavnApiUrl: options.saavnApiUrl } : {}),
    ...(options.saavnSecondaryApiUrl ? { saavnSecondaryApiUrl: options.saavnSecondaryApiUrl } : {}),
    ...(options.gaanaApiUrl ? { gaanaApiUrl: options.gaanaApiUrl } : {}),
    ...(options.lrclibApiUrl ? { lrclibApiUrl: options.lrclibApiUrl } : {}),
    ...(options.musicBrainz ? { musicBrainz: options.musicBrainz } : {}),
    ...(options.version ? { version: options.version } : {}),
    ...(options.lyricaApiUrl ? { lyricaApiUrl: options.lyricaApiUrl } : {}),
    ...(options.betterLyricsApiUrl ? { betterLyricsApiUrl: options.betterLyricsApiUrl } : {}),
    ...(options.betterLyricsApiKey ? { betterLyricsApiKey: options.betterLyricsApiKey } : {}),
    ...(options.convexUrl ? { convexUrl: options.convexUrl } : {}),
    ...(options.convexServerSecret ? { convexServerSecret: options.convexServerSecret } : {}),
    ...(options.convexSiteUrl ? { convexSiteUrl: options.convexSiteUrl } : {}),
    ...(options.accountVerifier ? { accountVerifier: options.accountVerifier } : {}),
    ...(options.translation ? { translation: options.translation } : {}),
    ...(options.cacheStore ? { cacheStore: options.cacheStore } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });

  app.use(express.json({ limit: '32kb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, version: options.version });
  });

  if (options.rateLimit !== false) {
    app.use(createRateLimiter(options.rateLimit));
  }

  app.use('/api', catalogRouter(services.catalog));
  app.use('/api', artworkRouter(services.artwork));
  app.use('/api', lyricsRouter(services.lyrics));
  app.use('/api', streamRouter(services.stream));
  app.use('/api', authRouter(services.auth));
  app.use('/api', userRouter(services.auth, services.catalog, services.covers));
  app.use('/api', sharedRouter(services.auth, services.catalog));
  app.use('/api', uploadsRouter(services.auth, services.covers));
  app.use('/api', discoveryRouter(services.translation, services.recommendations, services.auth, services.catalog));
  const signer = new OAuthSigner(options.jwtSecret ?? process.env.JWT_SECRET ?? 'local-development-only');
  app.use(oauthRouter({
    auth: services.auth,
    signer,
    clients: new OAuthClients(signer, options.cacheStore ?? new MemoryCacheStore(), options.fetchImpl ?? fetch),
    ledger: services.grants,
    requireAccount: services.accountsEnabled
  }));
  app.use('/api', mcpRouter(services, signer));

  app.use((_request, response) => {
    response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
  });
  app.use(errorHandler);

  return app;
}

function createRateLimiter(config: AppOptions['rateLimit']): (request: Request, response: Response, next: NextFunction) => void {
  const limits = config === false || config === undefined ? {} : config;
  const api = limiter(limits.api ?? { windowMs: 60_000, limit: 300 });
  const stream = limiter(limits.stream ?? { windowMs: 60_000, limit: 300 });
  const auth = limiter(limits.auth ?? { windowMs: 60_000, limit: 30 });
  // Translation spends a shared daily provider quota and recommendations fan out to the catalog.
  const discovery = limiter(limits.discovery ?? { windowMs: 60_000, limit: 20 });
  // A connected assistant can call tools in quick bursts, but not unboundedly.
  const mcp = limiter(limits.mcp ?? { windowMs: 60_000, limit: 120 });
  // Sign-in, code exchange and client registration: a handful per connect.
  const oauth = limiter(limits.oauth ?? { windowMs: 60_000, limit: 30 });

  return (request, response, next) => {
    const path = request.path;
    if (path === '/api/health' || path.startsWith('/.well-known/')) {
      next();
      return;
    }
    if (path.startsWith('/api/stream')) {
      stream(request, response, next);
      return;
    }
    if (path.startsWith('/api/auth')) {
      auth(request, response, next);
      return;
    }
    if (path.startsWith('/api/oauth')) {
      oauth(request, response, next);
      return;
    }
    if (path === '/api/mcp') {
      mcp(request, response, next);
      return;
    }
    if (path.startsWith('/api/ai') || path === '/api/lyrics/translate' || path === '/api/recommendations') {
      discovery(request, response, next);
      return;
    }
    api(request, response, next);
  };
}

function limiter(config: RateLimitConfig) {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        success: false,
        data: null,
        error: 'Too many requests — give it a moment.'
      });
    }
  });
}

const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  if (type === 'entity.too.large' || type === 'entity.parse.failed') {
    response.status(400).json({ success: false, data: null, error: "Something's missing from that request." });
    return;
  }
  sendFailure(response, error);
};

function resolveCorsOrigin(options: AppOptions): string | string[] | false {
  if (!options.allowedOrigin) return false;
  const extra = options.additionalOrigins ?? [];
  return extra.length > 0 ? [options.allowedOrigin, ...extra] : options.allowedOrigin;
}
