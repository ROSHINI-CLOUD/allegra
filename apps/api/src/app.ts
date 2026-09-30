import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { createServices, type AppServices, type ServiceOptions } from './services.js';
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
import { songChangeLimiter, type SongChangeLimitConfig } from './lib/songChangeLimiter.js';
import { sharedRouter } from './routes/shared.js';
import { streamRouter } from './routes/stream.js';
import { uploadsRouter } from './routes/uploads.js';
import { userRouter } from './routes/user.js';

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly limit: number;
}

/**
 * Everything createServices takes passes straight through (provider settings, test fakes), so a
 * new provider setting is added in config.ts and services.ts only. `services` skips building them.
 */
export interface AppOptions extends Omit<ServiceOptions, 'jwtSecret'> {
  readonly version: string;
  readonly allowedOrigin?: string;
  readonly additionalOrigins?: readonly string[];
  readonly jwtSecret?: string;
  readonly services?: AppServices;
  readonly rateLimit?: false | {
    readonly api?: RateLimitConfig;
    readonly stream?: RateLimitConfig;
    readonly auth?: RateLimitConfig;
    readonly discovery?: RateLimitConfig;
    readonly mcp?: RateLimitConfig;
    readonly oauth?: RateLimitConfig;
    readonly lookup?: RateLimitConfig;
    readonly writes?: RateLimitConfig;
    readonly plays?: RateLimitConfig;
    readonly guests?: RateLimitConfig;
    readonly uploads?: RateLimitConfig;
    readonly songChanges?: SongChangeLimitConfig;
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

  const jwtSecret = options.jwtSecret ?? process.env.JWT_SECRET ?? 'local-development-only';
  const services = options.services ?? createServices({ ...options, jwtSecret });

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
  const signer = new OAuthSigner(jwtSecret);
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

/**
 * Every bucket is per client IP per minute: generous for a person, tight for a script. They sit
 * in memory on each function instance (no database call per request, which is the point), so they
 * are a first line, not a global quota — a platform firewall rule is the global backstop.
 */
function createRateLimiter(config: AppOptions['rateLimit']): (request: Request, response: Response, next: NextFunction) => void {
  const limits = config === false || config === undefined ? {} : config;
  const api = limiter(limits.api ?? { windowMs: 60_000, limit: 240 });
  // Range requests: one song is many of these (every seek), so this stays loose and the
  // song-change cap below does the real work.
  const stream = limiter(limits.stream ?? { windowMs: 60_000, limit: 300 });
  // 30 different songs a minute is skipping through a playlist at two seconds a track.
  const songChanges = songChangeLimiter(limits.songChanges ?? { windowMs: 60_000, limit: 30 }, sendTooMany);
  const auth = limiter(limits.auth ?? { windowMs: 60_000, limit: 30 });
  // A new guest is a new profile row in the database. A person needs one.
  const guests = limiter(limits.guests ?? { windowMs: 60_000, limit: 10 });
  // Translation spends a shared daily provider quota and recommendations fan out to the catalog.
  const discovery = limiter(limits.discovery ?? { windowMs: 60_000, limit: 20 });
  // Search, lyrics and artist lookups each fan out to several providers.
  const lookup = limiter(limits.lookup ?? { windowMs: 60_000, limit: 90 });
  // Each recorded play is a profile read and write. Matches the song-change cap.
  const plays = limiter(limits.plays ?? { windowMs: 60_000, limit: 30 });
  // Likes, playlists, settings, taste signals: each is a database write.
  const writes = limiter(limits.writes ?? { windowMs: 60_000, limit: 60 });
  // Cover uploads land in file storage.
  const uploads = limiter(limits.uploads ?? { windowMs: 60_000, limit: 10 });
  // A connected assistant can call tools in quick bursts, but not unboundedly.
  const mcp = limiter(limits.mcp ?? { windowMs: 60_000, limit: 120 });
  // Sign-in, code exchange and client registration: a handful per connect.
  const oauth = limiter(limits.oauth ?? { windowMs: 60_000, limit: 30 });

  return (request, response, next) => {
    const path = request.path;
    const isRead = request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS';
    if (path === '/api/health' || path.startsWith('/.well-known/')) {
      next();
      return;
    }
    if (path.startsWith('/api/stream')) {
      stream(request, response, () => songChanges(request, response, next));
      return;
    }
    if (path === '/api/auth/guest' || path === '/api/auth/anon') {
      auth(request, response, () => guests(request, response, next));
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
    if (path === '/api/me/recently-played' && !isRead) {
      plays(request, response, next);
      return;
    }
    if (path.startsWith('/api/uploads')) {
      uploads(request, response, next);
      return;
    }
    if (!isRead && (path.startsWith('/api/me') || path.startsWith('/api/libraries') || path.startsWith('/api/shared'))) {
      writes(request, response, next);
      return;
    }
    if (path === '/api/search' || path.startsWith('/api/lyrics') || path.startsWith('/api/artists')) {
      lookup(request, response, next);
      return;
    }
    api(request, response, next);
  };
}

function sendTooMany(response: Response): void {
  response.status(429).json({
    success: false,
    data: null,
    error: 'Too many requests — give it a moment.'
  });
}

function limiter(config: RateLimitConfig) {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) => sendTooMany(response)
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
