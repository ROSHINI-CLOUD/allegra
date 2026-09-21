import type { Express } from 'express';

import { createApp, type AppOptions } from './app.js';
import { loadConfig } from './config.js';
import { createCacheStore } from './db/createCacheStore.js';

/** Shared by the App Runner entrypoint (index.ts) and the Vercel serverless function. */
export function createAppFromEnv(env: NodeJS.Dict<string>): Express {
  const config = loadConfig(env);
  const options: AppOptions = {
    version: config.version,
    jwtSecret: config.jwtSecret,
    saavnApiUrl: config.saavnApiUrl,
    ...(config.saavnSecondaryApiUrl ? { saavnSecondaryApiUrl: config.saavnSecondaryApiUrl } : {}),
    gaanaApiUrl: config.gaanaApiUrl,
    lrclibApiUrl: config.lrclibApiUrl,
    ...(config.lyricaApiUrl ? { lyricaApiUrl: config.lyricaApiUrl } : {}),
    ...(config.betterLyricsApiUrl ? { betterLyricsApiUrl: config.betterLyricsApiUrl } : {}),
    ...(config.betterLyricsApiKey ? { betterLyricsApiKey: config.betterLyricsApiKey } : {}),
    ...(config.scarletaApiKey ? { scarletaApiKey: config.scarletaApiKey } : {}),
    ...(config.scarletaApiBaseUrl ? { scarletaApiBaseUrl: config.scarletaApiBaseUrl } : {}),
    ...(config.convexUrl && config.convexServerSecret
      ? { convexUrl: config.convexUrl, convexServerSecret: config.convexServerSecret }
      : {}),
    enableRequestLogging: config.enableRequestLogging,
    ai: config.ai,
    cacheStore: createCacheStore(config.cache),
    ...(config.uploads ? { uploads: config.uploads } : {}),
    ...(config.allowedOrigin ? { allowedOrigin: config.allowedOrigin } : {}),
    ...(config.additionalOrigins ? { additionalOrigins: config.additionalOrigins } : {})
  };
  return createApp(options);
}
