import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { requireSecret } from './profiles';
import { relatedSong } from './schema';

/** One shelf asks for at most this many seeds at once. */
const MAX_SONGS_PER_READ = 40;
/** Each relation keeps its strongest neighbours only. */
const MAX_RELATED = 25;

/** Stored relations for the given songs; songs never worked out yet are simply absent. */
export const getMany = query({
  args: { secret: v.string(), songIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    if (args.songIds.length > MAX_SONGS_PER_READ) throw new Error('Too many songs in one read.');
    const rows = await Promise.all(
      [...new Set(args.songIds)].map((songId) =>
        ctx.db
          .query('songRelations')
          .withIndex('by_songId', (q) => q.eq('songId', songId))
          .unique()
      )
    );
    return rows.flatMap((row) => (row ? [{ songId: row.songId, songs: row.songs, updatedAt: row.updatedAt }] : []));
  }
});

export const put = mutation({
  args: { secret: v.string(), songId: v.string(), songs: v.array(relatedSong), updatedAt: v.string() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const relation = { songId: args.songId, songs: args.songs.slice(0, MAX_RELATED), updatedAt: args.updatedAt };
    const existing = await ctx.db
      .query('songRelations')
      .withIndex('by_songId', (q) => q.eq('songId', args.songId))
      .unique();
    if (existing) await ctx.db.replace(existing._id, relation);
    else await ctx.db.insert('songRelations', relation);
    return null;
  }
});
