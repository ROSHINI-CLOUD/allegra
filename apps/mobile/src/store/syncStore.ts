/**
 * What library sync is doing, for the UI: whether it waits on the listener's
 * first-sign-in choice, and when it last caught up. Set only by services/sync.
 */
import { create } from 'zustand';

export interface FirstSyncQuestion {
  readonly phoneLikes: number;
  readonly phonePlaylists: number;
}

interface SyncState {
  /** Set while this phone's library waits on "merge / use account / use phone". */
  question: FirstSyncQuestion | null;
  syncing: boolean;
  lastSyncedAt: number | null;
  /** Changes waiting to be sent (offline, or not yet flushed). */
  pending: number;
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  question: null,
  syncing: false,
  lastSyncedAt: null,
  pending: 0,
  set: patch => set(patch),
}));
