import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

const library = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  isPublic: v.boolean(),
  songIds: v.array(v.string()),
  createdAt: v.string(),
  coverKey: v.optional(v.string())
});

const recent = v.object({
  songId: v.string(),
  playDuration: v.number(),
  playedAt: v.string()
});

const tasteEntry = v.object({ name: v.string(), score: v.number() });

const userData = v.object({
  userId: v.string(),
  isGuest: v.boolean(),
  createdAt: v.string(),
  libraries: v.array(library),
  likedSongIds: v.array(v.string()),
  recentlyPlayed: v.array(recent),
  settings: v.any(),
  displayName: v.optional(v.string()),
  email: v.optional(v.string()),
  passwordHash: v.optional(v.string()),
  taste: v.optional(
    v.object({
      artists: v.array(tasteEntry),
      languages: v.array(tasteEntry),
      signals: v.number(),
      onboarded: v.boolean(),
      updatedAt: v.string()
    })
  )
});

/**
 * Convex functions are public URLs with no auth of their own, so every call here
 * is gated on a secret only the Express API holds (apps/api/src/db/convex.ts).
 * Set CONVEX_SERVER_SECRET in the Convex dashboard (Settings -> Environment
 * Variables) to the same value as the API's CONVEX_SERVER_SECRET.
 */
export function requireSecret(secret: string): void {
  const expected = process.env.CONVEX_SERVER_SECRET;
  if (!expected || secret !== expected) {
    throw new Error('Unauthorized');
  }
}

export const get = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('users')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique();
    if (!row) return null;
    const { _id, _creationTime, ...user } = row;
    return user;
  }
});

export const byEmail = query({
  args: { secret: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('users')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .first();
    if (!row) return null;
    const { _id, _creationTime, ...user } = row;
    return user;
  }
});

export const save = mutation({
  args: { secret: v.string(), user: userData },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query('users')
      .withIndex('by_userId', (q) => q.eq('userId', args.user.userId))
      .unique();
    if (existing) {
      // replace, not patch: a field the API dropped (a cleared display name) must actually go.
      await ctx.db.replace(existing._id, args.user);
    } else {
      await ctx.db.insert('users', args.user);
    }
    return null;
  }
});
