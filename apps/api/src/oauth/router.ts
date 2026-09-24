import express, { Router, type Request, type Response } from 'express';

import type { AuthService } from '../auth/auth.js';
import { bearerToken } from '../auth/auth.js';
import { isLoopbackRedirect, type OAuthClient, type OAuthClients } from './clients.js';
import type { GrantLedger } from './ledger.js';
import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  REQUEST_TTL_SECONDS,
  SCOPES,
  grantedScope,
  isCodeChallenge,
  newJti,
  pkceMatches,
  type OAuthSigner
} from './tokens.js';

export const MCP_PATH = '/api/mcp';

/**
 * The public origin this request came in on (https://allegra.example). The issuer, the MCP
 * resource and every redirect are built from it, so production, previews and local dev each get
 * a consistent set; tokens minted on one host are refused on another (audience check).
 */
export function publicOrigin(request: Request): string {
  const forwardedHost = request.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwardedHost || request.get('host') || 'localhost';
  const forwardedProto = request.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
  const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : local ? 'http' : 'https';
  return `${proto}://${host.toLowerCase()}`;
}

export function mcpResource(origin: string): string {
  return `${origin}${MCP_PATH}`;
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

/** RFC 8707: accept the canonical resource with harmless variations (case, trailing slash). */
function sameResource(given: string, expected: string): boolean {
  try {
    const left = new URL(given);
    const right = new URL(expected);
    return left.origin === right.origin && left.pathname.replace(/\/+$/, '') === right.pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
}

export interface OAuthRouterDeps {
  readonly auth: AuthService;
  readonly signer: OAuthSigner;
  readonly clients: OAuthClients;
  readonly ledger: GrantLedger;
  /** When true, only signed-in (Google) accounts may connect; guests are per-browser and fragile. */
  readonly requireAccount: boolean;
}

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Pragma', 'no-cache');
}

function oauthError(response: Response, status: number, error: string, description: string): void {
  noStore(response);
  response.status(status).json({ error, error_description: description });
}

function text(value: unknown, max = 2048): string {
  return typeof value === 'string' && value.length <= max ? value.trim() : '';
}

function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * OAuth 2.1 authorization server for the MCP endpoint, per the MCP authorization spec:
 * protected-resource and authorization-server metadata, client registration (metadata documents
 * and RFC 7591), authorization code + PKCE (S256 only), refresh token rotation, RFC 8707 resource
 * binding and RFC 9207 `iss` on the redirect.
 *
 * The listener signs in and approves on the web app's /connect page; nothing here renders HTML.
 */
export function oauthRouter(deps: OAuthRouterDeps): Router {
  const router = Router();
  const { auth, signer, clients, ledger } = deps;

  const protectedResource = (request: Request, response: Response): void => {
    const origin = publicOrigin(request);
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.json({
      resource: mcpResource(origin),
      authorization_servers: [origin],
      scopes_supported: [...SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'Allegra',
      resource_documentation: `${origin}/connect`
    });
  };
  router.get('/.well-known/oauth-protected-resource', protectedResource);
  router.get(`/.well-known/oauth-protected-resource${MCP_PATH}`, protectedResource);

  router.get('/.well-known/oauth-authorization-server', (request, response) => {
    const origin = publicOrigin(request);
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.json({
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/authorize`,
      token_endpoint: `${origin}/api/oauth/token`,
      registration_endpoint: `${origin}/api/oauth/register`,
      scopes_supported: [...SCOPES],
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      service_documentation: `${origin}/connect`
    });
  });

  // RFC 7591 dynamic client registration (kept for clients that do not use metadata documents).
  router.post('/api/oauth/register', (request, response) => {
    const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
    const result = clients.register(body);
    if ('error' in result) {
      oauthError(response, 400, result.error, result.description);
      return;
    }
    noStore(response);
    response.status(201).json({
      client_id: result.client.clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: result.client.name,
      redirect_uris: result.client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    });
  });

  // Step 1: validate the request, then send the browser to the consent page with it sealed.
  router.get('/api/oauth/authorize', async (request, response) => {
    const origin = publicOrigin(request);
    const query = request.query as Record<string, unknown>;
    const clientId = text(query.client_id, 512);
    const redirectUri = text(query.redirect_uri, 512);
    const client = clientId ? await clients.resolve(clientId) : null;
    // Unknown client or unregistered redirect: never redirect anywhere (open-redirect guard).
    if (!client || !redirectUri || !client.redirectUris.includes(redirectUri)) {
      oauthError(response, 400, 'invalid_request', 'Unknown client or redirect_uri is not registered for it.');
      return;
    }
    const state = text(query.state, 1024) || undefined;
    const fail = (error: string, description: string): void => {
      response.redirect(302, redirectWith(redirectUri, { error, error_description: description, state, iss: origin }));
    };
    if (text(query.response_type) !== 'code') {
      fail('unsupported_response_type', 'Only response_type=code is supported.');
      return;
    }
    const challenge = text(query.code_challenge, 256);
    if (!isCodeChallenge(challenge) || text(query.code_challenge_method) !== 'S256') {
      fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
      return;
    }
    const resource = text(query.resource, 512);
    if (resource && !sameResource(resource, mcpResource(origin))) {
      fail('invalid_target', 'This server only issues tokens for its own MCP endpoint.');
      return;
    }
    const sealed = signer.sign('request', {
      cid: client.clientId,
      cn: client.name,
      ck: client.kind,
      ru: redirectUri,
      cc: challenge,
      sc: grantedScope(text(query.scope, 512) || undefined),
      st: state,
      iss: origin
    }, REQUEST_TTL_SECONDS);
    response.redirect(302, `${origin}/connect?request=${encodeURIComponent(sealed)}`);
  });

  const openRequest = (request: Request, value: unknown): Record<string, unknown> | null => {
    const claims = signer.verify('request', text(value, 4096));
    return claims && claims.iss === publicOrigin(request) ? claims : null;
  };

  // For the consent page: who is asking, where they will be sent, and for what.
  router.get('/api/oauth/request', (request, response) => {
    const claims = openRequest(request, request.query.request);
    if (!claims) {
      response.status(400).json({ success: false, data: null, error: 'This connection request has expired. Start again from your assistant.' });
      return;
    }
    const redirectUri = String(claims.ru);
    noStore(response);
    response.json({
      success: true,
      data: {
        clientName: claims.cn,
        clientId: claims.ck === 'metadata-document' ? claims.cid : null,
        redirectHost: new URL(redirectUri).host,
        localRedirect: isLoopbackRedirect(redirectUri),
        scope: claims.sc,
        requiresAccount: deps.requireAccount
      }
    });
  });

  // Step 2: the signed-in listener allows or denies. Answers where to send the browser next.
  router.post('/api/oauth/approve', async (request, response) => {
    const token = bearerToken(request.header('authorization'));
    const caller = token ? await auth.resolveCaller(token) : null;
    if (!caller) {
      response.status(401).json({ success: false, data: null, error: 'Sign in to connect your account.' });
      return;
    }
    if (deps.requireAccount && caller.source !== 'convex') {
      response.status(403).json({ success: false, data: null, error: 'Sign in with Google to connect an assistant to your library.' });
      return;
    }
    const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
    const claims = openRequest(request, body.request);
    if (!claims) {
      response.status(400).json({ success: false, data: null, error: 'This connection request has expired. Start again from your assistant.' });
      return;
    }
    const origin = publicOrigin(request);
    const redirectUri = String(claims.ru);
    const state = typeof claims.st === 'string' ? claims.st : undefined;
    noStore(response);
    if (body.decision !== 'allow') {
      response.json({ success: true, data: { redirectTo: redirectWith(redirectUri, { error: 'access_denied', error_description: 'The listener declined.', state, iss: origin }) } });
      return;
    }
    const code = signer.sign('code', {
      sub: caller.userId,
      cid: claims.cid,
      ru: redirectUri,
      cc: claims.cc,
      sc: claims.sc,
      aud: mcpResource(origin),
      iss: origin,
      jti: newJti()
    }, CODE_TTL_SECONDS);
    response.json({ success: true, data: { redirectTo: redirectWith(redirectUri, { code, state, iss: origin }) } });
  });

  // Step 3: code (+ PKCE verifier) or refresh token → access token. Form-encoded per OAuth.
  router.post('/api/oauth/token', express.urlencoded({ extended: false, limit: '16kb' }), async (request, response) => {
    const origin = publicOrigin(request);
    const body = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>) : {};
    const grantType = text(body.grant_type);
    const clientId = text(body.client_id, 4096);
    const resource = text(body.resource, 512);
    if (resource && !sameResource(resource, mcpResource(origin))) {
      oauthError(response, 400, 'invalid_target', 'This server only issues tokens for its own MCP endpoint.');
      return;
    }

    if (grantType === 'authorization_code') {
      const claims = signer.verify('code', text(body.code, 4096));
      if (!claims || claims.iss !== origin || claims.cid !== clientId || claims.ru !== text(body.redirect_uri, 512)) {
        oauthError(response, 400, 'invalid_grant', 'The authorization code is invalid, expired, or not for this client.');
        return;
      }
      if (!pkceMatches(text(body.code_verifier, 256), String(claims.cc))) {
        oauthError(response, 400, 'invalid_grant', 'PKCE verification failed.');
        return;
      }
      if (!(await ledger.consume(String(claims.jti), Number(claims.exp) * 1000))) {
        oauthError(response, 400, 'invalid_grant', 'The authorization code was already used.');
        return;
      }
      issueTokens(response, String(claims.sub), clientId, String(claims.sc), origin);
      return;
    }

    if (grantType === 'refresh_token') {
      const claims = signer.verify('refresh', text(body.refresh_token, 4096));
      if (!claims || claims.iss !== origin || claims.cid !== clientId) {
        oauthError(response, 400, 'invalid_grant', 'The refresh token is invalid or expired.');
        return;
      }
      // Rotation: each refresh token works once. A replayed one is refused.
      if (!(await ledger.consume(String(claims.jti), Number(claims.exp) * 1000))) {
        oauthError(response, 400, 'invalid_grant', 'The refresh token was already used.');
        return;
      }
      // The account must still exist; a deleted listener cannot keep a connection alive.
      if (!(await auth.getUser(String(claims.sub)).catch(() => null))) {
        oauthError(response, 400, 'invalid_grant', 'That account no longer exists.');
        return;
      }
      issueTokens(response, String(claims.sub), clientId, grantedScope(text(body.scope) || String(claims.sc)), origin);
      return;
    }

    oauthError(response, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
  });

  function issueTokens(response: Response, userId: string, clientId: string, scope: string, origin: string): void {
    const accessToken = signer.sign('access', { sub: userId, cid: clientId, sc: scope, aud: mcpResource(origin), iss: origin }, ACCESS_TTL_SECONDS);
    const refreshToken = signer.sign('refresh', { sub: userId, cid: clientId, sc: scope, iss: origin, jti: newJti() }, REFRESH_TTL_SECONDS);
    noStore(response);
    response.json({ access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, refresh_token: refreshToken, scope });
  }

  return router;
}

/** The listener behind an MCP request, or null. Only our own access tokens, for this exact resource. */
export function verifyMcpAccess(signer: OAuthSigner, request: Request): { userId: string; clientId: string } | null {
  const token = bearerToken(request.header('authorization'));
  if (!token) return null;
  const claims = signer.verify('access', token);
  const origin = publicOrigin(request);
  if (!claims || claims.iss !== origin || claims.aud !== mcpResource(origin) || typeof claims.sub !== 'string') return null;
  return { userId: claims.sub, clientId: String(claims.cid ?? '') };
}

export type { OAuthClient };
