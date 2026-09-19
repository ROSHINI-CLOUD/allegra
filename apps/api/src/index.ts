import { createApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '8080', 10);
const version = process.env.APP_VERSION ?? '0.1.0';
const allowedOrigin = process.env.ALLEGRA_ORIGIN;
const jwtSecret = process.env.JWT_SECRET;

if (process.env.NODE_ENV === 'production' && !jwtSecret) {
  throw new Error('JWT_SECRET is required in production.');
}

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const app = createApp({
  version,
  ...(allowedOrigin ? { allowedOrigin } : {}),
  ...(jwtSecret ? { jwtSecret } : {}),
  ...(process.env.SAAVN_API_URL ? { saavnApiUrl: process.env.SAAVN_API_URL } : {}),
  ...(process.env.GAANA_API_URL ? { gaanaApiUrl: process.env.GAANA_API_URL } : {}),
  ...(process.env.LRCLIB_API_URL ? { lrclibApiUrl: process.env.LRCLIB_API_URL } : {})
});

app.listen(port, () => {
  if (process.env.NODE_ENV !== 'test') {
    process.stdout.write(`Allegra API listening on port ${port}\n`);
  }
});
