import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

async function json(path) {
  return JSON.parse(await text(path));
}

test('Vercel builds the Next.js app', async () => {
  const vercel = await json('vercel.json');
  assert.equal(vercel.framework, 'nextjs');
  assert.match(vercel.buildCommand, /apps\/web/);
  assert.equal(vercel.outputDirectory, 'apps/web/.next');
});

test('the /api rewrite still points at the Express function', async () => {
  // Next's optional catch-all route matches every path, including /api/*. Without
  // this rewrite the Express function is shadowed and the whole API 404s behind a
  // page that renders fine — so the failure looks like a frontend bug.
  const vercel = await json('vercel.json');
  const apiRewrite = vercel.rewrites?.find((rule) => rule.source.startsWith('/api'));
  assert.ok(apiRewrite, 'vercel.json must rewrite /api/* to the Express function');
  assert.equal(apiRewrite.destination, '/api');
});

test('one lockfile: every workspace installs from the root', async () => {
  // Vercel resolves function dependencies from the repo root. Per-app lockfiles let
  // a package exist locally but be missing in production (ERR_MODULE_NOT_FOUND).
  const pkg = await json('package.json');
  assert.deepEqual(pkg.workspaces, ['apps/*', 'packages/*']);
  for (const stale of ['apps/api/package-lock.json', 'apps/web/package-lock.json']) {
    await assert.rejects(text(stale), 'per-workspace lockfiles must not come back');
  }
});

test('Convex schema and functions exist for the UserStore seam', async () => {
  const schema = await text('convex/schema.ts');
  // Convex Auth owns `users`; our listener data lives alongside it in `profiles`.
  assert.match(schema, /\.\.\.authTables/);
  assert.match(schema, /profiles:\s*defineTable/);
  const profiles = await text('convex/profiles.ts');
  assert.match(profiles, /export const get = query/);
  assert.match(profiles, /export const save = mutation/);
});

test('Google sign-in is wired through Convex Auth, not this repo', async () => {
  // A Google secret must never reach our API or the browser bundle: Convex holds it.
  const auth = await text('convex/auth.ts');
  assert.match(auth, /convexAuth/);
  assert.match(auth, /providers:\s*\[Google\]/);
  const http = await text('convex/http.ts');
  assert.match(http, /auth\.addHttpRoutes\(http\)/);
});

test('CI runs the release gates', async () => {
  const ci = await text('.github/workflows/ci.yml');
  assert.match(ci, /npm run typecheck/);
  assert.match(ci, /npm run lint/);
  assert.match(ci, /npm test/);
  assert.match(ci, /npm run build/);
});

test('no AWS anywhere: no SDK, no infra stack, no worker', async () => {
  // Karaoke separation runs in the browser, covers live in Convex storage, the cache is memory.
  for (const workspace of ['package.json', 'apps/api/package.json', 'apps/web/package.json']) {
    const pkg = await json(workspace);
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.deepEqual(deps.filter((name) => name.startsWith('@aws-sdk')), [], workspace);
  }
  for (const gone of ['infra/aws/karaoke-batch.yaml', 'workers/stem-separator/worker.py']) {
    await assert.rejects(text(gone), `${gone} must not come back`);
  }
});

test('OAuth discovery for the MCP connector is routed to the API function', async () => {
  // MCP clients look for these at the site root; without the rewrite Next renders a page there.
  const vercel = await json('vercel.json');
  const sources = (vercel.rewrites ?? []).filter((rule) => rule.destination === '/api').map((rule) => rule.source);
  assert.ok(sources.includes('/.well-known/oauth-protected-resource'));
  assert.ok(sources.includes('/.well-known/oauth-protected-resource/(.*)'));
  assert.ok(sources.includes('/.well-known/oauth-authorization-server'));
  const api = vercel.rewrites.findIndex((rule) => rule.source.startsWith('/api'));
  assert.equal(api, 0, '/api must stay the first rewrite');
});

test('Convex has cover storage and the OAuth grant ledger', async () => {
  const covers = await text('convex/covers.ts');
  assert.match(covers, /generateUploadUrl/);
  assert.match(covers, /requireSecret\(args\.secret\)/);
  const schema = await text('convex/schema.ts');
  assert.match(schema, /oauthGrants:\s*defineTable/);
});

test('no provider secrets are reachable from the browser bundle', async () => {
  // Anything NEXT_PUBLIC_* is inlined into public JavaScript.
  const env = await text('apps/api/.env.example');
  const publicKeys = env
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+)=/)?.[1])
    .filter(Boolean);
  assert.deepEqual(publicKeys, [], 'server .env.example must not define NEXT_PUBLIC_* keys');
});
