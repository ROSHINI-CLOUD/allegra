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
  assert.equal(config.translation, undefined);
});

test('translation settings are optional and a malformed contact is ignored', () => {
  const config = loadConfig({ NODE_ENV: 'development', TRANSLATION_CONTACT_EMAIL: 'ops@example.com' });
  assert.deepEqual(config.translation, { contactEmail: 'ops@example.com' });
  const bad = loadConfig({ NODE_ENV: 'development', TRANSLATION_CONTACT_EMAIL: 'not an email' });
  assert.deepEqual(bad.translation, {});
});

test('a LibreTranslate fallback is optional, URL-validated, and never requires a key', () => {
  const config = loadConfig({ NODE_ENV: 'development', LIBRETRANSLATE_API_URL: 'https://translate.example' });
  assert.deepEqual(config.translation, { fallbackBaseUrl: 'https://translate.example' });
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', ALLEGRA_ORIGIN: 'https://app.example', JWT_SECRET: 'test-only-secret', SAAVN_API_URL: 'https://saavn.example/api', LIBRETRANSLATE_API_URL: 'http://127.0.0.1:5000' }),
    /LIBRETRANSLATE_API_URL/
  );
});

test('no AWS settings are read any more', () => {
  const config = loadConfig({
    NODE_ENV: 'development',
    AWS_REGION: 'ap-south-1',
    AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
    AWS_SECRET_ACCESS_KEY: 'secret',
    DDB_TABLE_CACHE: 'allegra-cache-dev',
    S3_COVERS_BUCKET: 'allegra-covers'
  }) as unknown as Record<string, unknown>;
  for (const key of ['cache', 'uploads', 'karaoke', 'ai']) assert.equal(config[key], undefined, key);
});
