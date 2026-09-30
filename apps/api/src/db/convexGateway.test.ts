import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TimeoutError } from '../lib/errors.js';
import { CONVEX_MUTATIONS, CONVEX_QUERIES, ConvexGateway, type ConvexClientLike } from './convexGateway.js';

const url = 'https://example.convex.cloud';
const serverSecret = 'a-long-shared-secret';

/** A Convex HTTP reply as ConvexHttpClient reads it. */
const reply = (value: unknown): Response => new Response(JSON.stringify({ status: 'success', value, logLines: [] }), { status: 200 });

test('every call names its function and carries the server secret', async () => {
  const calls: { kind: string; name: string; args: Record<string, unknown> }[] = [];
  const client: ConvexClientLike = {
    query: async (name, args) => (calls.push({ kind: 'query', name, args }), null),
    mutation: async (name, args) => (calls.push({ kind: 'mutation', name, args }), null)
  };
  const convex = new ConvexGateway({ url, serverSecret, client });

  await convex.query('profiles:get', { userId: 'u1' });
  await convex.mutation('covers:generateUploadUrl');

  assert.deepEqual(calls, [
    { kind: 'query', name: 'profiles:get', args: { userId: 'u1', secret: serverSecret } },
    { kind: 'mutation', name: 'covers:generateUploadUrl', args: { secret: serverSecret } }
  ]);
});

test('a call Convex never answers gives up with TimeoutError', async () => {
  const client: ConvexClientLike = {
    query: () => new Promise(() => undefined),
    mutation: () => new Promise(() => undefined)
  };
  const convex = new ConvexGateway({ url, serverSecret, client, timeoutMs: 20 });

  await assert.rejects(convex.query('profiles:get', { userId: 'u1' }), TimeoutError);
  await assert.rejects(convex.mutation('profiles:save', { user: {} }), TimeoutError);
});

test('over HTTP, a stalled request is cancelled, not left hanging', async () => {
  let markAborted: () => void = () => undefined;
  const aborted = new Promise<void>((resolve) => {
    markAborted = resolve;
  });
  const fetchImpl: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        markAborted();
        reject(new DOMException('aborted', 'AbortError'));
      });
    });
  const convex = new ConvexGateway({ url, serverSecret, fetchImpl, timeoutMs: 20 });

  await assert.rejects(convex.query('profiles:get', { userId: 'u1' }), TimeoutError);
  // The caller is released first; the request's own deadline cancels it right after.
  await aborted;
});

test('over HTTP, mutations from different requests run in parallel rather than queueing', async () => {
  // Each request is held until a second one is in flight. A queueing client would never send the
  // second, and both calls would time out.
  const waiting: (() => void)[] = [];
  const fetchImpl: typeof fetch = async () => {
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
      if (waiting.length === 2) waiting.forEach((release) => release());
    });
    return reply(true);
  };
  const convex = new ConvexGateway({ url, serverSecret, fetchImpl, timeoutMs: 500 });

  const results = await Promise.all([
    convex.mutation('oauth:consume', { jti: 'a', expiresAt: 1 }),
    convex.mutation('oauth:consume', { jti: 'b', expiresAt: 1 })
  ]);
  assert.deepEqual(results, [true, true]);
});

test('every function the API calls is exported by convex/', async () => {
  const convexDir = new URL('../../../../convex/', import.meta.url);
  for (const name of [...CONVEX_QUERIES, ...CONVEX_MUTATIONS]) {
    const [module, fn] = name.split(':') as [string, string];
    const source = await readFile(new URL(`${module}.ts`, convexDir), 'utf8');
    assert.match(source, new RegExp(`export const ${fn} = `), `${name} is not exported by convex/${module}.ts`);
  }
});
