/**
 * Building library operations from what the API's callers do. Allegra's own routes take
 * bare catalog ids, which are Saavn ids (catalog.getSong only asks Saavn).
 */
import type { LibraryOp } from '../shared/library.js';
import { songRef, type SongRef, type SongSnapshot } from '../shared/songRef.js';
import type { UnifiedSong } from '../types.js';
import type { LibraryRecord, UserData } from './store.js';

/** The ref for an Allegra catalog id, or null for one that cannot cross devices. */
export function refForId(id: string): SongRef | null {
  return songRef('Saavn', id);
}

/** What another device needs to show this song without looking it up. */
export function snapshotOf(song: UnifiedSong): SongSnapshot | undefined {
  const ref = songRef(song.source, song.id);
  if (!ref) return undefined;
  return {
    ref,
    title: song.title,
    artist: song.artist,
    ...(song.album ? { album: song.album } : {}),
    artwork: song.artwork,
    duration: song.duration
  };
}

/** Creates a playlist exactly as `library` describes it, songs in order. */
export function opsForPlaylistCopy(library: LibraryRecord, at: number): LibraryOp[] {
  const ops: LibraryOp[] = [
    {
      op: 'playlist_upsert',
      playlistId: library.id,
      name: library.name,
      ...(library.description ? { description: library.description } : {}),
      isPublic: library.isPublic,
      ...(library.coverUrl ? { cover: { ...(library.coverKey ? { key: library.coverKey } : {}), url: library.coverUrl } } : {}),
      at
    }
  ];
  library.songIds.forEach((id, index) => {
    const ref = refForId(id);
    // One millisecond apart keeps the playlist's order (addedAt orders it).
    if (ref) ops.push({ op: 'playlist_add', playlistId: library.id, ref, at: at + index });
  });
  return ops;
}

/** A guest's likes and playlists, as operations onto the account they just signed in to. */
export function opsForGuestMerge(account: UserData, guest: UserData, at: number): LibraryOp[] {
  const ops: LibraryOp[] = [];
  for (const id of guest.likedSongIds) {
    const ref = refForId(id);
    if (ref && !account.likedSongIds.includes(id)) ops.push({ op: 'like', ref, at });
  }
  const known = new Set(account.libraries.map((library) => library.id));
  for (const library of guest.libraries) {
    if (!known.has(library.id)) ops.push(...opsForPlaylistCopy(library, at));
  }
  return ops;
}
