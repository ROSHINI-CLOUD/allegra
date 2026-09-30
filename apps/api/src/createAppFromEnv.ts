import type { Express } from 'express';

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { MemoryCacheStore } from './lib/cache.js';

/** Shared by the local dev server (index.ts) and the Vercel function (api/index.ts). */
export function createAppFromEnv(env: NodeJS.Dict<string>): Express {
  // The loaded config is already the app's options: provider settings pass straight through.
  // Per-instance memory cache: a cold start refetches, which the providers are built to absorb.
  return createApp({ ...loadConfig(env), cacheStore: new MemoryCacheStore() });
}
