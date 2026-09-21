import { mutation, query } from './_generated/server';
import { v } from 'convex/values';

import { requireSecret } from './users';

export const get = query({
  args: { secret: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('shares')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique();
    if (!row) return null;
    const { _id, _creationTime, ...share } = row;
    return share;
  }
});

export const byLibrary = query({
  args: { secret: v.string(), ownerId: v.string(), libraryId: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const row = await ctx.db
      .query('shares')
      .withIndex('by_owner_library', (q) => q.eq('ownerId', args.ownerId).eq('libraryId', args.libraryId))
      .first();
    if (!row) return null;
    const { _id, _creationTime, ...share } = row;
    return share;
  }
});

export const save = mutation({
  args: { secret: v.string(), share: v.object({ code: v.string(), ownerId: v.string(), libraryId: v.string(), createdAt: v.string() }) },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query('shares')
      .withIndex('by_code', (q) => q.eq('code', args.share.code))
      .unique();
    if (existing) await ctx.db.replace(existing._id, args.share);
    else await ctx.db.insert('shares', args.share);
    return null;
  }
});

export const remove = mutation({
  args: { secret: v.string(), code: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const existing = await ctx.db
      .query('shares')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  }
});
