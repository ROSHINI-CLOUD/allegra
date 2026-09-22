import { useCallback, useEffect, useRef, useState } from 'react';

import type { AccountProfile, TasteSummary, UnifiedSong } from '@shared/types';

import { ensureSession, fetchProfile, fetchTaste, seedTaste, sendListenSignal, startGuestSession, updateDisplayName } from '../lib/api';

export interface AccountApi {
  readonly profile: AccountProfile | null;
  readonly taste: TasteSummary | null;
  /** The first profile/taste load has finished (successfully or not). */
  readonly ready: boolean;
  readonly refresh: () => Promise<void>;
  /** Drops back to a fresh guest session. Called after Convex Auth signs the listener out. */
  readonly startGuest: () => Promise<void>;
  readonly rename: (displayName: string) => Promise<void>;
  readonly seed: (artists: readonly string[], languages: readonly string[]) => Promise<void>;
}

/**
 * The listener behind this browser: a guest until they make an account, then that account. It also owns the
 * taste profile the server learns from their behaviour, which is what makes Home theirs.
 *
 * `onSessionChange` fires after any change of who is signed in, so the rest of the app can reload likes and playlists.
 */
export function useAccount(onSessionChange: () => void): AccountApi {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [taste, setTaste] = useState<TasteSummary | null>(null);
  const [ready, setReady] = useState(false);
  const changed = useRef(onSessionChange);
  changed.current = onSessionChange;

  const refresh = useCallback(async (): Promise<void> => {
    try {
      await ensureSession();
      const [nextProfile, nextTaste] = await Promise.all([fetchProfile(), fetchTaste()]);
      setProfile(nextProfile);
      setTaste(nextTaste);
    } catch {
      // Home falls back to Browse-style content without a profile, so a failed load is not fatal.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const afterSessionChange = useCallback(async (): Promise<void> => {
    await refresh();
    changed.current();
  }, [refresh]);

  const startGuest = useCallback(async (): Promise<void> => {
    await startGuestSession();
    await afterSessionChange();
  }, [afterSessionChange]);

  const rename = useCallback(async (displayName: string): Promise<void> => {
    setProfile(await updateDisplayName(displayName));
  }, []);

  const seed = useCallback(async (artists: readonly string[], languages: readonly string[]): Promise<void> => {
    setTaste(await seedTaste(artists, languages));
    changed.current();
  }, []);

  return { profile, taste, ready, refresh, startGuest, rename, seed };
}

/**
 * Tells the server how long each song was actually listened to, once it has been left. A few seconds counts
 * against a song's artist and most of it counts for them, so the taste profile follows behaviour, not just taps.
 */
export function useListenTracker(song: UnifiedSong | null, currentTime: number, refreshTaste: () => Promise<void>): void {
  const state = useRef<{ id: string | null; seconds: number }>({ id: null, seconds: 0 });
  const id = song?.id ?? null;
  const refreshRef = useRef(refreshTaste);
  refreshRef.current = refreshTaste;

  useEffect(() => {
    const heard = state.current;
    if (heard.id !== id) {
      if (heard.id && heard.seconds >= 1) {
        void sendListenSignal(heard.id, heard.seconds).then(() => refreshRef.current()).catch(() => undefined);
      }
      state.current = { id, seconds: 0 };
      return;
    }
    heard.seconds = Math.max(heard.seconds, currentTime);
  }, [id, currentTime]);
}
