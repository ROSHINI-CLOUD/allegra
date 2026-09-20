import { ChevronDown, Heart, ListMusic, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import { LyricsPanel } from './LyricsPanel';
import { PlaylistMenu } from './PlaylistMenu';
import { Turntable } from './Turntable';
import { IconButton } from './ui';
import { formatTime, clamp } from '../lib/utils';
import { motionTokens, spring } from '../motion';

interface PlayerPanelProps {
  readonly song: UnifiedSong | null;
  readonly queue: UnifiedSong[];
  readonly currentTime: number;
  readonly duration: number;
  readonly isPlaying: boolean;
  readonly playbackError: string | null;
  readonly liked: boolean;
  readonly lyrics: React.ComponentProps<typeof LyricsPanel>;
  readonly onClose: () => void;
  readonly onToggle: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onLike: () => void;
  readonly muted: boolean;
  readonly onMute: () => void;
  readonly accentColor: string;
}

export function PlayerPanel({ song, queue, currentTime, duration, isPlaying, playbackError, liked, lyrics, onClose, onToggle, onNext, onPrevious, onSeek, onLike, muted, onMute, accentColor }: PlayerPanelProps) {
  const reduced = useReducedMotion();
  const audioProgress = duration > 0 ? currentTime / duration : 0;
  const transition = reduced ? { duration: motionTokens.duration.instant } : spring.sheet;

  useEffect(() => {
    if (!song) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, song]);

  return (
    <AnimatePresence>
      {song ? (
        <motion.div className="player-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: motionTokens.duration.fast }}>
          <motion.aside
            className="player-panel"
            style={{ '--panel-accent': accentColor } as CSSProperties}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 28 }}
            transition={transition}
            data-live={isPlaying ? 'true' : undefined}
            data-state={playbackError ? 'error' : isPlaying ? 'playing' : 'paused'}
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-title"
            aria-label="Now playing"
          >
            <div className="player-topbar">
              <IconButton icon={ChevronDown} label="Close player" autoFocus onClick={onClose} />
              <span className="player-context">Now playing</span>
              <span className="queue-count"><ListMusic size={14} aria-hidden="true" /> {queue.length} in queue</span>
            </div>
            <div className="player-main">
              <div className="player-art-stage">
                <div className="player-orbit orbit-one" aria-hidden="true" />
                <div className="player-orbit orbit-two" aria-hidden="true" />
                <Turntable song={song} playing={isPlaying} layoutId={`art-${song.id}`} />
              </div>
              <div className="player-copy">
                <span className="eyebrow">{song.album ?? 'Allegra session'}</span>
                <h1 id="player-title">{song.title}</h1>
                <p>{song.artist}</p>
                <div className="player-actions">
                  <IconButton icon={Heart} label={liked ? 'Remove from likes' : 'Add to likes'} active={liked} onClick={onLike} />
                  <PlaylistMenu song={song} />
                  <IconButton icon={muted ? VolumeX : Volume2} label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={onMute} />
                </div>
              </div>
            </div>
            <Scrubber currentTime={currentTime} duration={duration} progress={audioProgress} onSeek={onSeek} />
            {playbackError ? <p className="playback-error" role="alert">{playbackError}</p> : null}
            <div className="transport">
              <IconButton icon={SkipBack} label="Previous track" onClick={onPrevious} />
              <button className="play-orb" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
                <PlayPauseGlyph isPlaying={isPlaying} />
              </button>
              <IconButton icon={SkipForward} label="Next track" onClick={onNext} />
            </div>
            <LyricsPanel {...lyrics} compact />
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PlayPauseGlyph({ isPlaying }: { readonly isPlaying: boolean }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={isPlaying ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5l11 7-11 7z'} /></svg>;
}

function Scrubber({ currentTime, duration, progress, onSeek }: { readonly currentTime: number; readonly duration: number; readonly progress: number; readonly onSeek: (seconds: number) => void }) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragValue, setDragValue] = useState<number | null>(null);
  const value = dragValue ?? progress;

  const pointToProgress = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  };

  const commit = (clientX: number): void => {
    const next = pointToProgress(clientX);
    setDragValue(null);
    onSeek(next * duration);
  };

  return (
    <div className="scrubber-wrap">
      <div
        className={`scrubber ${dragValue !== null ? 'is-dragging' : ''}`}
        ref={trackRef}
        role="slider"
        aria-label="Track position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round((dragValue ?? progress) * duration)}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragValue(pointToProgress(event.clientX));
        }}
        onPointerMove={(event) => {
          if (dragValue !== null) setDragValue(pointToProgress(event.clientX));
        }}
        onPointerUp={(event) => commit(event.clientX)}
        onPointerCancel={() => setDragValue(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') { event.preventDefault(); onSeek(currentTime + 5); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); onSeek(currentTime - 5); }
        }}
      >
        <span className="scrubber-track" />
        <span className="scrubber-fill" style={{ transform: `scaleX(${value})` }} />
        <span className="scrubber-thumb" style={{ left: `${value * 100}%` }} />
      </div>
      <div className="time-row"><span>{formatTime((dragValue ?? progress) * duration)}</span><span>{formatTime(duration)}</span></div>
    </div>
  );
}
