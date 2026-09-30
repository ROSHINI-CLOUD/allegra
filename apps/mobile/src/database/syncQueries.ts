/**
 * SQLite for library sync (services/sync/LibrarySync.ts). These write the phone's
 * library directly — never through the stores — so applying a change that came from
 * the account does not queue it to be sent back.
 */
import { withDbRead, withDbWrite } from './db';

/** A song that is only online (not downloaded): liked, or in a playlist. Duration in seconds; `at` in ms. */
export interface OnlineSongRow {
  readonly ref: string;
  readonly title: string;
  readonly artist?: string;
  readonly album?: string;
  readonly artwork?: string;
  readonly duration: number;
  readonly at: number;
}

interface OnlineRowDb {
  ref: string;
  title: string;
  artist: string | null;
  album: string | null;
  artwork: string | null;
  duration: number;
  at: number;
}

const fromDb = (row: OnlineRowDb): OnlineSongRow => ({
  ref: row.ref,
  title: row.title,
  ...(row.artist ? { artist: row.artist } : {}),
  ...(row.album ? { album: row.album } : {}),
  ...(row.artwork ? { artwork: row.artwork } : {}),
  duration: row.duration ?? 0,
  at: row.at,
});

// ── Online likes ────────────────────────────────────────────────────────────

export const getOnlineLikes = (): Promise<OnlineSongRow[]> =>
  withDbRead(async db =>
    (await db.getAllAsync<OnlineRowDb>(
      'SELECT ref, title, artist, album, artwork, duration, liked_at AS at FROM liked_online_songs ORDER BY liked_at DESC',
    )).map(fromDb),
  );

export const upsertOnlineLike = (row: OnlineSongRow): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync(
      `INSERT INTO liked_online_songs (ref, title, artist, album, artwork, duration, liked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ref) DO UPDATE SET title = excluded.title, artist = excluded.artist, album = excluded.album,
         artwork = excluded.artwork, duration = excluded.duration`,
      [row.ref, row.title, row.artist ?? null, row.album ?? null, row.artwork ?? null, row.duration, row.at],
    );
  });

export const removeOnlineLike = (ref: string): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('DELETE FROM liked_online_songs WHERE ref = ?', [ref]);
  });

// ── Online playlist songs ───────────────────────────────────────────────────

export const getOnlinePlaylistSongs = (playlistId: string): Promise<OnlineSongRow[]> =>
  withDbRead(async db =>
    (await db.getAllAsync<OnlineRowDb>(
      'SELECT ref, title, artist, album, artwork, duration, added_at AS at FROM playlist_online_songs WHERE playlist_id = ? ORDER BY added_at ASC',
      [playlistId],
    )).map(fromDb),
  );

export const upsertOnlinePlaylistSong = (playlistId: string, row: OnlineSongRow): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync(
      `INSERT INTO playlist_online_songs (playlist_id, ref, title, artist, album, artwork, duration, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(playlist_id, ref) DO UPDATE SET title = excluded.title, artist = excluded.artist, album = excluded.album,
         artwork = excluded.artwork, duration = excluded.duration`,
      [playlistId, row.ref, row.title, row.artist ?? null, row.album ?? null, row.artwork ?? null, row.duration, row.at],
    );
  });

export const removeOnlinePlaylistSong = (playlistId: string, ref: string): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('DELETE FROM playlist_online_songs WHERE playlist_id = ? AND ref = ?', [playlistId, ref]);
  });

// ── The phone library, as sync sees it ──────────────────────────────────────

export interface LocalSongRow {
  readonly id: string;
  readonly title: string;
  readonly artist?: string;
  readonly album?: string;
  readonly duration: number;
  readonly coverImageUri?: string;
  readonly originId?: string;
}

export const getLocalSongs = (): Promise<LocalSongRow[]> =>
  withDbRead(async db =>
    (await db.getAllAsync<{ id: string; title: string; artist: string | null; album: string | null; duration: number; cover_image_uri: string | null; origin_id: string | null }>(
      'SELECT id, title, artist, album, duration, cover_image_uri, origin_id FROM songs',
    )).map(row => ({
      id: row.id,
      title: row.title,
      ...(row.artist ? { artist: row.artist } : {}),
      ...(row.album ? { album: row.album } : {}),
      duration: row.duration ?? 0,
      ...(row.cover_image_uri ? { coverImageUri: row.cover_image_uri } : {}),
      ...(row.origin_id ? { originId: row.origin_id } : {}),
    })),
  );

/** Playlist ids and names (the default Liked songs one included), with their song rows in order. */
export const getLocalPlaylists = (): Promise<{ id: string; name: string; description?: string; isDefault: boolean; songIds: string[] }[]> =>
  withDbRead(async db => {
    const lists = await db.getAllAsync<{ id: string; name: string; description: string | null; is_default: number }>(
      'SELECT id, name, description, is_default FROM playlists ORDER BY sort_order ASC, date_created ASC',
    );
    const items = await db.getAllAsync<{ playlist_id: string; song_id: string }>(
      'SELECT playlist_id, song_id FROM playlist_songs ORDER BY sort_order ASC, added_at ASC',
    );
    return lists.map(list => ({
      id: list.id,
      name: list.name,
      ...(list.description ? { description: list.description } : {}),
      isDefault: list.is_default === 1,
      songIds: items.filter(item => item.playlist_id === list.id).map(item => item.song_id),
    }));
  });

export const setOriginId = (songId: string, ref: string): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('UPDATE songs SET origin_id = ? WHERE id = ? AND origin_id IS NULL', [ref, songId]);
  });

/** Creates or renames a playlist with the account's id. Never touches the Liked songs one. */
export const upsertPlaylistRaw = (id: string, name: string, description: string | undefined, createdAt: number): Promise<void> =>
  withDbWrite(async db => {
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO playlists (id, name, description, is_default, sort_order, date_created, date_modified)
       VALUES (?, ?, ?, 0, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, date_modified = excluded.date_modified
       WHERE playlists.is_default = 0`,
      [id, name, description ?? null, new Date(createdAt).toISOString(), now],
    );
  });

export const deletePlaylistRaw = (id: string): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('DELETE FROM playlists WHERE id = ? AND is_default = 0', [id]);
  });

/** Adds a song row to a playlist at the end (or removes it). The Liked songs playlist also keeps songs.is_liked in step. */
export const setPlaylistMembership = (playlistId: string, songId: string, present: boolean): Promise<void> =>
  withDbWrite(async db => {
    const now = new Date().toISOString();
    if (present) {
      await db.runAsync(
        `INSERT OR IGNORE INTO playlist_songs (playlist_id, song_id, added_at, sort_order)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM playlist_songs WHERE playlist_id = ?))`,
        [playlistId, songId, now, playlistId],
      );
    } else {
      await db.runAsync('DELETE FROM playlist_songs WHERE playlist_id = ? AND song_id = ?', [playlistId, songId]);
    }
    const isDefault = await db.getFirstAsync<{ is_default: number }>('SELECT is_default FROM playlists WHERE id = ?', [playlistId]);
    if (isDefault?.is_default === 1) await db.runAsync('UPDATE songs SET is_liked = ? WHERE id = ?', [present ? 1 : 0, songId]);
    await db.runAsync('UPDATE playlists SET date_modified = ? WHERE id = ?', [now, playlistId]);
  });

// ── Outbox and cursor ───────────────────────────────────────────────────────

export type OutboxKind = 'op' | 'play';

export interface OutboxEntry {
  readonly id: number;
  readonly kind: OutboxKind;
  readonly body: string;
  readonly createdAt: number;
}

export const enqueueOutbox = (kind: OutboxKind, body: unknown): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('INSERT INTO sync_outbox (kind, body, created_at) VALUES (?, ?, ?)', [kind, JSON.stringify(body), Date.now()]);
  });

export const peekOutbox = (kind: OutboxKind, limit: number): Promise<OutboxEntry[]> =>
  withDbRead(async db =>
    (await db.getAllAsync<{ id: number; kind: OutboxKind; body: string; created_at: number }>(
      'SELECT id, kind, body, created_at FROM sync_outbox WHERE kind = ? ORDER BY id ASC LIMIT ?',
      [kind, limit],
    )).map(row => ({ id: row.id, kind: row.kind, body: row.body, createdAt: row.created_at })),
  );

export const removeOutbox = (ids: readonly number[]): Promise<void> =>
  withDbWrite(async db => {
    for (const id of ids) await db.runAsync('DELETE FROM sync_outbox WHERE id = ?', [id]);
  });

export const clearOutbox = (): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('DELETE FROM sync_outbox');
  });

export const getMeta = (key: string): Promise<string | null> =>
  withDbRead(async db => (await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_meta WHERE key = ?', [key]))?.value ?? null);

export const setMeta = (key: string, value: string): Promise<void> =>
  withDbWrite(async db => {
    await db.runAsync('INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  });
