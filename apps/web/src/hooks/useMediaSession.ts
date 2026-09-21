import { useEffect, useRef } from 'react';

import type { UnifiedSong } from '@shared/types';

/**
 * Publishes what is playing to the operating system: lock screen, the Windows volume flyout,
 * macOS Now Playing, Bluetooth and headset buttons, car head units, and the media keys on a
 * keyboard.
 *
 * Every control the OS offers routes back through the same handlers the in-app buttons use, so
 * playback invariant 1 still holds — the OS is just another caller of the one funnel, never a
 * second path that sets state and touches the element itself.
 *
 * The whole API is optional in the platform sense: Safari on iOS supports part of it, older
 * browsers none of it, and a page served over plain HTTP may refuse it. Every call is guarded and
 * a failure is silent, because none of this is required for the app to play music.
 */

interface MediaSessionControls {
  readonly song: UnifiedSong | null;
  readonly isPlaying: boolean;
  readonly currentTime: number;
  readonly duration: number;
  readonly requestPlayback: (playing: boolean) => Promise<void>;
  readonly seek: (seconds: number) => Promise<void>;
  readonly skipNext: () => void;
  readonly skipPrevious: () => void;
  readonly stop: () => void;
}

/** What the OS asks for when the user taps "skip back" rather than dragging a scrubber. */
const SEEK_STEP_SECONDS = 10;

/**
 * Artwork at the sizes platforms actually ask for. Chrome on Android wants 512×512 for a
 * notification and drops to 256×256 on a low-end device; the rest pick the nearest.
 *
 * The catalog serves one URL per song, so the same image is declared at each size rather than
 * pretending to offer real variants.
 */
function artworkFor(song: UnifiedSong): MediaImage[] {
  if (!song.artwork) return [];
  const { artwork } = song;
  return [96, 128, 192, 256, 384, 512].map((size) => ({
    src: artwork,
    sizes: `${size}x${size}`,
    type: 'image/jpeg'
  }));
}

export function useMediaSession({
  song,
  isPlaying,
  currentTime,
  duration,
  requestPlayback,
  seek,
  skipNext,
  skipPrevious,
  stop
}: MediaSessionControls): void {
  /*
   * Handlers are registered once and read the latest callbacks from a ref.
   * Re-registering them on every render would mean calling into the platform sixty times a second
   * while a song plays, and some platforms tear down the OS-level controls to rebuild them.
   */
  const actions = useRef({ requestPlayback, seek, skipNext, skipPrevious, stop });
  actions.current = { requestPlayback, seek, skipNext, skipPrevious, stop };

  const positionRef = useRef({ currentTime, duration });
  positionRef.current = { currentTime, duration };

  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined;
    if (!session) return undefined;

    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // An action this browser does not know about. The others still work.
      }
    };

    set('play', () => void actions.current.requestPlayback(true));
    set('pause', () => void actions.current.requestPlayback(false));
    set('previoustrack', () => actions.current.skipPrevious());
    set('nexttrack', () => actions.current.skipNext());
    set('stop', () => actions.current.stop());
    set('seekbackward', (details) => {
      const step = details.seekOffset ?? SEEK_STEP_SECONDS;
      void actions.current.seek(Math.max(0, positionRef.current.currentTime - step));
    });
    set('seekforward', (details) => {
      const step = details.seekOffset ?? SEEK_STEP_SECONDS;
      const { currentTime: at, duration: length } = positionRef.current;
      void actions.current.seek(length > 0 ? Math.min(length, at + step) : at + step);
    });
    set('seekto', (details) => {
      if (typeof details.seekTime !== 'number') return;
      void actions.current.seek(details.seekTime);
    });

    return () => {
      (['play', 'pause', 'previoustrack', 'nexttrack', 'stop', 'seekbackward', 'seekforward', 'seekto'] as const)
        .forEach((action) => set(action, null));
    };
  }, []);

  // Metadata changes with the song, not with playback, so this stays off the per-second path.
  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined;
    if (!session) return;
    if (!song) {
      session.metadata = null;
      return;
    }
    try {
      session.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist,
        ...(song.album ? { album: song.album } : {}),
        artwork: artworkFor(song)
      });
    } catch {
      // Metadata is decoration. Losing it must never interrupt playback.
    }
  }, [song]);

  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined;
    if (!session) return;
    session.playbackState = song ? (isPlaying ? 'playing' : 'paused') : 'none';
  }, [isPlaying, song]);

  useEffect(() => {
    const session = navigator.mediaSession as MediaSession | undefined;
    if (!session || typeof session.setPositionState !== 'function') return;
    try {
      /*
       * The spec requires a positive duration with the position inside it. A song that has not
       * reported its metadata yet has duration NaN, and a seek can leave position a hair past the
       * end — either one throws and, on some platforms, leaves a stale bar on the lock screen.
       */
      if (!Number.isFinite(duration) || duration <= 0) {
        session.setPositionState(undefined);
        return;
      }
      session.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(Math.max(currentTime, 0), duration)
      });
    } catch {
      // Out-of-range state. The controls still work, they just lose the progress bar.
    }
  }, [currentTime, duration]);
}
