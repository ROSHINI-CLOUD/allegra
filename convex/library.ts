/**
 * Library sync storage. The rules (newest change wins per item, deletes remembered,
 * revisions for catching up) live in packages/shared/library.ts; this file loads the
 * rows a batch touches, runs them, writes the result and rebuilds the profile's
 * likedSongIds/libraries copy — all in one transaction, so two devices changing the
 * library at once can never lose either change.
 *
 * `apply` and `changes` are called by the Express API only, gated on the server
 * secret like convex/profiles.ts. `myRev` is for a signed-in browser or phone to
 * notice that its library changed somewhere else.
 *
 * A listener's library moves from the profile into rows on their first change
 * (seedFromProfile). From then on `profiles.save` leaves likedSongIds/libraries alone.
 */
import { getAuthUserId } from '@convex-dev/auth/server';
import { v, type Infer } from 'convex/values';

import {
  applyLibraryOps,
  itemKey,
  pageOfChanges,
  seedFromProfile,
  toProfileLibrary,
  type LibraryOp,
  type LibraryRowsView,
  type LikeRow,
  type PlaylistItemRow,
  type PlaylistRow
} from '../packages/shared/library';
import type { SongRef, SongSnapshot } from '../packages/shared/songRef';
import type { Doc } from './_generated/dataModel';
import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import { requireSecret } from './profiles';
import { songSnapshot } from './schema';

/** Most rows read to rebuild the profile copy. Past these the copy is cut short (the rows stay complete). */
const MAX_LIKES = 5000;
const MAX_PLAYLISTS = 500;
const MAX_ITEMS = 10000;
const MAX_PAGE = 500;

const at = v.number();
const libraryOp = v.union(
  v.object({ op: v.literal('like'), ref: v.string(), song: v.optional(songSnapshot), at }),
  v.object({ op: v.literal('unlike'), ref: v.string(), at }),
  v.object({
    op: v.literal('playlist_upsert'),
    playlistId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.union(v.string(), v.null())),
    isPublic: v.optional(v.boolean()),
    cover: v.optional(v.union(v.null(), v.object({ key: v.optional(v.string()), url: v.string() }))),
    at
  }),
  v.object({ op: v.literal('playlist_delete'), playlistId: v.string(), at }),
  v.object({ op: v.literal('playlist_add'), playlistId: v.string(), ref: v.string(), song: v.optional(songSnapshot), at }),
  v.object({ op: v.literal('playlist_remove'), playlistId: v.string(), ref: v.string(), at })
);

// The validator stores refs as plain strings; the API only sends refs parseLibraryOps accepted.
const asOps = (ops: Infer<typeof libraryOp>[]): LibraryOp[] => ops as unknown as LibraryOp[];

type LikeDoc = Doc<'libraryLikes'>;
type PlaylistDoc = Doc<'libraryPlaylists'>;
type ItemDoc = Doc<'libraryItems'>;

function likeRow(doc: LikeDoc): LikeRow {
  const { _id, _creationTime, userId, ref, song, ...rest } = doc;
  return { ...rest, ref: ref as SongRef, ...(song ? { song: song as SongSnapshot } : {}) };
}

function playlistRow(doc: PlaylistDoc): PlaylistRow {
  const { _id, _creationTime, userId, ...rest } = doc;
  return rest;
}

function itemRow(doc: ItemDoc): PlaylistItemRow {
  const { _id, _creationTime, userId, ref, song, ...rest } = doc;
  return { ...rest, ref: ref as SongRef, ...(song ? { song: song as SongSnapshot } : {}) };
}

async function stateOf(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query('libraryState')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
}

async function profileOf(ctx: QueryCtx, userId: string) {
  return ctx.db
    .query('profiles')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
}

/** True once this listener's library lives in rows (profiles.save must then keep its copy). */
export async function libraryOwnsProfileCopy(ctx: QueryCtx, userId: string): Promise<boolean> {
  return (await stateOf(ctx, userId)) !== null;
}

async function rebuildProfileCopy(ctx: MutationCtx, userId: string, profileId: Doc<'profiles'>['_id']): Promise<void> {
  const [likes, playlists, items] = await Promise.all([
    ctx.db.query('libraryLikes').withIndex('by_userId_and_ref', (q) => q.eq('userId', userId)).take(MAX_LIKES),
    ctx.db.query('libraryPlaylists').withIndex('by_userId_and_playlistId', (q) => q.eq('userId', userId)).take(MAX_PLAYLISTS),
    ctx.db.query('libraryItems').withIndex('by_userId_and_playlistId_and_ref', (q) => q.eq('userId', userId)).take(MAX_ITEMS)
  ]);
  const copy = toProfileLibrary(likes.map(likeRow), playlists.map(playlistRow), items.map(itemRow));
  await ctx.db.patch(profileId, copy);
}

export const apply = mutation({
  args: { secret: v.string(), userId: v.string(), ops: v.array(libraryOp) },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const profile = await profileOf(ctx, args.userId);
    if (!profile) throw new Error('No profile');

    // First change for this listener: their profile's library becomes rows.
    let state = await stateOf(ctx, args.userId);
    let changed = false;
    if (!state) {
      const seed = seedFromProfile(profile);
      for (const row of seed.likes) await ctx.db.insert('libraryLikes', { userId: args.userId, ...row });
      for (const row of seed.playlists) await ctx.db.insert('libraryPlaylists', { userId: args.userId, ...row });
      for (const row of seed.items) await ctx.db.insert('libraryItems', { userId: args.userId, ...row });
      const stateId = await ctx.db.insert('libraryState', { userId: args.userId, rev: seed.rev });
      state = await ctx.db.get(stateId);
      if (!state) throw new Error('Library state missing');
      changed = true;
    }

    // Load exactly the rows this batch can touch.
    const ops = asOps(args.ops);
    const likeDocs = new Map<string, LikeDoc>();
    const playlistDocs = new Map<string, PlaylistDoc>();
    const itemDocs = new Map<string, ItemDoc>();
    for (const op of ops) {
      if (op.op === 'like' || op.op === 'unlike') {
        if (likeDocs.has(op.ref)) continue;
        const doc = await ctx.db
          .query('libraryLikes')
          .withIndex('by_userId_and_ref', (q) => q.eq('userId', args.userId).eq('ref', op.ref))
          .unique();
        if (doc) likeDocs.set(op.ref, doc);
        continue;
      }
      if (!playlistDocs.has(op.playlistId)) {
        const doc = await ctx.db
          .query('libraryPlaylists')
          .withIndex('by_userId_and_playlistId', (q) => q.eq('userId', args.userId).eq('playlistId', op.playlistId))
          .unique();
        if (doc) playlistDocs.set(op.playlistId, doc);
      }
      if (op.op === 'playlist_add' || op.op === 'playlist_remove') {
        const key = itemKey(op.playlistId, op.ref);
        if (itemDocs.has(key)) continue;
        const doc = await ctx.db
          .query('libraryItems')
          .withIndex('by_userId_and_playlistId_and_ref', (q) =>
            q.eq('userId', args.userId).eq('playlistId', op.playlistId).eq('ref', op.ref)
          )
          .unique();
        if (doc) itemDocs.set(key, doc);
      }
    }

    const view: LibraryRowsView = {
      like: (ref) => {
        const doc = likeDocs.get(ref);
        return doc ? likeRow(doc) : undefined;
      },
      playlist: (id) => {
        const doc = playlistDocs.get(id);
        return doc ? playlistRow(doc) : undefined;
      },
      item: (id, ref) => {
        const doc = itemDocs.get(itemKey(id, ref));
        return doc ? itemRow(doc) : undefined;
      }
    };
    const write = applyLibraryOps(view, ops, { now: Date.now(), rev: state.rev });

    for (const row of write.likes) {
      const doc = likeDocs.get(row.ref);
      if (doc) await ctx.db.replace(doc._id, { userId: args.userId, ...row });
      else await ctx.db.insert('libraryLikes', { userId: args.userId, ...row });
    }
    for (const row of write.playlists) {
      const doc = playlistDocs.get(row.playlistId);
      if (doc) await ctx.db.replace(doc._id, { userId: args.userId, ...row });
      else await ctx.db.insert('libraryPlaylists', { userId: args.userId, ...row });
    }
    for (const row of write.items) {
      const doc = itemDocs.get(itemKey(row.playlistId, row.ref));
      if (doc) await ctx.db.replace(doc._id, { userId: args.userId, ...row });
      else await ctx.db.insert('libraryItems', { userId: args.userId, ...row });
    }
    if (write.rev !== state.rev) {
      await ctx.db.patch(state._id, { rev: write.rev });
      changed = true;
    }
    if (changed) await rebuildProfileCopy(ctx, args.userId, profile._id);

    return { rev: write.rev, rejected: write.rejected, removedCoverKeys: write.removedCoverKeys };
  }
});

/** Everything after revision `since`, a page at a time. `seeded: false` means the library still lives only in the profile. */
export const changes = query({
  args: { secret: v.string(), userId: v.string(), since: v.number(), limit: v.number() },
  handler: async (ctx, args) => {
    requireSecret(args.secret);
    const state = await stateOf(ctx, args.userId);
    if (!state) return { seeded: false, rev: 0, changes: [], more: false };
    const limit = Math.max(1, Math.min(MAX_PAGE, Math.floor(args.limit)));
    const since = Math.max(0, args.since);
    const [likes, playlists, items] = await Promise.all([
      ctx.db.query('libraryLikes').withIndex('by_userId_and_rev', (q) => q.eq('userId', args.userId).gt('rev', since)).take(limit),
      ctx.db.query('libraryPlaylists').withIndex('by_userId_and_rev', (q) => q.eq('userId', args.userId).gt('rev', since)).take(limit),
      ctx.db.query('libraryItems').withIndex('by_userId_and_rev', (q) => q.eq('userId', args.userId).gt('rev', since)).take(limit)
    ]);
    const page = pageOfChanges([likes.map(likeRow), playlists.map(playlistRow), items.map(itemRow)], limit, state.rev);
    return { seeded: true, rev: page.next, changes: page.changes, more: page.more };
  }
});

/**
 * The signed-in listener's newest library revision: a subscription to this is how the
 * website and the phone notice a change made on the other one. Null when signed out.
 */
export const myRev = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return (await stateOf(ctx, userId))?.rev ?? 0;
  }
});
