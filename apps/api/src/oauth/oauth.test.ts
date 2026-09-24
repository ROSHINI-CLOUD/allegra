import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';

import express from 'express';
import request from 'supertest';

import { createApp } from '../app.js';
import type { AuthService } from '../auth/auth.js';
import { MemoryCacheStore } from '../lib/cache.js';
import { OAuthClients, isPrivateAddress, safeMetadataUrl } from './clients.js';
import { MemoryGrantLedger } from './ledger.js';
import { oauthRouter } from './router.js';
import { OAuthSigner } from './tokens.js';

const HOST = 'allegra.test';
const ORIGIN = `https://${HOST}`;
const RESOURCE = `${ORIGIN}/api/mcp`;
const REDIRECT = 'https://assistant.example/callback';

function app() {
  return createApp({
    version: 'test',
    jwtSecret: 'test-secret',
    saavnApiUrl: 'https://saavn.test/api',
    gaanaApiUrl: 'https://gaana.test/api',
    lrclibApiUrl: 'https://lrclib.test/api',
    rateLimit: false,
    allowedOrigin: 'http://localhost:5173'
  });
}

/** Every request as if it arrived at https://allegra.test behind the platform proxy. */
function at(server: ReturnType<typeof app>) {
  const agent = request(server);
  const wrap = (r: request.Test) => r.set('Host', HOST).set('X-Forwarded-Proto', 'https');
  return {
    get: (path: string) => wrap(agent.get(path)),
    post: (path: string) => wrap(agent.post(path))
  };
}

function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

async function session(server: ReturnType<typeof app>): Promise<string> {
  const response = await at(server).post('/api/auth/anon');
  return response.body.data.token as string;
}

async function register(server: ReturnType<typeof app>, redirect = REDIRECT): Promise<string> {
  const response = await at(server).post('/api/oauth/register').send({ client_name: 'Assistant', redirect_uris: [redirect] });
  assert.equal(response.status, 201);
  return response.body.client_id as string;
}

async function authorize(server: ReturnType<typeof app>, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return at(server).get(`/api/oauth/authorize?${query}`).redirects(0);
}

/** Register → authorize → approve; returns the code and what the exchange needs. */
async function codeFor(server: ReturnType<typeof app>, sessionToken?: string) {
  const clientId = await register(server);
  const { verifier, challenge } = pkce();
  const consent = await authorize(server, { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st8', resource: RESOURCE });
  assert.equal(consent.status, 302);
  const sealed = new URL(consent.headers.location!).searchParams.get('request')!;
  const approved = await at(server).post('/api/oauth/approve').set('Authorization', `Bearer ${sessionToken ?? (await session(server))}`).send({ request: sealed, decision: 'allow' });
  assert.equal(approved.status, 200);
  const back = new URL(approved.body.data.redirectTo);
  return { clientId, verifier, code: back.searchParams.get('code')!, back };
}

function exchange(server: ReturnType<typeof app>, fields: Record<string, string>) {
  return at(server).post('/api/oauth/token').type('form').send(fields);
}

test('discovery documents advertise what MCP clients require', async () => {
  const server = app();
  for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp']) {
    const prm = await at(server).get(path);
    assert.equal(prm.status, 200);
    assert.equal(prm.body.resource, RESOURCE);
    assert.deepEqual(prm.body.authorization_servers, [ORIGIN]);
    assert.equal(prm.headers['access-control-allow-origin'], '*');
  }
  const as = await at(server).get('/.well-known/oauth-authorization-server');
  assert.equal(as.body.issuer, ORIGIN);
  assert.deepEqual(as.body.code_challenge_methods_supported, ['S256']);
  assert.equal(as.body.client_id_metadata_document_supported, true);
  assert.equal(as.body.authorization_response_iss_parameter_supported, true);
  assert.equal(as.body.registration_endpoint, `${ORIGIN}/api/oauth/register`);
  assert.deepEqual(as.body.token_endpoint_auth_methods_supported, ['none']);
});

test('registration only accepts https or loopback redirects, and only public clients', async () => {
  const server = app();
  const bad = async (body: Record<string, unknown>) => (await at(server).post('/api/oauth/register').send(body)).status;
  assert.equal(await bad({ redirect_uris: ['http://evil.example/cb'] }), 400);
  assert.equal(await bad({ redirect_uris: ['javascript:alert(1)'] }), 400);
  assert.equal(await bad({ redirect_uris: ['https://ok.example/cb#frag'] }), 400);
  assert.equal(await bad({ redirect_uris: [] }), 400);
  assert.equal(await bad({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' }), 400);
  assert.equal(await bad({ redirect_uris: ['http://127.0.0.1:33418/cb'] }), 201);
});

test('an unknown client or unregistered redirect is refused without redirecting anywhere', async () => {
  const server = app();
  const clientId = await register(server);
  const { challenge } = pkce();
  const base = { response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256' };
  const unknown = await authorize(server, { ...base, client_id: 'mcpc_forged', redirect_uri: REDIRECT });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.headers.location, undefined);
  const elsewhere = await authorize(server, { ...base, client_id: clientId, redirect_uri: 'https://evil.example/steal' });
  assert.equal(elsewhere.status, 400);
  assert.equal(elsewhere.headers.location, undefined);
});

test('PKCE is mandatory and S256-only; errors go back to the client with state and iss', async () => {
  const server = app();
  const clientId = await register(server);
  const { challenge } = pkce();
  const missing = await authorize(server, { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, state: 's1' });
  const url = new URL(missing.headers.location!);
  assert.equal(url.origin + url.pathname, REDIRECT);
  assert.equal(url.searchParams.get('error'), 'invalid_request');
  assert.equal(url.searchParams.get('state'), 's1');
  assert.equal(url.searchParams.get('iss'), ORIGIN);
  const plain = await authorize(server, { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'plain' });
  assert.equal(new URL(plain.headers.location!).searchParams.get('error'), 'invalid_request');
  const foreign = await authorize(server, { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', resource: 'https://other.example/mcp' });
  assert.equal(new URL(foreign.headers.location!).searchParams.get('error'), 'invalid_target');
});

test('approving needs a session; denying sends access_denied back', async () => {
  const server = app();
  const clientId = await register(server);
  const { challenge } = pkce();
  const consent = await authorize(server, { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'z' });
  assert.equal(new URL(consent.headers.location!).pathname, '/connect');
  const sealed = new URL(consent.headers.location!).searchParams.get('request')!;
  const described = await at(server).get(`/api/oauth/request?request=${encodeURIComponent(sealed)}`);
  assert.equal(described.body.data.clientName, 'Assistant');
  assert.equal(described.body.data.redirectHost, 'assistant.example');
  const anonymous = await at(server).post('/api/oauth/approve').send({ request: sealed, decision: 'allow' });
  assert.equal(anonymous.status, 401);
  const denied = await at(server).post('/api/oauth/approve').set('Authorization', `Bearer ${await session(server)}`).send({ request: sealed, decision: 'deny' });
  const back = new URL(denied.body.data.redirectTo);
  assert.equal(back.searchParams.get('error'), 'access_denied');
  assert.equal(back.searchParams.get('state'), 'z');
  assert.equal(back.searchParams.get('code'), null);
});

test('the code exchange checks verifier, client and redirect, and a code works exactly once', async () => {
  const server = app();
  const { clientId, verifier, code, back } = await codeFor(server);
  assert.equal(back.searchParams.get('iss'), ORIGIN);
  assert.equal(back.searchParams.get('state'), 'st8');
  const fields = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: RESOURCE };
  assert.equal((await exchange(server, { ...fields, code_verifier: pkce().verifier })).body.error, 'invalid_grant');
  assert.equal((await exchange(server, { ...fields, client_id: await register(server) })).body.error, 'invalid_grant');
  assert.equal((await exchange(server, { ...fields, redirect_uri: 'https://assistant.example/other' })).body.error, 'invalid_grant');
  const ok = await exchange(server, fields);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.token_type, 'Bearer');
  assert.equal(ok.headers['cache-control'], 'no-store');
  const again = await exchange(server, fields);
  assert.equal(again.body.error, 'invalid_grant');
});

test('refresh tokens rotate, and a replayed one is refused', async () => {
  const server = app();
  const { clientId, verifier, code } = await codeFor(server);
  const first = await exchange(server, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
  const refreshed = await exchange(server, { grant_type: 'refresh_token', refresh_token: first.body.refresh_token, client_id: clientId });
  assert.equal(refreshed.status, 200);
  assert.notEqual(refreshed.body.refresh_token, first.body.refresh_token);
  const replay = await exchange(server, { grant_type: 'refresh_token', refresh_token: first.body.refresh_token, client_id: clientId });
  assert.equal(replay.body.error, 'invalid_grant');
});

test('OAuth tokens and app sessions never stand in for each other', async () => {
  const server = app();
  const sessionToken = await session(server);
  const { clientId, verifier, code } = await codeFor(server, sessionToken);
  const tokens = await exchange(server, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
  // An MCP access token is not an API session…
  const asSession = await at(server).get('/api/me/settings').set('Authorization', `Bearer ${tokens.body.access_token}`);
  assert.equal(asSession.status, 401);
  // …a refresh token is not an access token…
  const mcp = (token: string, host = HOST) => request(server).post('/api/mcp').set('Host', host).set('X-Forwarded-Proto', 'https')
    .set('Authorization', `Bearer ${token}`).set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  assert.equal((await mcp(tokens.body.refresh_token)).status, 401);
  // …and an access token is only good on the host it was issued for.
  assert.equal((await mcp(tokens.body.access_token, 'preview.allegra.test')).status, 401);
  assert.equal((await mcp(tokens.body.access_token)).status, 200);
});

test('when real accounts exist, a guest cannot connect an assistant', async () => {
  const signer = new OAuthSigner('s');
  const fakeAuth = { resolveCaller: async () => ({ userId: 'guest-1', source: 'guest' as const }) } as unknown as AuthService;
  const server = express();
  server.use(express.json());
  server.use(oauthRouter({ auth: fakeAuth, signer, clients: new OAuthClients(signer, new MemoryCacheStore()), ledger: new MemoryGrantLedger(), requireAccount: true }));
  const sealed = signer.sign('request', { cid: 'c', cn: 'n', ck: 'registered', ru: REDIRECT, cc: pkce().challenge, sc: 'music', iss: ORIGIN }, 600);
  const response = await request(server).post('/api/oauth/approve').set('Host', HOST).set('X-Forwarded-Proto', 'https')
    .set('Authorization', 'Bearer guest').send({ request: sealed, decision: 'allow' });
  assert.equal(response.status, 403);
});

test('client metadata documents: fetched safely and must name themselves', async () => {
  assert.equal(safeMetadataUrl('http://client.example/meta.json'), null);
  assert.equal(safeMetadataUrl('https://127.0.0.1/meta.json'), null);
  assert.equal(safeMetadataUrl('https://localhost/meta.json'), null);
  assert.equal(safeMetadataUrl('https://client.example:8443/meta.json'), null);
  assert.equal(safeMetadataUrl('https://client.example/'), null);
  assert.ok(safeMetadataUrl('https://client.example/oauth/meta.json'));
  for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress('93.184.216.34'), false);

  const id = 'https://client.example/oauth/meta.json';
  const document = { client_id: id, client_name: 'Example', redirect_uris: [REDIRECT] };
  const serve = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  const publicHost = async () => ['93.184.216.34'];
  const signer = new OAuthSigner('s');
  const ok = await new OAuthClients(signer, new MemoryCacheStore(), serve(document), publicHost).resolve(id);
  assert.equal(ok?.name, 'Example');
  assert.deepEqual(ok?.redirectUris, [REDIRECT]);
  assert.equal(await new OAuthClients(signer, new MemoryCacheStore(), serve({ ...document, client_id: 'https://other.example/x' }), publicHost).resolve(id), null);
  assert.equal(await new OAuthClients(signer, new MemoryCacheStore(), serve(document), async () => ['10.1.2.3']).resolve(id), null);
});
