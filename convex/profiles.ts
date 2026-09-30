import { v } from 'convex/values';

import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
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

/** Recent listens kept per profile; must match RECENTLY_PLAYED_LIMIT in apps/api/src/user/store.ts. */
const RECENTLY_PLAYED_LIMIT = 25;

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
    // The cap is enforced here too, so no caller can grow the array past it.
    const user = { ...args.user, recentlyPlayed: args.user.recentlyPlayed.slice(0, RECENTLY_PLAYED_LIMIT) };
    const existing = await ctx.db
      .query('profiles')
      .withIndex('by_userId', (q) => q.eq('userId', user.userId))
      .unique();
    if (existing) {
      // Once a listener's library lives in rows (convex/library.ts), this copy is rebuilt there
      // and only there: a whole-profile save carrying an older copy (a taste update racing a
      // like from the phone) must not undo that change.
      const libraryOwned = await ctx.db
        .query('libraryState')
        .withIndex('by_userId', (q) => q.eq('userId', user.userId))
        .unique();
      const kept = libraryOwned ? { likedSongIds: existing.likedSongIds, libraries: existing.libraries } : {};
      // replace, not patch: a field the API dropped (a cleared display name) must actually go.
      await ctx.db.replace(existing._id, { ...user, ...kept });
    } else {
      await ctx.db.insert('profiles', user);
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

/**
 * One-off cleanup: trims every profile's recent listens to the cap. Profiles written before the
 * cap dropped to 25 hold up to 50 until their next save; this clears them now. Walks the table in
 * pages, each page its own transaction, and schedules the next page until done.
 *
 *   npx convex run profiles:trimRecentlyPlayed
 */
export const trimRecentlyPlayed = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query('profiles').paginate({ numItems: 100, cursor: args.cursor ?? null });
    for (const row of page.page) {
      if (row.recentlyPlayed.length > RECENTLY_PLAYED_LIMIT) {
        await ctx.db.patch(row._id, { recentlyPlayed: row.recentlyPlayed.slice(0, RECENTLY_PLAYED_LIMIT) });
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.profiles.trimRecentlyPlayed, { cursor: page.continueCursor });
    }
    return null;
  }
});
