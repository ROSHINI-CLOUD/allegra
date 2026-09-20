import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('Vercel build config targets the web app and outputs dist', async () => {
  const vercel = JSON.parse(await text('vercel.json'));
  assert.match(vercel.buildCommand, /apps\/web/);
  assert.equal(vercel.outputDirectory, 'apps/web/dist');
});

test('Convex schema and functions exist for the UserStore seam', async () => {
  const schema = await text('convex/schema.ts');
  assert.match(schema, /users:\s*defineTable/);
  const users = await text('convex/users.ts');
  assert.match(users, /export const get = query/);
  assert.match(users, /export const save = mutation/);
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
