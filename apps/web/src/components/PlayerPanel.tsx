import {
  ChevronDown,
  Heart,
  ListMusic,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  Waves
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import { MusicFlowShader } from './shader/MusicFlowShader';
import { LyricsPanel } from './LyricsPanel';
import { PlaylistMenu } from './PlaylistMenu';
import { Artwork, IconButton } from './ui';
import type { Palette } from '../lib/palette';
import { formatTime, clamp } from '../lib/utils';
import { motionTokens, spring } from '../motion';

export type ImmersivePlayerMode = 'immersive' | 'workspace';
type ListeningTab = 'lyrics' | 'queue' | 'related';

interface PlayerPanelProps {
  readonly mode: ImmersivePlayerMode;
  readonly song: UnifiedSong | null;
  readonly queue: UnifiedSong[];
  readonly currentTime: number;
  readonly duration: number;
  readonly isPlaying: boolean;
  readonly playbackError: string | null;
  readonly liked: boolean;
  readonly lyrics: React.ComponentProps<typeof LyricsPanel>;
  readonly palette: Palette;
  readonly light?: boolean;
  readonly energy?: number;
  readonly suggestions?: UnifiedSong[];
  readonly onCollapse: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onOpenImmersive: () => void;
  readonly onToggle: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onLike: () => void;
  readonly onPlayQueueSong?: (song: UnifiedSong) => void;
  readonly muted: boolean;
  readonly onMute: () => void;
}

/**
 * Listening World — shell from allegra-v2-immersive-shell:
 * left now-playing (real artwork), right Lyrics / Up Next / Related.
 * Atmosphere comes from artwork palette + WebGL, not decorative gradient fills.
 */
export function PlayerPanel({
  mode,
  song,
  queue,
  currentTime,
  duration,
  isPlaying,
  playbackError,
  liked,
  lyrics,
  palette,
  light = false,
  energy = 0,
  suggestions = [],
  onCollapse,
  onOpenWorkspace,
  onOpenImmersive,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onLike,
  onPlayQueueSong,
  muted,
  onMute
}: PlayerPanelProps) {
  const reduced = useReducedMotion();
  const audioProgress = duration > 0 ? currentTime / duration : 0;
  const transition = reduced ? { duration: motionTokens.duration.instant } : spring.sheet;
  const [tab, setTab] = useState<ListeningTab>(mode === 'workspace' ? 'lyrics' : 'lyrics');
  const upNext = queue.filter((item) => item.id !== song?.id).slice(0, 8);
  const related = (suggestions.length > 0 ? suggestions : upNext).slice(0, 6);

  useEffect(() => {
    if (mode === 'workspace') setTab('lyrics');
  }, [mode]);

  useEffect(() => {
    if (!song) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCollapse();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCollapse, song]);

  const selectTab = (next: ListeningTab): void => {
    setTab(next);
    if (next === 'lyrics') onOpenWorkspace();
    else onOpenImmersive();
  };

  return (
    <AnimatePresence>
      {song ? (
        <motion.div
          className="listening-world"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: motionTokens.duration.fast }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="player-title"
          aria-label="Now playing"
        >
          <div className="listening-world__atmosphere" aria-hidden="true">
            <MusicFlowShader energy={Math.max(0.4, energy)} palette={palette} light={light} />
            <div className="listening-world__veil" />
          </div>

          <motion.div
            className="listening-world__shell"
            style={
              {
                '--panel-accent': palette.primary,
                '--art-primary': palette.primary,
                '--art-secondary': palette.secondary
              } as CSSProperties
            }
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            transition={transition}
            data-live={isPlaying ? 'true' : undefined}
          >
            <div className="listening-top">
              <button type="button" className="listening-collapse" onClick={onCollapse}>
                <ChevronDown size={16} aria-hidden="true" />
                Back to browse
              </button>
              <div className="player-tabs" role="tablist" aria-label="Player surfaces">
                <button
                  type="button"
                  className="ptab"
                  role="tab"
                  aria-selected={tab === 'lyrics'}
                  onClick={() => selectTab('lyrics')}
                >
                  <Waves size={14} aria-hidden="true" /> Lyrics
                </button>
                <button
                  type="button"
                  className="ptab"
                  role="tab"
                  aria-selected={tab === 'queue'}
                  onClick={() => selectTab('queue')}
                >
                  <ListMusic size={14} aria-hidden="true" /> Up Next
                </button>
                <button
                  type="button"
                  className="ptab"
                  role="tab"
                  aria-selected={tab === 'related'}
                  onClick={() => selectTab('related')}
                >
                  <Sparkles size={14} aria-hidden="true" /> Related
                </button>
              </div>
              <div className="listening-top__spacer" aria-hidden="true" />
            </div>

            <div className="listening-body">
              <div className="now-playing">
                <motion.div
                  className="np-art"
                  animate={reduced ? undefined : { scale: isPlaying ? 1.015 : 1 }}
                  transition={spring.breathe}
                >
                  <Artwork song={song} size="large" layoutId={`art-${song.id}`} />
                </motion.div>
                <div className="np-meta">
                  <h2 id="player-title" className="np-title">{song.title}</h2>
                  <p className="np-artist">{song.artist}</p>
                </div>
                <div className="np-controls">
                  <Scrubber currentTime={currentTime} duration={duration} progress={audioProgress} onSeek={onSeek} />
                  {playbackError ? <p className="playback-error" role="alert">{playbackError}</p> : null}
                  <div className="np-btns">
                    <IconButton icon={SkipBack} label="Previous track" onClick={onPrevious} />
                    <button className="ctrl-play" onClick={onToggle} aria-label={isPlaying ? 'Pause' : 'Play'}>
                      <PlayPauseGlyph isPlaying={isPlaying} />
                    </button>
                    <IconButton icon={SkipForward} label="Next track" onClick={onNext} />
                  </div>
                  <div className="np-actions">
                    <IconButton icon={Heart} label={liked ? 'Remove from likes' : 'Add to likes'} active={liked} onClick={onLike} />
                    <PlaylistMenu song={song} />
                    <IconButton icon={muted ? VolumeX : Volume2} label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={onMute} />
                  </div>
                </div>
              </div>

              <div className={`player-sidepanel ${tab === 'lyrics' ? 'is-lyrics' : ''}`} role="tabpanel">
                {tab === 'lyrics' ? (
                  <>
                    <p className="panel-title">Lyrics</p>
                    <LyricsPanel
                      {...lyrics}
                      hideBackdrop
                      softFocus
                      artworkUrl={lyrics.artworkUrl ?? song.artwork}
                    />
                  </>
                ) : null}

                {tab === 'queue' ? (
                  <>
                    <p className="panel-title">Up Next</p>
                    <div className="queue-list">
                      {upNext.length > 0 ? (
                        upNext.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="q-item"
                            onClick={() => onPlayQueueSong?.(item)}
                          >
                            <Artwork song={item} size="small" />
                            <span className="q-copy">
                              <strong className="q-title">{item.title}</strong>
                              <small className="q-artist">{item.artist}</small>
                            </span>
                            <span className="q-dur">{formatTime(item.duration)}</span>
                          </button>
                        ))
                      ) : (
                        <p className="workspace-empty">Queue more tracks from Discover.</p>
                      )}
                    </div>
                  </>
                ) : null}

                {tab === 'related' ? (
                  <>
                    <p className="panel-title">Related</p>
                    <div className="related-grid">
                      {related.length > 0 ? (
                        related.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="rel-card"
                            onClick={() => onPlayQueueSong?.(item)}
                          >
                            <Artwork song={item} size="medium" />
                            <strong className="rel-title">{item.title}</strong>
                            <span className="rel-meta">{item.artist}</span>
                          </button>
                        ))
                      ) : (
                        <p className="workspace-empty">Suggestions appear as you listen.</p>
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function PlayPauseGlyph({ isPlaying }: { readonly isPlaying: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d={isPlaying ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M8 5l11 7-11 7z'} />
    </svg>
  );
}

function Scrubber({
  currentTime,
  duration,
  progress,
  onSeek
}: {
  readonly currentTime: number;
  readonly duration: number;
  readonly progress: number;
  readonly onSeek: (seconds: number) => void;
}) {
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
    <div className="progress listening-progress">
      <time>{formatTime((dragValue ?? progress) * duration)}</time>
      <div
        className={`bar ${dragValue !== null ? 'is-dragging' : ''}`}
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
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            onSeek(currentTime + 5);
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            onSeek(currentTime - 5);
          }
        }}
      >
        <span className="bar-fill" style={{ transform: `scaleX(${value})` }} />
      </div>
      <time>{formatTime(duration)}</time>
    </div>
  );
}
