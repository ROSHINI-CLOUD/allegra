import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { UnifiedSong } from '@shared/types';

import { useSettings } from './useSettings';
import { ensureElementGraph } from '../lib/audioGraph';
import type { KaraokeMix } from '../lib/karaokeMix';
import {
  audioBufferToStereo44k,
  fetchAndDecodeSong,
  getSeparator,
  isRoformerLikelySupported,
  LiveKaraokeStream,
  prepareMidSideKaraoke,
  type LiveKaraokeBackend,
  type LiveKaraokeStatus
} from '../lib/liveKaraoke';

export interface LiveKaraokePlayback {
  /** The layout's single <audio> element; the AI path routes it through Web Audio. */
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly swapAudioSource: (streamUrl: string) => Promise<boolean>;
}

export interface LiveKaraokeController {
  readonly status: LiveKaraokeStatus;
  readonly backend: LiveKaraokeBackend | null;
  readonly active: boolean;
  readonly busy: boolean;
  /** 0–1 while preparing; null when idle/active. */
  readonly progress: number | null;
  readonly error: string | null;
  readonly monoWarning: boolean;
  /** Set when the AI model was skipped and mid-side ran instead. */
  readonly fallbackReason: string | null;
  /** Basic (mid-side) mode because the listener chose it in Settings, not because the model failed. */
  readonly basicByChoice: boolean;
  /** Vocal / instrument levels. Saved on this device and applied live. */
  readonly mix: KaraokeMix;
  readonly setMix: (mix: KaraokeMix) => void;
  /**
   * Whether the sliders can do anything right now: only the on-device model produces two
   * real stems. Mid-side has one rendered instrumental, so there is nothing to mix.
   */
  readonly supportsMix: boolean;
  readonly toggle: () => Promise<void>;
  readonly clearError: () => void;
}

type Mode = 'off' | 'stream' | 'midside';

/* Progress split while preparing the AI path: download + decode, then the model load. */
const DECODED_AT = 0.1;
const MODEL_SPAN = 0.8;

const TOO_SLOW = 'this device separates slower than the song plays';
const BASIC_CHOSEN = 'Basic mode is selected in Settings';
/**
 * Set once the model has been measured slower than playback. The device will not get
 * faster this page session, so later presses go straight to mid-side instead of paying
 * for the model load and two chunks each time only to fall back again.
 */
let modelTooSlow = false;

/**
 * Browser live karaoke.
 *
 * Primary path: Mel-Band RoFormer in a worker separates the song chunk by chunk, starting
 * at the playhead, and the stream player plays the instrumental over the muted original.
 * The <audio> element keeps its source, so transport, seeking and lyrics are untouched,
 * and turning karaoke off and on again for the same song is instant.
 *
 * Fallback: when the model cannot load or cannot keep up with playback, a bass-preserving
 * mid-side instrumental is rendered and swapped in as the element's source.
 */
export function useLiveKaraoke(
  song: UnifiedSong | null,
  playback: LiveKaraokePlayback
): LiveKaraokeController {
  const [status, setStatus] = useState<LiveKaraokeStatus>('idle');
  const [backend, setBackend] = useState<LiveKaraokeBackend | null>(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monoWarning, setMonoWarning] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [settings, updateSettings] = useSettings();
  const mix = settings.karaokeMix;
  const mixRef = useRef(mix);
  mixRef.current = mix;
  const basicOnly = settings.karaokeMode === 'basic';

  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const songIdRef = useRef<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const streamRef = useRef<{ readonly songId: string; readonly stream: LiveKaraokeStream } | null>(null);
  /** Kept for the mid-side fallback until the stream proves it keeps up, then released. */
  const decodedRef = useRef<AudioBuffer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const modeRef = useRef<Mode>('off');
  const busyRef = useRef(false);

  const setBusyBoth = useCallback((value: boolean): void => {
    busyRef.current = value;
    setBusy(value);
  }, []);

  const setMode = useCallback((mode: Mode): void => {
    modeRef.current = mode;
    setActive(mode !== 'off');
  }, []);

  const revokeBlob = useCallback((): void => {
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
  }, []);

  const disposeStream = useCallback((): void => {
    streamRef.current?.stream.dispose();
    streamRef.current = null;
  }, []);

  const fail = useCallback(
    (message: string): void => {
      disposeStream();
      decodedRef.current = null;
      setError(message);
      setStatus('error');
      setProgress(null);
      setMode('off');
      setBackend(null);
      setBusyBoth(false);
    },
    [disposeStream, setBusyBoth, setMode]
  );

  useEffect(() => {
    const prevId = songIdRef.current;
    songIdRef.current = song?.id ?? null;
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    disposeStream();
    decodedRef.current = null;

    setStatus('idle');
    setBackend(null);
    setMode('off');
    setBusyBoth(false);
    setProgress(null);
    setError(null);
    setMonoWarning(false);
    setFallbackReason(null);
    if (blobUrlRef.current && prevId !== song?.id) {
      // The player may still be releasing it; revoke after this tick.
      const stale = blobUrlRef.current;
      blobUrlRef.current = null;
      window.setTimeout(() => URL.revokeObjectURL(stale), 0);
    }
  }, [song?.id, song?.streamUrl, disposeStream, setBusyBoth, setMode]);

  // Slider moves (here or in Settings, or in another tab) reach the stream as they happen.
  useEffect(() => {
    streamRef.current?.stream.setMix(mix);
  }, [mix]);

  const setMix = useCallback((next: KaraokeMix): void => updateSettings({ karaokeMix: next }), [updateSettings]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      streamRef.current?.stream.dispose();
      streamRef.current = null;
      revokeBlob();
    };
  }, [revokeBlob]);

  /** Render the mid-side instrumental and swap it in as the element's source. */
  const runMidSide = useCallback(
    async (current: UnifiedSong, decoded: AudioBuffer, generation: number, reason?: string): Promise<void> => {
      const signal = abortRef.current?.signal;
      const stale = (): boolean => generation !== generationRef.current || songIdRef.current !== current.id;
      disposeStream();
      decodedRef.current = null;
      setBusyBoth(true);
      setStatus('processing');
      setProgress(0.2);
      try {
        const result = await prepareMidSideKaraoke(decoded, {
          signal,
          fallbackReason: reason,
          onProgress: (ratio) => {
            if (!stale()) setProgress(0.2 + Math.max(0, Math.min(1, ratio)) * 0.75);
          }
        });
        if (stale()) {
          URL.revokeObjectURL(result.blobUrl);
          return;
        }
        revokeBlob();
        blobUrlRef.current = result.blobUrl;
        const ok = await playbackRef.current.swapAudioSource(result.blobUrl);
        if (stale()) return;
        if (!ok) {
          revokeBlob();
          fail('Could not switch to the instrumental. Try playing the song again.');
          return;
        }
        setBackend('midside');
        setMonoWarning(result.monoSource);
        setFallbackReason(result.fallbackReason ?? null);
        setMode('midside');
        setStatus('active');
        setProgress(null);
        setBusyBoth(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (stale()) return;
        revokeBlob();
        fail(err instanceof Error ? err.message : 'Live karaoke failed.');
      }
    },
    [disposeStream, fail, revokeBlob, setBusyBoth, setMode]
  );

  /** Start the AI stream. Resolves at once; readiness arrives through the stream's events. */
  const startStream = useCallback(
    (current: UnifiedSong, audio: HTMLAudioElement, decoded: AudioBuffer, generation: number): boolean => {
      const graph = ensureElementGraph(audio);
      if (!graph) return false;
      const stale = (): boolean => generation !== generationRef.current || songIdRef.current !== current.id;
      const fallBack = (reason: string): void => {
        const kept = decodedRef.current;
        if (kept) void runMidSide(current, kept, generation, reason);
        else fail(reason);
      };
      const stream = new LiveKaraokeStream(audio, graph, audioBufferToStereo44k(decoded), {
        onModelProgress: (ratio) => {
          if (stale() || !busyRef.current) return;
          setProgress(DECODED_AT + Math.max(0, Math.min(1, ratio)) * MODEL_SPAN);
          if (ratio >= 1) setStatus('processing');
        },
        onReadyAtPlayhead: () => {
          // Turned off meanwhile: a chunk that was already in flight must not turn it back on.
          if (stale() || (modeRef.current === 'off' && !busyRef.current)) return;
          setMode('stream');
          setBackend('roformer');
          setFallbackReason(null);
          setStatus('active');
          setProgress(null);
          setBusyBoth(false);
        },
        onKeepingUp: () => {
          if (!stale()) decodedRef.current = null;
        },
        onTooSlow: () => {
          modelTooSlow = true;
          if (!stale()) fallBack(TOO_SLOW);
        },
        onError: (message) => {
          if (!stale()) fallBack(message);
        }
      }, mixRef.current);
      streamRef.current = { songId: current.id, stream };
      stream.enable();
      return true;
    },
    [fail, runMidSide, setBusyBoth, setMode]
  );

  const turnOff = useCallback(
    async (current: UnifiedSong): Promise<void> => {
      if (modeRef.current === 'stream') {
        streamRef.current?.stream.disable();
        setMode('off');
        setStatus('idle');
        setError(null);
        return;
      }
      setBusyBoth(true);
      setError(null);
      setProgress(null);
      try {
        const ok = await playbackRef.current.swapAudioSource(current.streamUrl);
        if (!ok) {
          setError('Could not restore the original track.');
          setStatus('error');
          return;
        }
        revokeBlob();
        setMode('off');
        setStatus('idle');
        setBackend(null);
        setMonoWarning(false);
      } catch {
        setError('Could not restore the original track.');
        setStatus('error');
      } finally {
        setBusyBoth(false);
      }
    },
    [revokeBlob, setBusyBoth, setMode]
  );

  const toggle = useCallback(async (): Promise<void> => {
    const current = song;
    if (!current || busyRef.current) return;

    if (modeRef.current !== 'off') {
      await turnOff(current);
      return;
    }

    setError(null);

    // Same song as before: the separator kept its work, so this is instant.
    const kept = streamRef.current;
    if (kept && kept.songId === current.id && !basicOnly) {
      // Mode first: enable() reports failures synchronously and those must win.
      setMode('stream');
      setBackend('roformer');
      setStatus(kept.stream.readyAtPlayhead() ? 'active' : 'processing');
      kept.stream.enable();
      return;
    }

    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    disposeStream();

    setBusyBoth(true);
    setMonoWarning(false);
    setFallbackReason(null);
    setProgress(0);
    setStatus('loading');

    // Before the first await, so both happen inside the click gesture: the audio context
    // may only start from one, and the model download overlaps the song download.
    const audio = playback.audioRef.current;
    let useModel = false;
    if (audio && !basicOnly && !modelTooSlow && isRoformerLikelySupported() && ensureElementGraph(audio)) {
      try {
        getSeparator().warm();
        useModel = true;
      } catch {
        useModel = false;
      }
    }

    try {
      const decoded = await fetchAndDecodeSong(current.streamUrl, current.id, ac.signal);
      if (generation !== generationRef.current || songIdRef.current !== current.id) return;
      setMonoWarning(decoded.numberOfChannels < 2);
      setProgress(DECODED_AT);

      if (useModel && audio) {
        decodedRef.current = decoded;
        try {
          if (startStream(current, audio, decoded, generation)) return;
        } catch (err) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[karaoke] AI stream failed to start, using mid-side', err);
          }
        }
      }
      const reason = useModel ? 'AI model unavailable' : basicOnly ? BASIC_CHOSEN : modelTooSlow ? TOO_SLOW : undefined;
      await runMidSide(current, decoded, generation, reason);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (generation !== generationRef.current) return;
      fail(err instanceof Error ? err.message : 'Live karaoke failed.');
    }
  }, [basicOnly, disposeStream, fail, playback, runMidSide, setBusyBoth, setMode, song, startStream, turnOff]);

  return {
    status,
    backend,
    active,
    busy,
    progress,
    error,
    monoWarning,
    fallbackReason,
    basicByChoice: backend === 'midside' && fallbackReason === BASIC_CHOSEN,
    mix,
    setMix,
    supportsMix: backend === 'roformer',
    toggle,
    clearError: () => setError(null)
  };
}
