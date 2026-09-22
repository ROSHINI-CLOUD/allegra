import { useCallback, useEffect, useRef, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import {
  prepareLiveKaraoke,
  type LiveKaraokeBackend,
  type LiveKaraokeStatus
} from '../lib/liveKaraoke';

export interface LiveKaraokePlayback {
  readonly swapAudioSource: (streamUrl: string) => Promise<boolean>;
  /** When true, swapAudioSource is a no-op — turn Sing off first. */
  readonly singActive?: boolean;
}

export interface LiveKaraokeController {
  readonly status: LiveKaraokeStatus;
  readonly backend: LiveKaraokeBackend | null;
  readonly active: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly monoWarning: boolean;
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
  const [monoWarning, setMonoWarning] = useState(false);

  const songIdRef = useRef<string | null>(null);
  const streamUrlRef = useRef<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const activeRef = useRef(false);
  const busyRef = useRef(false);

  const revokeBlob = useCallback((): void => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    const prevId = songIdRef.current;
    songIdRef.current = song?.id ?? null;
    streamUrlRef.current = song?.streamUrl ?? null;
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;

    // New track: drop karaoke state. Player loads the new streamUrl itself —
    // only revoke after clearing active so we do not yank a still-attached src
    // on the same tick as an in-flight prepare for the old id.
    const hadBlob = Boolean(blobUrlRef.current);
    setStatus('idle');
    setBackend(null);
    setActive(false);
    activeRef.current = false;
    setBusy(false);
    busyRef.current = false;
    setError(null);
    setMonoWarning(false);
    if (hadBlob && prevId !== song?.id) {
      // Defer revoke one frame so swap/load of the new song can replace src first.
      const stale = blobUrlRef.current;
      blobUrlRef.current = null;
      window.setTimeout(() => {
        if (stale) URL.revokeObjectURL(stale);
      }, 0);
    }
  }, [song?.id, song?.streamUrl]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      revokeBlob();
    };
  }, [revokeBlob]);

  const toggle = useCallback(async (): Promise<void> => {
    const current = song;
    if (!current || busyRef.current) return;

    if (playback.singActive) {
      setError('Turn off Sing first, then try Karaoke.');
      setStatus('error');
      return;
    }

    if (activeRef.current) {
      busyRef.current = true;
      setBusy(true);
      setError(null);
      try {
        const ok = await playback.swapAudioSource(current.streamUrl);
        if (!ok) {
          setError('Could not restore the original track.');
          setStatus('error');
          return;
        }
        revokeBlob();
        activeRef.current = false;
        setActive(false);
        setStatus('idle');
        setBackend(null);
        setMonoWarning(false);
      } catch {
        setError('Could not restore the original track.');
        setStatus('error');
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
      return;
    }

    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMonoWarning(false);
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
      setMonoWarning(result.monoSource);

      const ok = await playback.swapAudioSource(result.blobUrl);

      if (generation !== generationRef.current || songIdRef.current !== current.id) {
        return;
      }

      if (!ok) {
        revokeBlob();
        setError(
          playback.singActive
            ? 'Turn off Sing first, then try Karaoke.'
            : 'Could not switch to the instrumental. Try playing the song again.'
        );
        setStatus('error');
        activeRef.current = false;
        setActive(false);
        return;
      }

      activeRef.current = true;
      setActive(true);
      setStatus('active');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (generation !== generationRef.current) return;
      const message =
        err instanceof Error ? err.message : 'Live karaoke failed.';
      setError(message);
      setStatus('error');
      activeRef.current = false;
      setActive(false);
      revokeBlob();
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }, [playback, revokeBlob, song]);

  return {
    status,
    backend,
    active,
    busy,
    error,
    monoWarning,
    toggle,
    clearError: () => setError(null)
  };
}
