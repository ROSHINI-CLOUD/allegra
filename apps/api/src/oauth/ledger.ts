/**
 * Remembers which one-time OAuth tokens (authorization codes, refresh tokens) were already used.
 * `consume` answers true exactly once per id. Convex backs it in production so the answer holds
 * across serverless instances; the memory ledger is for local development and tests.
 */
export interface GrantLedger {
  consume(jti: string, expiresAtMs: number): Promise<boolean>;
}

export class MemoryGrantLedger implements GrantLedger {
  private readonly spent = new Map<string, number>();

  public async consume(jti: string, expiresAtMs: number): Promise<boolean> {
    const now = Date.now();
    for (const [id, expires] of this.spent) if (expires < now) this.spent.delete(id);
    if (this.spent.has(jti)) return false;
    this.spent.set(jti, expiresAtMs);
    return true;
  }
}
