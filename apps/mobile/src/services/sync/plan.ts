/**
 * What library sync means for the phone, as plain functions (the engine in
 * LibrarySync.ts does the I/O around them).
 *
 * The phone keeps its library the way it always has: downloaded songs are rows in
 * `songs`, likes are membership of the Liked songs playlist, playlists hold rows.
 * A song that exists only online (liked or added on the website, not downloaded
 * here) lives in `liked_online_songs` / `playlist_online_songs` instead: liking is
 * not downloading.
 *
 * Which local row a synced song is: the row that recorded the same catalog song
 * when it was downloaded (`origin_id`), otherwise the row with the same title and
 * lead artist (`matchKey`, for songs downloaded before origins were recorded).
 * Songs with neither — local files, imports — never leave the phone.
 */
import type { LibraryChange, LibraryOp } from '@shared/library';
import { fromMobileId, matchKey, parseSongRef, type SongRef, type SongSnapshot } from '@shared/songRef';

/** The phone's Liked songs playlist (seeded in database/db.ts); likes are its membership. */
export const LIKED_PLAYLIST_ID = 'default_liked';

export interface LocalSong {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly album?: string;
  readonly duration?: number;
  readonly coverImageUri?: string;
  readonly originId?: string;
}

export interface LocalIndex {
  /** The local row for a synced song, or undefined when it is not on the phone. */
  songFor(ref: SongRef, song?: { readonly title: string; readonly artist: string }): string | undefined;
}

export function buildLocalIndex(songs: readonly LocalSong[]): LocalIndex {
  const byOrigin = new Map<string, string>();
  const byKey = new Map<string, string>();
  for (const song of songs) {
    if (song.originId) byOrigin.set(song.originId, song.id);
    const key = matchKey(song.title, song.artist);
    if (!byKey.has(key)) byKey.set(key, song.id);
  }
  return {
    songFor: (ref, song) => byOrigin.get(ref) ?? (song ? byKey.get(matchKey(song.title, song.artist)) : undefined),
  };
}

/** The catalog song a phone song is, or null for one that never leaves the phone. */
export function refForLocalSong(song: { readonly id: string; readonly originId?: string }): SongRef | null {
  if (song.originId) {
    const parsed = parseSongRef(song.originId);
    if (parsed) return `${parsed.source}:${parsed.id}`;
  }
  return fromMobileId(song.id);
}

/** What another device needs to show a phone song. Local cover files do not travel. */
export function snapshotOfLocal(song: LocalSong, ref: SongRef): SongSnapshot {
  const artwork = song.coverImageUri && /^https:\/\//.test(song.coverImageUri) ? song.coverImageUri : '';
  return {
    ref,
    title: song.title,
    artist: song.artist ?? '',
    ...(song.album ? { album: song.album } : {}),
    artwork,
    duration: Math.max(0, song.duration ?? 0),
  };
}

// ── Incoming: changes from the account, turned into what to do on the phone ──

export type LocalAction =
  /** Like or unlike a song that is on the phone (Liked songs membership). */
  | { readonly kind: 'like_local'; readonly songId: string; readonly ref: SongRef; readonly liked: boolean }
  | { readonly kind: 'online_like'; readonly ref: SongRef; readonly song?: SongSnapshot; readonly likedAt: number }
  | { readonly kind: 'online_unlike'; readonly ref: SongRef }
  | { readonly kind: 'playlist_upsert'; readonly playlistId: string; readonly name: string; readonly description?: string; readonly createdAt: number }
  | { readonly kind: 'playlist_delete'; readonly playlistId: string }
  | { readonly kind: 'playlist_local'; readonly playlistId: string; readonly songId: string; readonly ref: SongRef; readonly present: boolean; readonly addedAt: number }
  | { readonly kind: 'playlist_online'; readonly playlistId: string; readonly ref: SongRef; readonly song?: SongSnapshot; readonly present: boolean; readonly addedAt: number };

/**
 * Changes (in revision order) → phone actions. `playlistIds` are the playlists on the phone
 * now; items for a playlist that is neither there nor created in this batch are skipped.
 */
export function planInbound(changes: readonly LibraryChange[], index: LocalIndex, playlistIds: ReadonlySet<string>): LocalAction[] {
  const actions: LocalAction[] = [];
  const known = new Set(playlistIds);
  for (const change of changes) {
    switch (change.kind) {
      case 'like': {
        const songId = index.songFor(change.ref, change.song);
        if (change.liked) {
          if (songId) {
            actions.push({ kind: 'like_local', songId, ref: change.ref, liked: true });
            // On the phone, the like lives on the row; drop any online copy of it.
            actions.push({ kind: 'online_unlike', ref: change.ref });
          } else {
            actions.push({ kind: 'online_like', ref: change.ref, ...(change.song ? { song: change.song } : {}), likedAt: change.likedAt });
          }
        } else {
          if (songId) actions.push({ kind: 'like_local', songId, ref: change.ref, liked: false });
          actions.push({ kind: 'online_unlike', ref: change.ref });
        }
        break;
      }
      case 'playlist': {
        if (change.playlistId === LIKED_PLAYLIST_ID) break;
        if (change.deleted) {
          if (known.delete(change.playlistId)) actions.push({ kind: 'playlist_delete', playlistId: change.playlistId });
        } else {
          known.add(change.playlistId);
          actions.push({
            kind: 'playlist_upsert',
            playlistId: change.playlistId,
            name: change.name,
            ...(change.description ? { description: change.description } : {}),
            createdAt: change.createdAt,
          });
        }
        break;
      }
      case 'playlist_item': {
        if (!known.has(change.playlistId)) break;
        const present = !change.deleted;
        const songId = index.songFor(change.ref, change.song);
        if (songId) {
          actions.push({ kind: 'playlist_local', playlistId: change.playlistId, songId, ref: change.ref, present, addedAt: change.addedAt });
          if (present) actions.push({ kind: 'playlist_online', playlistId: change.playlistId, ref: change.ref, present: false, addedAt: change.addedAt });
        } else {
          actions.push({
            kind: 'playlist_online',
            playlistId: change.playlistId,
            ref: change.ref,
            ...(change.song ? { song: change.song } : {}),
            present,
            addedAt: change.addedAt,
          });
        }
        break;
      }
    }
  }
  return actions;
}

// ── Outgoing: what a tap on the phone becomes ────────────────────────────────

export function likeOp(ref: SongRef, liked: boolean, at: number, song?: SongSnapshot): LibraryOp {
  return liked ? { op: 'like', ref, ...(song ? { song } : {}), at } : { op: 'unlike', ref, at };
}

export function playlistUpsertOp(playlistId: string, fields: { name?: string; description?: string | null }, at: number): LibraryOp {
  return {
    op: 'playlist_upsert',
    playlistId,
    ...(fields.name ? { name: fields.name.trim().slice(0, 100) } : {}),
    ...(fields.description !== undefined ? { description: fields.description ? fields.description.trim().slice(0, 500) : null } : {}),
    at,
  };
}

export function playlistItemOp(playlistId: string, ref: SongRef, present: boolean, at: number, song?: SongSnapshot): LibraryOp {
  return present ? { op: 'playlist_add', playlistId, ref, ...(song ? { song } : {}), at } : { op: 'playlist_remove', playlistId, ref, at };
}

// ── First sign-in on a phone that already has a library ─────────────────────

export type FirstSyncChoice = 'merge' | 'account' | 'phone';

/** Everything syncable on the phone, as the account would see it. */
export interface PhoneLibrary {
  readonly likes: readonly { readonly ref: SongRef; readonly song?: SongSnapshot }[];
  readonly playlists: readonly {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly items: readonly { readonly ref: SongRef; readonly song?: SongSnapshot }[];
  }[];
}

/** Everything the account has (from the change feed since 0). */
export interface AccountLibrary {
  readonly likedRefs: ReadonlySet<SongRef>;
  readonly playlists: ReadonlyMap<string, ReadonlySet<SongRef>>;
}

/**
 * What to send for the listener's first sign-in choice:
 * - merge: everything on the phone is added (nothing is removed anywhere);
 * - account: nothing is sent; the phone adopts the account (the engine then drops phone items
 *   the account does not have — downloads are never deleted);
 * - phone: the account becomes the phone's library (its extra likes and playlists are removed).
 */
export function opsForFirstSync(choice: FirstSyncChoice, phone: PhoneLibrary, account: AccountLibrary, at: number): LibraryOp[] {
  if (choice === 'account') return [];
  const ops: LibraryOp[] = [];
  let tick = at;
  const next = () => tick++;
  for (const like of phone.likes) ops.push(likeOp(like.ref, true, next(), like.song));
  for (const list of phone.playlists) {
    ops.push(playlistUpsertOp(list.id, { name: list.name, description: list.description ?? null }, next()));
    for (const item of list.items) ops.push(playlistItemOp(list.id, item.ref, true, next(), item.song));
  }
  if (choice === 'phone') {
    const phoneLikes = new Set(phone.likes.map(like => like.ref));
    for (const ref of account.likedRefs) if (!phoneLikes.has(ref)) ops.push(likeOp(ref, false, next()));
    const phoneLists = new Map(phone.playlists.map(list => [list.id, new Set(list.items.map(item => item.ref))]));
    for (const [id, refs] of account.playlists) {
      const mine = phoneLists.get(id);
      if (!mine) {
        ops.push({ op: 'playlist_delete', playlistId: id, at: next() });
        continue;
      }
      for (const ref of refs) if (!mine.has(ref)) ops.push(playlistItemOp(id, ref, false, next()));
    }
  }
  return ops;
}
