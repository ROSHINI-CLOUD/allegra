/**
 * Library sync: likes and playlists shared by Allegra web and LuvLyrics.
 *
 * Every change is a small operation ("like this", "remove that from a playlist")
 * stamped with the time the listener made it. The rules, applied the same way by
 * Convex, the API's in-memory store and anything that replays them:
 *
 * - Per item, the newest change wins. An older change arriving late (a phone that
 *   was offline) never overwrites a newer one.
 * - A delete is remembered (a row with `liked: false` / `deleted: true`), so a
 *   stale "add" cannot bring the item back.
 * - A time from the future is clamped to now, so a phone with a fast clock cannot
 *   win every conflict forever.
 * - Every row a change touches gets the next revision number; a device asks for
 *   "everything after revision N" to catch up.
 *
 * Pure and dependency-free: the phone bundles this through Metro (see tests/infra).
 */
import { parseSongRef, type SongRef, type SongSnapshot } from './songRef';

/** Most operations one request may carry. */
export const LIBRARY_OPS_MAX = 100;
export const PLAYLIST_NAME_MAX = 100;
export const PLAYLIST_DESCRIPTION_MAX = 500;
const PLAYLIST_ID_MAX = 100;

/**
 * A cover set by the website's upload flow (checked there); never accepted from a device.
 * No `key` means the playlist shows an image it does not own (a saved copy of someone's shared
 * playlist), so removing it never deletes the file.
 */
export interface PlaylistCover {
  readonly key?: string;
  readonly url: string;
}

export type LibraryOp =
  | { readonly op: 'like'; readonly ref: SongRef; readonly song?: SongSnapshot; readonly at: number }
  | { readonly op: 'unlike'; readonly ref: SongRef; readonly at: number }
  | {
      readonly op: 'playlist_upsert';
      readonly playlistId: string;
      readonly name?: string;
      /** null clears it. */
      readonly description?: string | null;
      readonly isPublic?: boolean;
      /** Server-built only (see parseLibraryOps). null removes the cover. */
      readonly cover?: PlaylistCover | null;
      readonly at: number;
    }
  | { readonly op: 'playlist_delete'; readonly playlistId: string; readonly at: number }
  | { readonly op: 'playlist_add'; readonly playlistId: string; readonly ref: SongRef; readonly song?: SongSnapshot; readonly at: number }
  | { readonly op: 'playlist_remove'; readonly playlistId: string; readonly ref: SongRef; readonly at: number };

export interface LikeRow {
  readonly ref: SongRef;
  readonly song?: SongSnapshot;
  readonly liked: boolean;
  /** When it was first liked (ms); orders Liked songs. Kept across re-likes. */
  readonly likedAt: number;
  readonly updatedAt: number;
  readonly rev: number;
}

export interface PlaylistRow {
  readonly playlistId: string;
  readonly name: string;
  readonly description?: string;
  readonly isPublic: boolean;
  readonly coverKey?: string;
  readonly coverUrl?: string;
  readonly createdAt: number;
  readonly deleted: boolean;
  readonly updatedAt: number;
  readonly rev: number;
}

export interface PlaylistItemRow {
  readonly playlistId: string;
  readonly ref: SongRef;
  readonly song?: SongSnapshot;
  /** Orders the playlist (ms). Kept while the song stays in it. */
  readonly addedAt: number;
  readonly deleted: boolean;
  readonly updatedAt: number;
  readonly rev: number;
}

/** The current rows an operation batch may touch, looked up by the caller. */
export interface LibraryRowsView {
  like(ref: SongRef): LikeRow | undefined;
  playlist(playlistId: string): PlaylistRow | undefined;
  item(playlistId: string, ref: SongRef): PlaylistItemRow | undefined;
}

export type RejectReason = 'bad_time' | 'no_playlist' | 'missing_name';

export interface LibraryWrite {
  /** Rows to insert or replace (keyed by ref / playlistId / playlistId+ref). */
  readonly likes: LikeRow[];
  readonly playlists: PlaylistRow[];
  readonly items: PlaylistItemRow[];
  /** Operations that could not apply, by index into the batch. Older-than-current is NOT a rejection. */
  readonly rejected: { readonly index: number; readonly reason: RejectReason }[];
  /** Covers no playlist uses any more; the caller deletes the stored images. */
  readonly removedCoverKeys: string[];
  /** The newest revision after this batch. */
  readonly rev: number;
}

export const itemKey = (playlistId: string, ref: SongRef): string => `${playlistId}\u0000${ref}`;

/**
 * Applies a batch in order: later operations in the batch see the effect of earlier ones.
 * `rev` is the newest revision before the batch; `now` is the server's clock.
 */
export function applyLibraryOps(view: LibraryRowsView, ops: readonly LibraryOp[], clock: { readonly now: number; readonly rev: number }): LibraryWrite {
  const likes = new Map<SongRef, LikeRow>();
  const playlists = new Map<string, PlaylistRow>();
  const items = new Map<string, PlaylistItemRow>();
  const rejected: { index: number; reason: RejectReason }[] = [];
  const removedCoverKeys: string[] = [];
  let rev = clock.rev;

  const likeOf = (ref: SongRef) => likes.get(ref) ?? view.like(ref);
  const playlistOf = (id: string) => playlists.get(id) ?? view.playlist(id);
  const itemOf = (id: string, ref: SongRef) => items.get(itemKey(id, ref)) ?? view.item(id, ref);
  const newer = (at: number, row: { updatedAt: number } | undefined) => !row || at >= row.updatedAt;

  ops.forEach((op, index) => {
    if (!Number.isFinite(op.at) || op.at < 0) {
      rejected.push({ index, reason: 'bad_time' });
      return;
    }
    const at = Math.min(op.at, clock.now);

    switch (op.op) {
      case 'like':
      case 'unlike': {
        const row = likeOf(op.ref);
        if (!newer(at, row)) return;
        const liked = op.op === 'like';
        const song = op.op === 'like' ? (op.song ?? row?.song) : row?.song;
        likes.set(op.ref, {
          ref: op.ref,
          ...(song ? { song } : {}),
          liked,
          likedAt: liked && row?.liked ? row.likedAt : at,
          updatedAt: at,
          rev: ++rev
        });
        return;
      }
      case 'playlist_upsert': {
        const row = playlistOf(op.playlistId);
        const creating = !row || row.deleted;
        if (creating && !op.name) {
          rejected.push({ index, reason: 'missing_name' });
          return;
        }
        if (!newer(at, row)) return;
        const base = creating ? undefined : row;
        const description = op.description === null ? undefined : (op.description ?? base?.description);
        let coverKey = base?.coverKey;
        let coverUrl = base?.coverUrl;
        if (op.cover !== undefined) {
          if (coverKey && coverKey !== op.cover?.key) removedCoverKeys.push(coverKey);
          coverKey = op.cover?.key;
          coverUrl = op.cover?.url;
        }
        playlists.set(op.playlistId, {
          playlistId: op.playlistId,
          name: op.name ?? base?.name ?? '',
          ...(description ? { description } : {}),
          isPublic: op.isPublic ?? base?.isPublic ?? false,
          ...(coverKey ? { coverKey } : {}),
          ...(coverUrl ? { coverUrl } : {}),
          createdAt: base?.createdAt ?? at,
          deleted: false,
          updatedAt: at,
          rev: ++rev
        });
        return;
      }
      case 'playlist_delete': {
        const row = playlistOf(op.playlistId);
        if (!row || row.deleted || !newer(at, row)) return;
        if (row.coverKey) removedCoverKeys.push(row.coverKey);
        // The cover goes with it (freed above); the rest stays, so a later recreate can be compared.
        playlists.set(op.playlistId, {
          playlistId: row.playlistId,
          name: row.name,
          ...(row.description ? { description: row.description } : {}),
          isPublic: row.isPublic,
          createdAt: row.createdAt,
          deleted: true,
          updatedAt: at,
          rev: ++rev
        });
        return;
      }
      case 'playlist_add': {
        const list = playlistOf(op.playlistId);
        if (!list || list.deleted) {
          rejected.push({ index, reason: 'no_playlist' });
          return;
        }
        const row = itemOf(op.playlistId, op.ref);
        if (!newer(at, row)) return;
        const song = op.song ?? row?.song;
        items.set(itemKey(op.playlistId, op.ref), {
          playlistId: op.playlistId,
          ref: op.ref,
          ...(song ? { song } : {}),
          addedAt: row && !row.deleted ? row.addedAt : at,
          deleted: false,
          updatedAt: at,
          rev: ++rev
        });
        return;
      }
      case 'playlist_remove': {
        const row = itemOf(op.playlistId, op.ref);
        if (!newer(at, row)) return;
        // A tombstone even when there was no row: an older "add" arriving later must not win.
        items.set(itemKey(op.playlistId, op.ref), {
          playlistId: op.playlistId,
          ref: op.ref,
          ...(row?.song ? { song: row.song } : {}),
          addedAt: row?.addedAt ?? at,
          deleted: true,
          updatedAt: at,
          rev: ++rev
        });
        return;
      }
    }
  });

  return { likes: [...likes.values()], playlists: [...playlists.values()], items: [...items.values()], rejected, removedCoverKeys, rev };
}

// ── The shape Allegra's profile already stores (read by the web, recommendations, sharing, MCP) ──

/** Structurally the API's LibraryRecord. Ids are Allegra (bare Saavn) ids. */
export interface ProfileLibrary {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly isPublic: boolean;
  readonly songIds: string[];
  readonly createdAt: string;
  readonly coverKey?: string;
  readonly coverUrl?: string;
}

function allegraId(ref: SongRef): string | null {
  const parsed = parseSongRef(ref);
  return parsed?.source === 'saavn' ? parsed.id : null;
}

/**
 * The profile's `likedSongIds` / `libraries`, rebuilt from the rows. Only Saavn songs appear
 * there, because Allegra hydrates liked and playlist songs by Saavn id; other refs live in the
 * rows and reach devices through the change feed.
 */
export function toProfileLibrary(
  likes: readonly LikeRow[],
  playlists: readonly PlaylistRow[],
  items: readonly PlaylistItemRow[]
): { likedSongIds: string[]; libraries: ProfileLibrary[] } {
  const likedSongIds = likes
    .filter((row) => row.liked)
    .sort((a, b) => a.likedAt - b.likedAt || a.rev - b.rev)
    .flatMap((row) => {
      const id = allegraId(row.ref);
      return id ? [id] : [];
    });

  const byPlaylist = new Map<string, PlaylistItemRow[]>();
  for (const item of items) {
    if (item.deleted) continue;
    const list = byPlaylist.get(item.playlistId) ?? [];
    list.push(item);
    byPlaylist.set(item.playlistId, list);
  }

  const libraries = playlists
    .filter((row) => !row.deleted)
    .sort((a, b) => a.createdAt - b.createdAt || a.rev - b.rev)
    .map((row): ProfileLibrary => ({
      id: row.playlistId,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      isPublic: row.isPublic,
      songIds: (byPlaylist.get(row.playlistId) ?? [])
        .sort((a, b) => a.addedAt - b.addedAt || a.rev - b.rev)
        .flatMap((item) => {
          const id = allegraId(item.ref);
          return id ? [id] : [];
        }),
      createdAt: new Date(row.createdAt).toISOString(),
      ...(row.coverKey ? { coverKey: row.coverKey } : {}),
      ...(row.coverUrl ? { coverUrl: row.coverUrl } : {})
    }));

  return { likedSongIds, libraries };
}

/**
 * First sync for a listener whose library lives only in their profile: rows that reproduce it.
 * `updatedAt: 0`, so any real change from any device wins over them; order is kept through
 * small likedAt/addedAt values.
 */
export function seedFromProfile(profile: { readonly likedSongIds: readonly string[]; readonly libraries: readonly ProfileLibrary[] }): {
  likes: LikeRow[];
  playlists: PlaylistRow[];
  items: PlaylistItemRow[];
  rev: number;
} {
  let rev = 0;
  const likes: LikeRow[] = [];
  profile.likedSongIds.forEach((id, index) => {
    const ref = asSaavnRef(id);
    if (ref && !likes.some((row) => row.ref === ref)) likes.push({ ref, liked: true, likedAt: index, updatedAt: 0, rev: ++rev });
  });
  const playlists: PlaylistRow[] = [];
  const items: PlaylistItemRow[] = [];
  profile.libraries.forEach((library, index) => {
    const created = Date.parse(library.createdAt);
    playlists.push({
      playlistId: library.id,
      name: library.name,
      ...(library.description ? { description: library.description } : {}),
      isPublic: library.isPublic,
      ...(library.coverKey ? { coverKey: library.coverKey } : {}),
      ...(library.coverUrl ? { coverUrl: library.coverUrl } : {}),
      createdAt: Number.isFinite(created) ? created : index,
      deleted: false,
      updatedAt: 0,
      rev: ++rev
    });
    const seen = new Set<string>();
    library.songIds.forEach((id, position) => {
      const ref = asSaavnRef(id);
      if (!ref || seen.has(ref)) return;
      seen.add(ref);
      items.push({ playlistId: library.id, ref, addedAt: position, deleted: false, updatedAt: 0, rev: ++rev });
    });
  });
  return { likes, playlists, items, rev };
}

function asSaavnRef(id: string): SongRef | null {
  const trimmed = id.trim();
  return trimmed && !trimmed.includes(':') ? `saavn:${trimmed}` : null;
}

// ── The change feed ("everything after revision N") ─────────────────────────

export type LibraryChange =
  | { readonly kind: 'like'; readonly rev: number; readonly ref: SongRef; readonly song?: SongSnapshot; readonly liked: boolean; readonly likedAt: number }
  | {
      readonly kind: 'playlist';
      readonly rev: number;
      readonly playlistId: string;
      readonly name: string;
      readonly description?: string;
      readonly isPublic: boolean;
      readonly coverUrl?: string;
      readonly deleted: boolean;
      readonly createdAt: number;
    }
  | {
      readonly kind: 'playlist_item';
      readonly rev: number;
      readonly playlistId: string;
      readonly ref: SongRef;
      readonly song?: SongSnapshot;
      readonly deleted: boolean;
      readonly addedAt: number;
    };

export function toChange(row: LikeRow | PlaylistRow | PlaylistItemRow): LibraryChange {
  if ('liked' in row) {
    return { kind: 'like', rev: row.rev, ref: row.ref, ...(row.song ? { song: row.song } : {}), liked: row.liked, likedAt: row.likedAt };
  }
  if ('name' in row) {
    return {
      kind: 'playlist',
      rev: row.rev,
      playlistId: row.playlistId,
      name: row.name,
      ...(row.description ? { description: row.description } : {}),
      isPublic: row.isPublic,
      ...(row.coverUrl ? { coverUrl: row.coverUrl } : {}),
      deleted: row.deleted,
      createdAt: row.createdAt
    };
  }
  return {
    kind: 'playlist_item',
    rev: row.rev,
    playlistId: row.playlistId,
    ref: row.ref,
    ...(row.song ? { song: row.song } : {}),
    deleted: row.deleted,
    addedAt: row.addedAt
  };
}

/**
 * Merges rows already filtered to `rev > since` (each list sorted by rev, each cut at `limit`)
 * into one page. `more` is true when a list may hold rows beyond what was read.
 */
export function pageOfChanges(
  lists: readonly (readonly (LikeRow | PlaylistRow | PlaylistItemRow)[])[],
  limit: number,
  currentRev: number
): { changes: LibraryChange[]; next: number; more: boolean } {
  const all = lists.flat().sort((a, b) => a.rev - b.rev);
  const truncated = lists.some((list) => list.length >= limit);
  // Only as far as the lowest "last row read" of any full list: past it, that list may hold rows we did not read.
  const safeUpTo = truncated
    ? Math.min(...lists.filter((list) => list.length >= limit).map((list) => list[list.length - 1]?.rev ?? Infinity))
    : Infinity;
  const page = all.filter((row) => row.rev <= safeUpTo).slice(0, limit);
  const next = page.length > 0 ? (page[page.length - 1]?.rev ?? currentRev) : currentRev;
  return { changes: page.map(toChange), next: truncated || all.length > page.length ? next : currentRev, more: truncated || all.length > page.length };
}

// ── Reading operations a device sent (untrusted) ─────────────────────────────

function parseSnapshot(value: unknown, ref: SongRef): SongSnapshot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const r = value as Record<string, unknown>;
  const title = typeof r.title === 'string' ? r.title.trim().slice(0, 300) : '';
  const artist = typeof r.artist === 'string' ? r.artist.trim().slice(0, 300) : '';
  if (!title) return undefined;
  const artwork = typeof r.artwork === 'string' && /^https:\/\//.test(r.artwork) ? r.artwork.slice(0, 1000) : '';
  const duration = typeof r.duration === 'number' && Number.isFinite(r.duration) && r.duration >= 0 ? Math.min(r.duration, 24 * 3600) : 0;
  const album = typeof r.album === 'string' && r.album.trim() ? r.album.trim().slice(0, 300) : undefined;
  return { ref, title, artist, ...(album ? { album } : {}), artwork, duration };
}

function parseRef(value: unknown): SongRef | null {
  if (typeof value !== 'string' || value.length > 220) return null;
  const parsed = parseSongRef(value);
  return parsed ? (`${parsed.source}:${parsed.id}` as SongRef) : null;
}

function parsePlaylistId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) && value.length <= PLAYLIST_ID_MAX ? value : null;
}

/**
 * Operations from a device. Null when the batch is malformed or too big (the whole request
 * is refused, so a device notices and does not drop part of its outbox). Covers are never
 * accepted here: only the website's checked upload flow sets one.
 */
export function parseLibraryOps(value: unknown): LibraryOp[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIBRARY_OPS_MAX) return null;
  const ops: LibraryOp[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : NaN;
    if (!(at >= 0)) return null;
    switch (r.op) {
      case 'like':
      case 'unlike': {
        const ref = parseRef(r.ref);
        if (!ref) return null;
        const song = r.op === 'like' ? parseSnapshot(r.song, ref) : undefined;
        ops.push(r.op === 'like' ? { op: 'like', ref, ...(song ? { song } : {}), at } : { op: 'unlike', ref, at });
        break;
      }
      case 'playlist_upsert': {
        const playlistId = parsePlaylistId(r.playlistId);
        if (!playlistId) return null;
        const name = typeof r.name === 'string' ? r.name.trim().slice(0, PLAYLIST_NAME_MAX) : undefined;
        const description =
          r.description === null ? null : typeof r.description === 'string' ? r.description.trim().slice(0, PLAYLIST_DESCRIPTION_MAX) || null : undefined;
        ops.push({
          op: 'playlist_upsert',
          playlistId,
          ...(name ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(typeof r.isPublic === 'boolean' ? { isPublic: r.isPublic } : {}),
          at
        });
        break;
      }
      case 'playlist_delete': {
        const playlistId = parsePlaylistId(r.playlistId);
        if (!playlistId) return null;
        ops.push({ op: 'playlist_delete', playlistId, at });
        break;
      }
      case 'playlist_add':
      case 'playlist_remove': {
        const playlistId = parsePlaylistId(r.playlistId);
        const ref = parseRef(r.ref);
        if (!playlistId || !ref) return null;
        const song = r.op === 'playlist_add' ? parseSnapshot(r.song, ref) : undefined;
        ops.push(r.op === 'playlist_add' ? { op: 'playlist_add', playlistId, ref, ...(song ? { song } : {}), at } : { op: 'playlist_remove', playlistId, ref, at });
        break;
      }
      default:
        return null;
    }
  }
  return ops;
}
