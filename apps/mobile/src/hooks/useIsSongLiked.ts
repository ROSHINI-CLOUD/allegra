import { usePlaylistStore } from '../store/playlistStore';
import { useSongsStore } from '../store/songsStore';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { fromMobileId } from '@shared/songRef';
import { libraryLookup, matchKey } from '../utils/downloadState';

export interface LikeState {
  /** Show the heart filled. */
  liked: boolean;
  /** Kept for callers; liking no longer downloads, so this is always false. */
  saving: boolean;
}

/**
 * The heart's state. For a song in the library the single source of truth is
 * playlistStore.likedSongIds (so it can't drift from the toggle path). A
 * streamed song has no row of its own: it counts as liked when its copy in the
 * library is, or when it is liked online (onlineLibraryStore, synced with the account).
 */
export function useSongLikeState(song: { id: string; title: string; artist?: string } | null | undefined): LikeState {
  const id = song?.id;
  const stream = !!id && id.startsWith('stream:');
  const key = stream && song ? matchKey(song.title, song.artist) : null;

  const rowLiked = usePlaylistStore(state => (id ? state.likedSongIds.has(id) : false));
  const libraryId = useSongsStore(state => (key ? libraryLookup(state.songs).get(key)?.id : undefined));
  const libraryLiked = usePlaylistStore(state => (libraryId ? state.likedSongIds.has(libraryId) : false));
  const ref = stream && id ? fromMobileId(id) : null;
  const onlineLiked = useOnlineLibraryStore(state => (ref ? state.likedRefs.has(ref) : false));

  return { liked: rowLiked || libraryLiked || onlineLiked, saving: false };
}

/** Whether a song is liked. Pass the song, not just its id, to get streamed songs right. */
export function useIsSongLiked(songId: string | undefined, song?: { title: string; artist?: string } | null): boolean {
  return useSongLikeState(songId && song ? { id: songId, title: song.title, artist: song.artist } : songId ? { id: songId, title: '' } : null).liked;
}
