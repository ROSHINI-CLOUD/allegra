import { useCallback, useEffect, useRef, useState } from 'react';

import type { KaraokePayload, KaraokeStatus, UnifiedSong } from '@shared/types';

import { ApiError, fetchKaraokeStatus, requestKaraoke } from '../lib/api';
import { clamp } from '../lib/utils';

const POLL_MS = 2_500;

export type KaraokeMode = 'off' | 'on';

export interface KaraokePlayback {
  readonly enterSingMode: (stems: { vocalsUrl: string; instrumentalUrl: string }) => Promise<void>;
  readonly exitSingMode: () => Promise<void>;
  readonly setSingGains: (vocals: number, instrumental: number) => void;
  readonly swapAudioSource: (streamUrl: string) => Promise<boolean>;
}

export interface KaraokeController {
  readonly status: KaraokeStatus;
  readonly mode: KaraokeMode;
  readonly available: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly instrumentalUrl: string | null;
  readonly vocalsUrl: string | null;
  /** 0–1 local GainNode level — never hits the network. */
  readonly vocalsLevel: number;
  /** 0–1 local GainNode level — never hits the network. */
  readonly instrumentalLevel: number;
  readonly setVocalsLevel: (value: number) => void;
  readonly setInstrumentalLevel: (value: number) => void;
  readonly toggle: () => Promise<void>;
  readonly clearError: () => void;
}

/**
 * Player-facing Sing / Karaoke controller. Talks only to our API.
 * Dual-stem mixing stays in the audio player via Web Audio gains.
 */
export function useKaraoke(song: UnifiedSong | null, playback: KaraokePlayback): KaraokeController {
  const [status, setStatus] = useState<KaraokeStatus>('none');
  const [mode, setMode] = useState<KaraokeMode>('off');
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [instrumentalUrl, setInstrumentalUrl] = useState<string | null>(null);
  const [vocalsUrl, setVocalsUrl] = useState<string | null>(null);
  const [vocalsLevel, setVocalsLevelState] = useState(0.4);
  const [instrumentalLevel, setInstrumentalLevelState] = useState(1);
  const songIdRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  /** Set only when the listener tapped Sing; a resumed poll after reload must not yank them into it. */
  const wantSingRef = useRef(false);
  const vocalsLevelRef = useRef(0.4);
  const instrumentalLevelRef = useRef(1);

  const stopPolling = useCallback((): void => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyPayload = useCallback((payload: KaraokePayload): void => {
    setStatus(payload.status);
    setInstrumentalUrl(payload.instrumentalUrl ?? null);
    setVocalsUrl(payload.vocalsUrl ?? null);
    if (payload.status === 'failed') {
      setError("Couldn't prepare Sing. Try again.");
      setBusy(false);
      stopPolling();
    }
  }, [stopPolling]);

  const activateReady = useCallback(async (payload: KaraokePayload): Promise<void> => {
    if (payload.status !== 'ready' || !payload.instrumentalUrl) return;
    setBusy(false);
    setMode('on');
    if (payload.vocalsUrl) {
      await playback.enterSingMode({
        vocalsUrl: payload.vocalsUrl,
        instrumentalUrl: payload.instrumentalUrl
      });
      playback.setSingGains(vocalsLevelRef.current, instrumentalLevelRef.current);
      return;
    }
    // Legacy instrumental-only cache (pre dual-stem).
    await playback.swapAudioSource(payload.instrumentalUrl);
  }, [playback]);

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
            if (wantSingRef.current) await activateReady(payload);
            else setBusy(false);
          }
        } catch (err) {
          if (songIdRef.current !== songId) return;
          if (err instanceof ApiError && err.status === 503) {
            setAvailable(false);
            setBusy(false);
            stopPolling();
            setError('Sing is not available right now.');
          }
        }
      })();
    }, POLL_MS);
  }, [activateReady, applyPayload, stopPolling]);

  useEffect(() => {
    songIdRef.current = song?.id ?? null;
    wantSingRef.current = false;
    setStatus('none');
    setMode('off');
    setBusy(false);
    setError(null);
    setInstrumentalUrl(null);
    setVocalsUrl(null);
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

  const setVocalsLevel = useCallback((value: number): void => {
    const next = clamp(value, 0, 1);
    vocalsLevelRef.current = next;
    setVocalsLevelState(next);
    playback.setSingGains(next, instrumentalLevelRef.current);
  }, [playback]);

  const setInstrumentalLevel = useCallback((value: number): void => {
    const next = clamp(value, 0, 1);
    instrumentalLevelRef.current = next;
    setInstrumentalLevelState(next);
    playback.setSingGains(vocalsLevelRef.current, next);
  }, [playback]);

  const toggle = useCallback(async (): Promise<void> => {
    const current = song;
    if (!current || !available || busy) return;

    if (mode === 'on') {
      setMode('off');
      setError(null);
      if (vocalsUrl) await playback.exitSingMode();
      else await playback.swapAudioSource(current.streamUrl);
      return;
    }

    if (status === 'ready' && instrumentalUrl) {
      setError(null);
      await activateReady({
        status: 'ready',
        instrumentalUrl,
        ...(vocalsUrl ? { vocalsUrl } : {})
      });
      return;
    }

    wantSingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const payload = await requestKaraoke(current.id);
      if (songIdRef.current !== current.id) return;
      applyPayload(payload);
      if (payload.status === 'ready' && payload.instrumentalUrl) {
        await activateReady(payload);
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
        setError('Sing is not available right now.');
        return;
      }
      setError("Couldn't prepare Sing. Try again.");
    }
  }, [
    activateReady,
    applyPayload,
    available,
    busy,
    instrumentalUrl,
    mode,
    playback,
    song,
    startPolling,
    status,
    vocalsUrl
  ]);

  return {
    status,
    mode,
    available,
    busy,
    error,
    instrumentalUrl,
    vocalsUrl,
    vocalsLevel,
    instrumentalLevel,
    setVocalsLevel,
    setInstrumentalLevel,
    toggle,
    clearError: () => setError(null)
  };
}
