import { useCallback, useEffect, useRef, useState } from 'react';

import type { KaraokePayload, KaraokeStatus, UnifiedSong } from '@shared/types';

import { ApiError, fetchKaraokeStatus, requestKaraoke } from '../lib/api';

const POLL_MS = 2_500;

export type KaraokeMode = 'off' | 'on';

export interface KaraokeController {
  readonly status: KaraokeStatus;
  readonly mode: KaraokeMode;
  readonly available: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly instrumentalUrl: string | null;
  readonly toggle: () => Promise<void>;
  readonly clearError: () => void;
}

/**
 * Player-facing karaoke controller. Talks only to our API; never Scarleta.
 * Swapping audio is injected so the playback invariants stay in useAudioPlayer.
 */
export function useKaraoke(
  song: UnifiedSong | null,
  swapAudioSource: (streamUrl: string) => Promise<void>
): KaraokeController {
  const [status, setStatus] = useState<KaraokeStatus>('none');
  const [mode, setMode] = useState<KaraokeMode>('off');
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instrumentalUrl, setInstrumentalUrl] = useState<string | null>(null);
  const songIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback((): void => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyPayload = useCallback((payload: KaraokePayload): void => {
    setStatus(payload.status);
    setInstrumentalUrl(payload.instrumentalUrl ?? null);
    if (payload.status === 'failed') {
      setError("Couldn't prepare Karaoke. Try again.");
      setBusy(false);
      stopPolling();
    }
  }, [stopPolling]);

  const startPolling = useCallback((songId: string): void => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const payload = await fetchKaraokeStatus(songId);
          if (songIdRef.current !== songId) return;
          applyPayload(payload);
          if (payload.status === 'ready' && payload.instrumentalUrl) {
            stopPolling();
            setBusy(false);
            setMode('on');
            await swapAudioSource(payload.instrumentalUrl);
          }
        } catch (err) {
          if (songIdRef.current !== songId) return;
          if (err instanceof ApiError && err.status === 503) {
            setAvailable(false);
            setBusy(false);
            stopPolling();
            setError('Karaoke is not available right now.');
          }
        }
      })();
    }, POLL_MS);
  }, [applyPayload, stopPolling, swapAudioSource]);

  useEffect(() => {
    songIdRef.current = song?.id ?? null;
    setStatus('none');
    setMode('off');
    setBusy(false);
    setError(null);
    setInstrumentalUrl(null);
    stopPolling();
    if (!song) return undefined;

    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchKaraokeStatus(song.id);
        if (cancelled || songIdRef.current !== song.id) return;
        setAvailable(true);
        applyPayload(payload);
        if (payload.status === 'queued' || payload.status === 'processing') {
          setBusy(true);
          startPolling(song.id);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 503) {
          setAvailable(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [song?.id, applyPayload, startPolling, stopPolling]);

  const toggle = useCallback(async (): Promise<void> => {
    const current = song;
    if (!current || !available || busy) return;

    if (mode === 'on') {
      setMode('off');
      setError(null);
      await swapAudioSource(current.streamUrl);
      return;
    }

    if (status === 'ready' && instrumentalUrl) {
      setMode('on');
      setError(null);
      await swapAudioSource(instrumentalUrl);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = await requestKaraoke(current.id);
      if (songIdRef.current !== current.id) return;
      applyPayload(payload);
      if (payload.status === 'ready' && payload.instrumentalUrl) {
        setBusy(false);
        setMode('on');
        await swapAudioSource(payload.instrumentalUrl);
        return;
      }
      if (payload.status === 'queued' || payload.status === 'processing') {
        startPolling(current.id);
        return;
      }
      setBusy(false);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 503) {
        setAvailable(false);
        setError('Karaoke is not available right now.');
        return;
      }
      setError("Couldn't prepare Karaoke. Try again.");
    }
  }, [available, applyPayload, busy, instrumentalUrl, mode, song, startPolling, status, swapAudioSource]);

  return {
    status,
    mode,
    available,
    busy,
    error,
    instrumentalUrl,
    toggle,
    clearError: () => setError(null)
  };
}
