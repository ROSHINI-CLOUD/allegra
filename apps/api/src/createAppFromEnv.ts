import type { Express } from 'express';

import { createApp, type AppOptions } from './app.js';
import { loadConfig } from './config.js';
import { MemoryCacheStore } from './lib/cache.js';

/** Shared by the local dev server (index.ts) and the Vercel function (api/index.ts). */
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
    ...(config.musicBrainz ? { musicBrainz: config.musicBrainz } : {}),
    ...(config.convexUrl && config.convexServerSecret
      ? { convexUrl: config.convexUrl, convexServerSecret: config.convexServerSecret }
      : {}),
    ...(config.convexSiteUrl ? { convexSiteUrl: config.convexSiteUrl } : {}),
    enableRequestLogging: config.enableRequestLogging,
    // Per-instance memory: a cold start refetches, which the providers are built to absorb.
    cacheStore: new MemoryCacheStore(),
    ...(config.translation ? { translation: config.translation } : {}),
    ...(config.allowedOrigin ? { allowedOrigin: config.allowedOrigin } : {}),
    ...(config.additionalOrigins ? { additionalOrigins: config.additionalOrigins } : {})
  };
  return createApp(options);
}
