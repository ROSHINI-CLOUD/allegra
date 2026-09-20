import { createContext, useCallback, useContext, useRef, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import { addSongToLibrary, createLibrary, deleteLibrary, fetchLibraries, fetchSongsByIds, removeSongFromLibrary, uploadLibraryCover } from '../lib/api';
import type { LibraryRecord } from '../lib/api';

export interface PlaylistsApi {
  readonly playlists: readonly LibraryRecord[];
  /** Every song we have seen for a playlist, keyed by id. */
  readonly songs: ReadonlyMap<string, UnifiedSong>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly actionError: string | null;
  readonly reload: () => Promise<void>;
  readonly create: (name: string) => Promise<LibraryRecord | null>;
  readonly remove: (libraryId: string) => Promise<void>;
  /** Adds the song if it is absent from the playlist, removes it otherwise. */
  readonly toggleSong: (libraryId: string, song: UnifiedSong) => Promise<void>;
  readonly setCover: (libraryId: string, file: File, onProgress?: (ratio: number) => void) => Promise<LibraryRecord | null>;
}

export const PlaylistsContext = createContext<PlaylistsApi | null>(null);

export function usePlaylistsContext(): PlaylistsApi {
  const value = useContext(PlaylistsContext);
  if (!value) throw new Error('usePlaylistsContext needs a PlaylistsContext provider.');
  return value;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function usePlaylists(): PlaylistsApi {
  const [playlists, setPlaylists] = useState<LibraryRecord[]>([]);
  const [songs, setSongs] = useState<ReadonlyMap<string, UnifiedSong>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const playlistsRef = useRef<LibraryRecord[]>([]);
  const songsRef = useRef<ReadonlyMap<string, UnifiedSong>>(new Map());

  const commit = useCallback((next: LibraryRecord[]): void => {
    playlistsRef.current = next;
    setPlaylists(next);
  }, []);

  const remember = useCallback((incoming: readonly UnifiedSong[]): void => {
    if (incoming.length === 0) return;
    const next = new Map(songsRef.current);
    for (const song of incoming) next.set(song.id, song);
    songsRef.current = next;
    setSongs(next);
  }, []);

  const hydrate = useCallback(async (libraries: readonly LibraryRecord[]): Promise<void> => {
    const missing = [...new Set(libraries.flatMap((library) => library.songIds))].filter((id) => !songsRef.current.has(id));
    if (missing.length === 0) return;
    remember(await fetchSongsByIds(missing));
  }, [remember]);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const libraries = await fetchLibraries();
      commit(libraries);
      // A playlist is still useful while its artwork loads, so a hydrate failure is not fatal.
      await hydrate(libraries).catch(() => undefined);
    } catch (caught) {
      setError(messageOf(caught, 'Your playlists could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, [commit, hydrate]);

  const create = useCallback(async (name: string): Promise<LibraryRecord | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    setActionError(null);
    try {
      const library = await createLibrary(trimmed);
      commit([...playlistsRef.current, library]);
      return library;
    } catch (caught) {
      setActionError(messageOf(caught, 'That playlist could not be created.'));
      return null;
    }
  }, [commit]);

  const remove = useCallback(async (libraryId: string): Promise<void> => {
    const before = playlistsRef.current;
    setActionError(null);
    commit(before.filter((library) => library.id !== libraryId));
    try {
      await deleteLibrary(libraryId);
    } catch (caught) {
      commit(before);
      setActionError(messageOf(caught, 'That playlist could not be deleted.'));
    }
  }, [commit]);

  const toggleSong = useCallback(async (libraryId: string, song: UnifiedSong): Promise<void> => {
    const before = playlistsRef.current;
    const current = before.find((library) => library.id === libraryId);
    if (!current) return;
    const has = current.songIds.includes(song.id);
    setActionError(null);
    remember([song]);
    commit(before.map((library) => library.id === libraryId
      ? { ...library, songIds: has ? library.songIds.filter((id) => id !== song.id) : [...library.songIds, song.id] }
      : library));
    try {
      const saved = has ? await removeSongFromLibrary(libraryId, song.id) : await addSongToLibrary(libraryId, song.id);
      commit(playlistsRef.current.map((library) => library.id === saved.id ? saved : library));
    } catch (caught) {
      commit(playlistsRef.current.map((library) => library.id === libraryId ? current : library));
      setActionError(messageOf(caught, 'That change could not be saved.'));
    }
  }, [commit, remember]);

  const setCover = useCallback(async (libraryId: string, file: File, onProgress?: (ratio: number) => void): Promise<LibraryRecord | null> => {
    setActionError(null);
    try {
      const saved = await uploadLibraryCover(libraryId, file, onProgress);
      commit(playlistsRef.current.map((library) => (library.id === saved.id ? saved : library)));
      return saved;
    } catch (caught) {
      setActionError(messageOf(caught, 'That cover could not be saved.'));
      return null;
    }
  }, [commit]);

  return { playlists, songs, loading, error, actionError, reload, create, remove, toggleSong, setCover };
}
