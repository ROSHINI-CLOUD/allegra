import { useCallback, useEffect, useRef, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import { resolveApiUrl } from '../lib/api';
import { clamp } from '../lib/utils';

export interface AudioPlayerState {
  readonly currentSong: UnifiedSong | null;
  readonly queue: UnifiedSong[];
  readonly isPlaying: boolean;
  /** True only while the element is genuinely waiting on data it needs to keep playing. */
  readonly isBuffering: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly isMuted: boolean;
  readonly error: string | null;
  readonly selectSong: (song: UnifiedSong, queue?: UnifiedSong[]) => void;
  readonly togglePlayback: () => void;
  readonly requestPlayback: (playing: boolean) => Promise<void>;
  readonly stop: () => void;
  readonly seek: (seconds: number) => Promise<void>;
  readonly skipNext: () => void;
  readonly skipPrevious: () => void;
  readonly toggleMute: () => void;
  readonly audioRef: React.RefObject<HTMLAudioElement | null>;
}

export function useAudioPlayer(): AudioPlayerState {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentSongRef = useRef<UnifiedSong | null>(null);
  const queueRef = useRef<UnifiedSong[]>([]);
  const isPlayingRef = useRef(false);
  const pendingPlaybackRef = useRef(false);
  const playbackIntentRef = useRef(false);
  const playbackGenerationRef = useRef(0);
  const pendingCanPlayRef = useRef<(() => void) | null>(null);
  const autoAdvancedRef = useRef(false);
  const [currentSong, setCurrentSong] = useState<UnifiedSong | null>(null);
  const [queue, setQueue] = useState<UnifiedSong[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestPlayback = useCallback(async (playing: boolean): Promise<void> => {
    playbackIntentRef.current = playing;
    const audio = audioRef.current;
    if (!audio || !currentSongRef.current) return;
    if (!playing) {
      audio.pause();
      return;
    }
    const generation = playbackGenerationRef.current;
    try {
      await audio.play();
      if (generation !== playbackGenerationRef.current || !playbackIntentRef.current || !currentSongRef.current) {
        audio.pause();
        return;
      }
      setError(null);
    } catch {
      if (generation !== playbackGenerationRef.current || !playbackIntentRef.current) return;
      setError('Playback needs a tap to begin. Try the play button again.');
      setIsPlaying(false);
      setIsBuffering(false);
    }
  }, []);

  const selectSong = useCallback((song: UnifiedSong, nextQueue: UnifiedSong[] = []): void => {
    const audio = audioRef.current;
    if (currentSongRef.current?.id === song.id && audio) {
      pendingPlaybackRef.current = true;
      playbackIntentRef.current = true;
      void requestPlayback(true);
      return;
    }
    const source = nextQueue.length > 0 ? nextQueue : [song];
    const seen = new Set<string>();
    const next = (source.some((item) => item.id === song.id) ? source : [song, ...source]).filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
    playbackGenerationRef.current += 1;
    currentSongRef.current = song;
    queueRef.current = next;
    pendingPlaybackRef.current = true;
    playbackIntentRef.current = true;
    autoAdvancedRef.current = false;
    setCurrentSong(song);
    setQueue(next);
    setCurrentTime(0);
    setDuration(song.duration);
    setError(null);
  }, [requestPlayback]);

  const advanceToNext = useCallback((): void => {
    const song = currentSongRef.current;
    const list = queueRef.current;
    if (!song || autoAdvancedRef.current) return;
    const index = list.findIndex((item) => item.id === song.id);
    const next = index >= 0 ? list[index + 1] : undefined;
    if (!next) {
      autoAdvancedRef.current = true;
      setIsPlaying(false);
      return;
    }
    autoAdvancedRef.current = true;
    selectSong(next, list);
  }, [selectSong]);

  const skipNext = useCallback((): void => {
    const song = currentSongRef.current;
    const list = queueRef.current;
    if (!song || list.length < 2) return;
    autoAdvancedRef.current = false;
    const index = list.findIndex((item) => item.id === song.id);
    const next = list[(index + 1 + list.length) % list.length];
    if (next) selectSong(next, list);
  }, [selectSong]);

  const skipPrevious = useCallback((): void => {
    const song = currentSongRef.current;
    const audio = audioRef.current;
    const list = queueRef.current;
    if (!song || !audio) return;
    if (audio.currentTime > 4) {
      void seek(0);
      return;
    }
    const index = list.findIndex((item) => item.id === song.id);
    if (list.length < 2) return;
    const previous = list[(index - 1 + list.length) % list.length];
    if (previous) selectSong(previous, list);
  }, [selectSong]);

  const stop = useCallback((): void => {
    playbackGenerationRef.current += 1;
    playbackIntentRef.current = false;
    pendingPlaybackRef.current = false;
    autoAdvancedRef.current = true;
    currentSongRef.current = null;
    queueRef.current = [];
    isPlayingRef.current = false;

    const audio = audioRef.current;
    if (audio) {
      if (pendingCanPlayRef.current) {
        audio.removeEventListener('canplay', pendingCanPlayRef.current);
        pendingCanPlayRef.current = null;
      }
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    setCurrentSong(null);
    setQueue([]);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setIsBuffering(false);
    setError(null);
  }, []);

  const seek = useCallback(async (seconds: number): Promise<void> => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = clamp(seconds, 0, Number.isFinite(audio.duration) ? audio.duration : duration);
    const wasPlaying = !audio.paused;
    audio.pause();
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
    if (wasPlaying) await requestPlayback(true);
  }, [duration, requestPlayback]);

  const toggleMute = useCallback((): void => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setIsMuted(audio.muted);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = (): void => setCurrentTime(audio.currentTime);
    const onLoadedMetadata = (): void => {
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : currentSongRef.current?.duration ?? 0;
      setDuration(nextDuration);
    };
    const onPlay = (): void => {
      isPlayingRef.current = true;
      setIsPlaying(true);
    };
    const onPause = (): void => {
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsBuffering(false);
    };
    const onEnded = (): void => advanceToNext();
    const onError = (): void => {
      setIsBuffering(false);
      if (!currentSongRef.current) return;
      setError('This track could not be loaded. Try another song.');
      setIsPlaying(false);
    };
    // `waiting` is the only honest signal that sound has stopped for lack of data.
    const onWaiting = (): void => { if (playbackIntentRef.current) setIsBuffering(true); };
    const onPlaying = (): void => setIsBuffering(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('stalled', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('canplay', onPlaying);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('stalled', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('canplay', onPlaying);
    };
  }, [advanceToNext]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    if (pendingCanPlayRef.current) {
      audio.removeEventListener('canplay', pendingCanPlayRef.current);
      pendingCanPlayRef.current = null;
    }
    const generation = playbackGenerationRef.current;
    const songId = currentSong.id;
    let onCanPlay: (() => void) | null = null;
    audio.pause();
    audio.src = resolveApiUrl(currentSong.streamUrl);
    audio.load();
    const shouldPlay = pendingPlaybackRef.current;
    pendingPlaybackRef.current = false;
    if (shouldPlay) {
      setIsBuffering(true);
      onCanPlay = (): void => {
        if (generation !== playbackGenerationRef.current || currentSongRef.current?.id !== songId || !playbackIntentRef.current) return;
        void requestPlayback(true);
      };
      pendingCanPlayRef.current = onCanPlay;
      audio.addEventListener('canplay', onCanPlay, { once: true });
      void requestPlayback(true);
    }
    return () => {
      if (onCanPlay) audio.removeEventListener('canplay', onCanPlay);
      if (pendingCanPlayRef.current === onCanPlay) pendingCanPlayRef.current = null;
    };
  }, [currentSong, requestPlayback]);

  useEffect(() => {
    const stopOnPageExit = (): void => stop();
    window.addEventListener('pagehide', stopOnPageExit);
    window.addEventListener('beforeunload', stopOnPageExit);
    return () => {
      window.removeEventListener('pagehide', stopOnPageExit);
      window.removeEventListener('beforeunload', stopOnPageExit);
      stop();
    };
  }, [stop]);

  useEffect(() => {
    if (duration <= 0 || duration - currentTime > 0.35 || !isPlayingRef.current || autoAdvancedRef.current) return;
    advanceToNext();
  }, [advanceToNext, currentTime, duration]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, button, [contenteditable="true"]')) return;
      if (event.code === 'Space') {
        event.preventDefault();
        void requestPlayback(!isPlayingRef.current);
      }
      if (event.key === 'ArrowRight') void seek((audioRef.current?.currentTime ?? 0) + 5);
      if (event.key === 'ArrowLeft') void seek((audioRef.current?.currentTime ?? 0) - 5);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestPlayback, seek]);

  return {
    currentSong,
    queue,
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    isMuted,
    error,
    selectSong,
    togglePlayback: () => void requestPlayback(!isPlayingRef.current),
    requestPlayback,
    stop,
    seek,
    skipNext,
    skipPrevious,
    toggleMute,
    audioRef
  };
}
