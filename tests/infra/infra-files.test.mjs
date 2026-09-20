import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Amplify build config targets the web app and outputs dist', async () => {
  const amplify = await text('amplify.yml');
  assert.match(amplify, /appRoot:\s*apps\/web/);
  assert.match(amplify, /npm ci/);
  assert.match(amplify, /npm run build/);
  assert.match(amplify, /baseDirectory:\s*dist/);
});

test('Amplify SPA rewrite sends deep links to index.html', async () => {
  const rewrites = JSON.parse(await text('infra/amplify-rewrites.json'));
  const rule = rewrites[0];
  assert.equal(rule.target, '/index.html');
  assert.equal(rule.status, '200');
});

test('the API Dockerfile still builds (App Runner deploys from source, but the image stays CI-checked)', async () => {
  const dockerfile = await text('apps/api/Dockerfile');
  assert.match(dockerfile, /EXPOSE 8080/);
  assert.match(dockerfile, /\/api\/health/);
});

test('CI runs the release gates, builds the web app and the API image', async () => {
  const ci = await text('.github/workflows/ci.yml');
  assert.match(ci, /npm run typecheck/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run build/);
  assert.match(ci, /docker build/);
});

test('no AWS SDK code remains in the API', async () => {
  const pkg = JSON.parse(await text('apps/api/package.json'));
  assert.equal(Object.keys(pkg.dependencies).some((name) => name.startsWith('@aws-sdk')), false);
});
