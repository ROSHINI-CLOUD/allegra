import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import type { AiConfig, UploadsConfig } from './config.js';
import { createServices, type AppServices } from './services.js';
import type { CacheStore } from './lib/cache.js';
import { createLogger, REDACTED_PATHS } from './lib/logger.js';
import { aiRouter } from './routes/ai.js';
import { artworkRouter } from './routes/artwork.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { sendFailure } from './routes/common.js';
import { lyricsRouter } from './routes/lyrics.js';
import { mcpRouter } from './mcp/server.js';
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
  readonly lyricaApiUrl?: string;
  readonly betterLyricsApiUrl?: string;
  readonly betterLyricsApiKey?: string;
  readonly convexUrl?: string;
  readonly convexServerSecret?: string;
  readonly ai?: AiConfig;
  readonly uploads?: UploadsConfig;
  readonly cacheStore?: CacheStore;
  readonly fetchImpl?: typeof fetch;
  readonly rateLimit?: false | {
    readonly api?: RateLimitConfig;
    readonly stream?: RateLimitConfig;
    readonly auth?: RateLimitConfig;
    readonly ai?: RateLimitConfig;
  };
  readonly enableRequestLogging?: boolean;
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      /*
       * A string origin makes cors echo the header unconditionally; an array makes
       * it echo only on a match. Keep the string form whenever there is exactly one
       * origin so production behaviour is byte-identical, and only widen to an
       * array when development actually added a sibling host.
       */
      origin: resolveCorsOrigin(options),
      credentials: false
    })
  );

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
    ...(options.lyricaApiUrl ? { lyricaApiUrl: options.lyricaApiUrl } : {}),
    ...(options.betterLyricsApiUrl ? { betterLyricsApiUrl: options.betterLyricsApiUrl } : {}),
    ...(options.betterLyricsApiKey ? { betterLyricsApiKey: options.betterLyricsApiKey } : {}),
    ...(options.convexUrl ? { convexUrl: options.convexUrl } : {}),
    ...(options.convexServerSecret ? { convexServerSecret: options.convexServerSecret } : {}),
    ...(options.ai ? { ai: options.ai } : {}),
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
  app.use('/api', userRouter(services.auth, services.catalog, options.uploads?.publicBaseUrl));
  app.use('/api', sharedRouter(services.auth, services.catalog, options.uploads?.publicBaseUrl));
  app.use('/api', uploadsRouter(services.auth, options.uploads));
  app.use('/api', aiRouter(services.translation, services.recommendations, services.auth, services.catalog));
  app.use(mcpRouter(services));

  app.use((_request, response) => {
    response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
  });
  app.use(errorHandler);

  return app;
}

function createRateLimiter(config: AppOptions['rateLimit']): (request: Request, response: Response, next: NextFunction) => void {
  const limits = config === false || config === undefined ? {} : config;
  const api = limiter(limits.api ?? { windowMs: 60_000, limit: 120 });
  const stream = limiter(limits.stream ?? { windowMs: 60_000, limit: 300 });
  const auth = limiter(limits.auth ?? { windowMs: 60_000, limit: 30 });
  // Bedrock/translate are the spendy paths — keep them well under the general API budget.
  const ai = limiter(limits.ai ?? { windowMs: 60_000, limit: 20 });

  return (request, response, next) => {
    if (request.path === '/api/health') {
      next();
      return;
    }
    if (request.path.startsWith('/api/stream')) {
      stream(request, response, next);
      return;
    }
    if (request.path.startsWith('/api/auth')) {
      auth(request, response, next);
      return;
    }
    if (request.path.startsWith('/api/ai')) {
      ai(request, response, next);
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
