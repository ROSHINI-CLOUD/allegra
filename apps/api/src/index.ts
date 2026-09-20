import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig(process.env);
const app = createApp({
  version: config.version,
  jwtSecret: config.jwtSecret,
  saavnApiUrl: config.saavnApiUrl,
  ...(config.saavnSecondaryApiUrl ? { saavnSecondaryApiUrl: config.saavnSecondaryApiUrl } : {}),
  gaanaApiUrl: config.gaanaApiUrl,
  lrclibApiUrl: config.lrclibApiUrl,
  ...(config.lyricaApiUrl ? { lyricaApiUrl: config.lyricaApiUrl } : {}),
  ...(config.convexUrl && config.convexServerSecret ? { convexUrl: config.convexUrl, convexServerSecret: config.convexServerSecret } : {}),
  enableRequestLogging: config.enableRequestLogging,
  ...(config.allowedOrigin ? { allowedOrigin: config.allowedOrigin } : {}),
  ...(config.additionalOrigins ? { additionalOrigins: config.additionalOrigins } : {})
});

const server = app.listen(config.port, () => {
  if (config.nodeEnv !== 'test') {
    process.stdout.write(`Allegra API listening on port ${config.port}\n`);
  }
});

function shutdown(): void {
  server.close((error) => {
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
