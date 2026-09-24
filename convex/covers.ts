import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireSecret } from './profiles';

/**
 * Playlist cover images in Convex file storage. Only the API calls these (the shared server
 * secret gates each one, same as profiles.ts); the browser uploads the bytes straight to the
 * one-time URL and never holds the secret.
 */

/** A one-time upload URL. The browser POSTs the (already resized, WebP) image to it. */
export const generateUploadUrl = mutation({
  args: { secret: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    return await ctx.storage.generateUploadUrl();
  }
});

/** What was actually stored, so the API can check type and size before attaching it. */
export const inspect = query({
  args: { secret: v.string(), storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const file = await ctx.db.system.get('_storage', args.storageId);
    if (!file) return null;
    const url = await ctx.storage.getUrl(args.storageId);
    if (!url) return null;
    return { url, contentType: file.contentType ?? '', size: file.size };
  }
});

/** Delete a replaced or rejected cover. Missing files are fine: the goal is that it is gone. */
export const remove = mutation({
  args: { secret: v.string(), storageId: v.id('_storage') },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const file = await ctx.db.system.get('_storage', args.storageId);
    if (file) await ctx.storage.delete(args.storageId);
    return null;
  }
});
