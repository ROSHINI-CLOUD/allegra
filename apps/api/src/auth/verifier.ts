import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/** Who is calling, and on what authority. */
export interface VerifiedCaller {
  readonly userId: string;
  /** `guest` is a token we minted; `convex` means Convex Auth signed in a real account. */
  readonly source: 'guest' | 'convex';
}

/**
 * Seam for "is this bearer token real, and whose is it?".
 *
 * Two kinds of caller reach this API — a guest holding a token we minted, and a
 * signed-in listener holding one Convex issued after Google. Keeping them behind a
 * single port means routes never branch on which kind it is.
 */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedCaller | null>;
}

/** Anonymous sessions: symmetric, signed and checked by this API alone. */
export class GuestTokenVerifier implements TokenVerifier {
  public constructor(private readonly secret: string) {}

  public async verify(token: string): Promise<VerifiedCaller | null> {
    try {
      const payload = jwt.verify(token, this.secret);
      if (typeof payload === 'string' || typeof payload.sub !== 'string') return null;
      return { userId: payload.sub, source: 'guest' };
    } catch {
      return null;
    }
  }

  public sign(userId: string): string {
    return jwt.sign({}, this.secret, { subject: userId, expiresIn: '30d' });
  }
}

export interface ConvexTokenVerifierOptions {
  /** Convex site origin, e.g. https://acme-1.convex.site — the JWT issuer. */
  readonly siteUrl: string;
  /** Injectable for tests; defaults to the deployment's published JWKS. */
  readonly keys?: Parameters<typeof jwtVerify>[1];
}

/**
 * Convex Auth sessions. Convex signs them with a private key we never hold and
 * publishes the public half, so this API can trust a caller without touching a
 * Google secret.
 */
export class ConvexTokenVerifier implements TokenVerifier {
  private readonly issuer: string;
  private readonly keys: Parameters<typeof jwtVerify>[1];

  public constructor(options: ConvexTokenVerifierOptions) {
    this.issuer = options.siteUrl.replace(/\/+$/, '');
    this.keys = options.keys ?? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
  }

  public async verify(token: string): Promise<VerifiedCaller | null> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        issuer: this.issuer,
        audience: 'convex'
      });
      const userId = subjectUserId(payload.sub);
      return userId ? { userId, source: 'convex' } : null;
    } catch {
      return null;
    }
  }
}

/**
 * Convex Auth's subject is `<userId>|<sessionId>`. We key profiles on the user, so
 * a second device or a re-login is the same listener.
 */
export function subjectUserId(subject: string | undefined): string | null {
  const userId = subject?.split('|')[0]?.trim();
  return userId || null;
}

/** Tries each verifier in turn. Order matters only for cost: the local check is free. */
export class FirstMatchVerifier implements TokenVerifier {
  private readonly verifiers: readonly TokenVerifier[];

  public constructor(...verifiers: readonly (TokenVerifier | undefined)[]) {
    this.verifiers = verifiers.filter((verifier): verifier is TokenVerifier => Boolean(verifier));
  }

  public async verify(token: string): Promise<VerifiedCaller | null> {
    for (const verifier of this.verifiers) {
      const caller = await verifier.verify(token);
      if (caller) return caller;
    }
    return null;
  }
}
