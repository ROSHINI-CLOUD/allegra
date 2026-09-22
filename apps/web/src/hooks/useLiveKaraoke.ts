import { useCallback, useEffect, useRef, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import {
  prepareLiveKaraoke,
  type LiveKaraokeBackend,
  type LiveKaraokeStatus
} from '../lib/liveKaraoke';

export interface LiveKaraokePlayback {
  readonly swapAudioSource: (streamUrl: string) => Promise<void>;
}

export interface LiveKaraokeController {
  readonly status: LiveKaraokeStatus;
  readonly backend: LiveKaraokeBackend | null;
  readonly active: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly toggle: () => Promise<void>;
  readonly clearError: () => void;
}

/**
 * Browser live karaoke: fetch + decode + mid-side vocal remove, then swap the
 * main player to a blob URL of the instrumental. Restores the original stream on off.
 */
export function useLiveKaraoke(
  song: UnifiedSong | null,
  playback: LiveKaraokePlayback
): LiveKaraokeController {
  const [status, setStatus] = useState<LiveKaraokeStatus>('idle');
  const [backend, setBackend] = useState<LiveKaraokeBackend | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const songIdRef = useRef<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  const revokeBlob = useCallback((): void => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    songIdRef.current = song?.id ?? null;
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    revokeBlob();
    setStatus('idle');
    setBackend(null);
    setActive(false);
    setBusy(false);
    setError(null);
  }, [song?.id, revokeBlob]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      revokeBlob();
    };
  }, [revokeBlob]);

  const toggle = useCallback(async (): Promise<void> => {
    const current = song;
    if (!current || busy) return;

    if (active) {
      setBusy(true);
      setError(null);
      try {
        await playback.swapAudioSource(current.streamUrl);
        revokeBlob();
        setActive(false);
        setStatus('idle');
        setBackend(null);
      } catch {
        setError('Could not restore the original track.');
        setStatus('error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setBusy(true);
    setError(null);
    setStatus('loading');

    try {
      const result = await prepareLiveKaraoke({
        streamUrl: current.streamUrl,
        songId: current.id,
        signal: ac.signal
      });

      if (generation !== generationRef.current || songIdRef.current !== current.id) {
        URL.revokeObjectURL(result.blobUrl);
        return;
      }

      setStatus('processing');
      revokeBlob();
      blobUrlRef.current = result.blobUrl;
      setBackend(result.backend);

      await playback.swapAudioSource(result.blobUrl);

      if (generation !== generationRef.current || songIdRef.current !== current.id) return;

      setActive(true);
      setStatus('active');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (generation !== generationRef.current) return;
      const message =
        err instanceof Error ? err.message : 'Live karaoke failed.';
      setError(message);
      setStatus('error');
      setActive(false);
      revokeBlob();
    } finally {
      if (generation === generationRef.current) setBusy(false);
    }
  }, [active, busy, playback, revokeBlob, song]);

  return {
    status,
    backend,
    active,
    busy,
    error,
    toggle,
    clearError: () => setError(null)
  };
}
