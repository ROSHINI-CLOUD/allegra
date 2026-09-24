import { v } from 'convex/values';

import { internalMutation, mutation } from './_generated/server';
import { requireSecret } from './profiles';

/**
 * Single use for OAuth authorization codes and refresh tokens. The tokens themselves are signed
 * and stateless; this only remembers which ones were already spent, until they expire anyway.
 * Only the API calls it (server secret).
 */
export const consume = mutation({
  args: { secret: v.string(), jti: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (args.jti.length === 0 || args.jti.length > 100) throw new Error('Bad token id');
    const existing = await ctx.db
      .query('oauthGrants')
      .withIndex('by_jti', (q) => q.eq('jti', args.jti))
      .unique();
    if (existing) return false;
    await ctx.db.insert('oauthGrants', { jti: args.jti, expiresAt: args.expiresAt });
    return true;
  }
});

/** Daily: drop spent entries whose token has expired (they can no longer be presented). */
export const sweep = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const expired = await ctx.db
      .query('oauthGrants')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(500);
    for (const row of expired) await ctx.db.delete('oauthGrants', row._id);
    return expired.length;
  }
});
