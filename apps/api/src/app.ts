import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { createServices, type AppServices } from './services.js';
import { artworkRouter } from './routes/artwork.js';
import { authRouter } from './routes/auth.js';
import { catalogRouter } from './routes/catalog.js';
import { lyricsRouter } from './routes/lyrics.js';
import { streamRouter } from './routes/stream.js';
import { userRouter } from './routes/user.js';

export interface AppOptions {
  readonly version: string;
  readonly allowedOrigin?: string;
  readonly jwtSecret?: string;
  readonly services?: AppServices;
  readonly saavnApiUrl?: string;
  readonly gaanaApiUrl?: string;
  readonly lrclibApiUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

export function createApp(options: AppOptions): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: options.allowedOrigin ?? false,
      credentials: false
    })
  );

  const services = options.services ?? createServices({
    jwtSecret: options.jwtSecret ?? process.env.JWT_SECRET ?? 'local-development-only',
    ...(options.saavnApiUrl ? { saavnApiUrl: options.saavnApiUrl } : {}),
    ...(options.gaanaApiUrl ? { gaanaApiUrl: options.gaanaApiUrl } : {}),
    ...(options.lrclibApiUrl ? { lrclibApiUrl: options.lrclibApiUrl } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(
    rateLimit({
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      windowMs: 60_000,
      limit: 120
    })
  );

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true, version: options.version });
  });

  app.use('/api', catalogRouter(services.catalog));
  app.use('/api', artworkRouter(services.artwork));
  app.use('/api', lyricsRouter(services.lyrics));
  app.use('/api', streamRouter(services.stream));
  app.use('/api', authRouter(services.auth));
  app.use('/api', userRouter(services.auth, services.catalog));

  return app;
}
