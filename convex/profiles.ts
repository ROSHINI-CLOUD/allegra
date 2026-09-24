import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { playStat } from './schema';

const library = v.object({
  id: v.string(),
  name: v.string(),
  description: v.optional(v.string()),
  isPublic: v.boolean(),
  songIds: v.array(v.string()),
  createdAt: v.string(),
  coverKey: v.optional(v.string()),
  coverUrl: v.optional(v.string())
});

const recent = v.object({
  songId: v.string(),
  playDuration: v.number(),
  playedAt: v.string()
});

const tasteEntry = v.object({ name: v.string(), score: v.number() });

const profileData = v.object({
  userId: v.string(),
  isGuest: v.boolean(),
  createdAt: v.string(),
  libraries: v.array(library),
  likedSongIds: v.array(v.string()),
  recentlyPlayed: v.array(recent),
  settings: v.any(),
  displayName: v.optional(v.string()),
  email: v.optional(v.string()),
  taste: v.optional(
    v.object({
      artists: v.array(tasteEntry),
      languages: v.array(tasteEntry),
      signals: v.number(),
      onboarded: v.boolean(),
      updatedAt: v.string()
    })
  ),
  playStats: v.optional(v.array(playStat))
});

/**
 * These functions are public URLs with no auth of their own, so every call is gated
 * on a secret only the Express API holds (apps/api/src/db/convex.ts). Set
 * CONVEX_SERVER_SECRET in the Convex dashboard to the same value as the API's.
 *
 * Sign-in is a separate concern and lives in convex/auth.ts.
 */
export function requireSecret(secret: string): void {
  const expected = process.env.CONVEX_SERVER_SECRET;
  if (!expected || !sameSecret(secret, expected)) {
    throw new Error('Unauthorized');
  }
}

/** Constant-time compare, so response timing cannot reveal how much of a guess was right. */
function sameSecret(given: string, expected: string): boolean {
  let diff = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    diff |= (given.charCodeAt(i % Math.max(1, given.length)) || 0) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export const get = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('profiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .unique();
    if (!row) return null;
    const { _id, _creationTime, ...profile } = row;
    return profile;
  }
});

export const byEmail = query({
  args: { secret: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('profiles')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .first();
    if (!row) return null;
    const { _id, _creationTime, ...profile } = row;
    return profile;
  }
});

export const save = mutation({
  args: { secret: v.string(), user: profileData },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_userId', (q) => q.eq('userId', args.user.userId))
      .unique();
    if (existing) {
      // replace, not patch: a field the API dropped (a cleared display name) must actually go.
      await ctx.db.replace(existing._id, args.user);
    } else {
      await ctx.db.insert('profiles', args.user);
    }
    return null;
  }
});

/**
 * Who Google says this person is, for the API to copy onto a new profile the first
 * time they sign in. Reads Convex Auth's own user row — never the password-free
 * account records around it.
 */
export const identity = query({
  args: { secret: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const id = ctx.db.normalizeId('users', args.userId);
    if (!id) return null;
    const row = await ctx.db.get(id);
    if (!row) return null;
    return {
      email: typeof row.email === 'string' ? row.email : undefined,
      displayName: typeof row.name === 'string' ? row.name : undefined
    };
  }
});
