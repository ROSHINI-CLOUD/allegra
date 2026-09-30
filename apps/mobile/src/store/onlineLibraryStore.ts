/**
 * Songs in the listener's library that are online only — liked or added to a
 * playlist on another device (or here) without being downloaded. A like is not a
 * download: these play by streaming. Rows live in SQLite (database/syncQueries.ts);
 * this is the in-memory copy the hearts and lists read.
 */
import { create } from 'zustand';

import { getOnlineLikes, type OnlineSongRow } from '../database/syncQueries';

interface OnlineLibraryState {
  /** Newest first. */
  likes: OnlineSongRow[];
  likedRefs: Set<string>;
  /** Bumped whenever online playlist songs change, so open playlists reload. */
  playlistVersion: number;
  load: () => Promise<void>;
  bumpPlaylists: () => void;
}

export const useOnlineLibraryStore = create<OnlineLibraryState>((set) => ({
  likes: [],
  likedRefs: new Set(),
  playlistVersion: 0,
  load: async () => {
    try {
      const likes = await getOnlineLikes();
      set({ likes, likedRefs: new Set(likes.map(row => row.ref)) });
    } catch {
      // The database opens at boot; a failed read leaves the last known list.
    }
  },
  bumpPlaylists: () => set(state => ({ playlistVersion: state.playlistVersion + 1 })),
}));
