import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

/**
 * Everything the MCP OAuth server hands out is a signed, self-describing token, so the flow
 * needs no server-side session store (the API is serverless and instances share nothing).
 *
 * The signing key is derived from JWT_SECRET but is not JWT_SECRET: a guest session token and an
 * OAuth token can never verify as each other. Every token also carries a `typ`, checked on the
 * way in, so a code cannot be replayed as an access token or a client id as anything at all.
 */
export type OAuthTokenType = 'client' | 'request' | 'code' | 'access' | 'refresh';

export const ACCESS_TTL_SECONDS = 3_600;
export const REFRESH_TTL_SECONDS = 30 * 24 * 3_600;
export const CODE_TTL_SECONDS = 300;
export const REQUEST_TTL_SECONDS = 600;

export const SCOPES = ['music'] as const;
export const DEFAULT_SCOPE = 'music';

export class OAuthSigner {
  private readonly key: Buffer;

  public constructor(secret: string) {
    this.key = crypto.createHmac('sha256', secret).update('allegra-mcp-oauth-v1').digest();
  }

  public sign(typ: OAuthTokenType, claims: Record<string, unknown>, expiresInSeconds?: number): string {
    return jwt.sign({ ...claims, typ }, this.key, {
      algorithm: 'HS256',
      ...(expiresInSeconds ? { expiresIn: expiresInSeconds } : {})
    });
  }

  /** The claims when the token is ours, of this type, and unexpired; otherwise null. */
  public verify(typ: OAuthTokenType, token: string): Record<string, unknown> | null {
    if (!token || token.length > 4096) return null;
    try {
      const payload = jwt.verify(token, this.key, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || payload.typ !== typ) return null;
      return payload as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)) must equal the challenge sent at /authorize. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  const left = Buffer.from(computed);
  const right = Buffer.from(challenge);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function isCodeChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

/** Known scopes out of whatever a client asked for; none known means the default. */
export function grantedScope(requested: string | undefined): string {
  const known = new Set<string>(SCOPES);
  const kept = (requested ?? '').split(/\s+/).filter((scope) => known.has(scope));
  return kept.length > 0 ? [...new Set(kept)].join(' ') : DEFAULT_SCOPE;
}

export function newJti(): string {
  return crypto.randomUUID();
}
