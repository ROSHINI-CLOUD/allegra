/**
 * The stores call these after a library change made on this phone, so the change
 * reaches the account (LibrarySync.record). Fire-and-forget: a song that never leaves
 * the phone (a local file) or a phone that is not signed in simply records nothing.
 * The time is taken when the listener acted, before any lookup.
 */
import { getSongById } from '../../database/queries';
import { record, refFor } from './LibrarySync';
import { likeOp, playlistItemOp, playlistUpsertOp, snapshotOfLocal } from './plan';

const quietly = (work: Promise<void>): void => {
  work.catch(error => {
    if (__DEV__) console.warn('[LibrarySync] could not record a change', error);
  });
};

/** A song added to or removed from a playlist. On the Liked songs playlist that is a like. */
export function recordMembership(playlistId: string, songId: string, present: boolean, isLikedPlaylist: boolean): void {
  const at = Date.now();
  quietly(
    (async () => {
      const song = await getSongById(songId);
      if (!song) return;
      const ref = await refFor(song);
      if (!ref) return;
      const snapshot = present ? snapshotOfLocal(song, ref) : undefined;
      record(isLikedPlaylist ? likeOp(ref, present, at, snapshot) : playlistItemOp(playlistId, ref, present, at, snapshot));
    })(),
  );
}

export function recordPlaylistChange(playlistId: string, fields: { name?: string; description?: string | null }): void {
  record(playlistUpsertOp(playlistId, fields, Date.now()));
}

export function recordPlaylistDelete(playlistId: string): void {
  record({ op: 'playlist_delete', playlistId, at: Date.now() });
}
