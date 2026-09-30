/**
 * The library seam: likes and playlists change only through here, as operations
 * (packages/shared/library.ts, copied to src/shared by `npm run sync:shared`).
 *
 * Every writer — the web's routes, the phone's sync, the MCP tools, sharing, the
 * guest-to-account merge — goes through `apply`, so each change lands atomically and
 * the newest change per item wins wherever it came from. The profile's
 * likedSongIds/libraries remain the read model: the store rebuilds them after each batch.
 *
 * Adapters: ConvexLibraryStore (db/convexLibrary.ts) and MemoryLibraryStore (tests and
 * local development without Convex).
 */
import {
  applyLibraryOps,
  itemKey,
  pageOfChanges,
  seedFromProfile,
  toProfileLibrary,
  type LibraryChange,
  type LibraryOp,
  type LikeRow,
  type PlaylistItemRow,
  type PlaylistRow,
  type RejectReason
} from '../shared/library.js';
import type { SongRef } from '../shared/songRef.js';
import type { LibraryRecord, MemoryUserStore } from './store.js';

export interface LibraryApplyResult {
  readonly rev: number;
  readonly rejected: readonly { readonly index: number; readonly reason: RejectReason }[];
  /** Playlist covers nothing uses any more; the caller deletes the images. */
  readonly removedCoverKeys: readonly string[];
}

export interface LibraryPage {
  /** Ask for changes after this next time. */
  readonly rev: number;
  readonly changes: readonly LibraryChange[];
  readonly more: boolean;
}

export interface LibraryStore {
  /** Throws when the listener has no profile. */
  apply(userId: string, ops: readonly LibraryOp[]): Promise<LibraryApplyResult>;
  changes(userId: string, since: number, limit: number): Promise<LibraryPage>;
}

interface Rows {
  likes: Map<SongRef, LikeRow>;
  playlists: Map<string, PlaylistRow>;
  items: Map<string, PlaylistItemRow>;
  rev: number;
}

export class MemoryLibraryStore implements LibraryStore {
  private readonly rows = new Map<string, Rows>();

  public constructor(
    private readonly users: MemoryUserStore,
    private readonly now: () => number = Date.now
  ) {}

  public async apply(userId: string, ops: readonly LibraryOp[]): Promise<LibraryApplyResult> {
    const rows = await this.rowsFor(userId);
    const write = applyLibraryOps(
      {
        like: (ref) => rows.likes.get(ref),
        playlist: (id) => rows.playlists.get(id),
        item: (id, ref) => rows.items.get(itemKey(id, ref))
      },
      ops,
      { now: this.now(), rev: rows.rev }
    );
    write.likes.forEach((row) => rows.likes.set(row.ref, row));
    write.playlists.forEach((row) => rows.playlists.set(row.playlistId, row));
    write.items.forEach((row) => rows.items.set(itemKey(row.playlistId, row.ref), row));
    rows.rev = write.rev;
    const copy = toProfileLibrary([...rows.likes.values()], [...rows.playlists.values()], [...rows.items.values()]);
    this.users.writeLibraryCopy(userId, { likedSongIds: copy.likedSongIds, libraries: copy.libraries as LibraryRecord[] });
    return { rev: write.rev, rejected: write.rejected, removedCoverKeys: write.removedCoverKeys };
  }

  public async changes(userId: string, since: number, limit: number): Promise<LibraryPage> {
    const rows = await this.rowsFor(userId);
    const after = <T extends { rev: number }>(list: Iterable<T>) => [...list].filter((row) => row.rev > since).sort((a, b) => a.rev - b.rev).slice(0, limit);
    const page = pageOfChanges([after(rows.likes.values()), after(rows.playlists.values()), after(rows.items.values())], limit, rows.rev);
    return { rev: page.next, changes: page.changes, more: page.more };
  }

  /** A listener's rows, seeded from their profile the first time (as Convex does). */
  private async rowsFor(userId: string): Promise<Rows> {
    const existing = this.rows.get(userId);
    if (existing) return existing;
    const user = await this.users.get(userId);
    if (!user) throw new Error('No profile');
    const seed = seedFromProfile(user);
    const rows: Rows = {
      likes: new Map(seed.likes.map((row) => [row.ref, row])),
      playlists: new Map(seed.playlists.map((row) => [row.playlistId, row])),
      items: new Map(seed.items.map((row) => [itemKey(row.playlistId, row.ref), row])),
      rev: seed.rev
    };
    this.rows.set(userId, rows);
    this.users.ownLibrary(userId);
    return rows;
  }
}
