import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from './config.js';

test('production startup fails without JWT_SECRET', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', ALLEGRA_ORIGIN: 'https://app.example', SAAVN_API_URL: 'https://saavn.example/api' }),
    /JWT_SECRET/
  );
});

test('production startup fails without ALLEGRA_ORIGIN', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'test-only-secret', SAAVN_API_URL: 'https://saavn.example/api' }),
    /ALLEGRA_ORIGIN/
  );
});

test('production rejects credentialed or private provider URLs', () => {
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'test-only-secret',
      ALLEGRA_ORIGIN: 'https://app.example',
      SAAVN_API_URL: 'https://user:pass@saavn.example/api'
    }),
    /SAAVN_API_URL/
  );
  assert.throws(
    () => loadConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'test-only-secret',
      ALLEGRA_ORIGIN: 'https://app.example',
      SAAVN_API_URL: 'https://127.0.0.1/api'
    }),
    /SAAVN_API_URL/
  );
});

test('production accepts a complete trusted configuration', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    PORT: '8080',
    JWT_SECRET: 'test-only-secret',
    ALLEGRA_ORIGIN: 'https://app.example',
    SAAVN_API_URL: 'https://saavn.example/api',
    GAANA_API_URL: 'https://gaana.example/api',
    LRCLIB_API_URL: 'https://lrclib.net/api'
  });

  assert.equal(config.port, 8080);
  assert.equal(config.allowedOrigin, 'https://app.example');
  assert.equal(config.saavnApiUrl, 'https://saavn.example/api');
  assert.equal(config.enableRequestLogging, true);
});
