import {
  ChevronDown,
  Heart,
  ListMusic,
  Mic2,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  Waves
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import { DynamicLyricsBackground } from './DynamicLyricsBackground';
import { LyricsPanel } from './LyricsPanel';
import { PlaylistMenu } from './PlaylistMenu';
import { Artwork, IconButton, TactileButton } from './ui';
import type { KaraokeController } from '../hooks/useKaraoke';
import type { Palette } from '../lib/palette';
import { tapHaptic } from '../lib/haptics';
import { creditedArtists, formatTime, clamp } from '../lib/utils';
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
  readonly isBuffering?: boolean;
  readonly playbackError: string | null;
  readonly liked: boolean;
  readonly lyrics: React.ComponentProps<typeof LyricsPanel>;
  readonly palette: Palette;
  readonly light?: boolean;
  /** @deprecated Kept for call-site compatibility; atmosphere is CSS artwork now. */
  readonly energy?: number;
  readonly suggestions?: UnifiedSong[];
  readonly karaoke?: KaraokeController;
  readonly onCollapse: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onOpenImmersive: () => void;
  readonly onToggle: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onLike: () => void;
  readonly onPlayQueueSong?: (song: UnifiedSong) => void;
  /** Song title → official album / track list. Sheet slides away first. */
  readonly onOpenAlbum?: (song: UnifiedSong) => void;
  /** Artist credit → artist page. Sheet slides away first. */
  readonly onOpenArtist?: (name: string) => void;
  readonly muted: boolean;
  readonly onMute: () => void;
}

/**
 * Listening World — shell from allegra-v2-immersive-shell:
 * left now-playing (real artwork), right Lyrics / Up Next / Related.
 * Atmosphere is a lightweight CSS cover wash (no WebGL).
 */
export function PlayerPanel({
  mode,
  song,
  queue,
  currentTime,
  duration,
  isPlaying,
  isBuffering = false,
  playbackError,
  liked,
  lyrics,
  palette,
  light = false,
  suggestions = [],
  karaoke,
  onCollapse,
  onOpenWorkspace,
  onOpenImmersive,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onLike,
  onPlayQueueSong,
  onOpenAlbum,
  onOpenArtist,
  muted,
  onMute
}: PlayerPanelProps) {
  const reduced = useReducedMotion();
  const audioProgress = duration > 0 ? currentTime / duration : 0;
  const [tab, setTab] = useState<ListeningTab>(mode === 'workspace' ? 'lyrics' : 'lyrics');
  const upNext = queue.filter((item) => item.id !== song?.id).slice(0, 8);
  const related = (suggestions.length > 0 ? suggestions : upNext).slice(0, 6);
  const artists = song ? creditedArtists(song.artist) : [];

  useEffect(() => {
    if (mode === 'workspace') setTab('lyrics');
  }, [mode]);

  useEffect(() => {
    if (!song) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCollapse();
        return;
      }
      // Space is the universal play/pause, but not while the listener is typing a
      // comment or tabbing through controls that use it themselves.
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable === true;
      if (event.code === 'Space' && !typing && target?.tagName !== 'BUTTON') {
        event.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCollapse, onToggle, song]);

  const selectTab = (next: ListeningTab): void => {
    setTab(next);
    if (next === 'lyrics') onOpenWorkspace();
    else onOpenImmersive();
  };

  // Rise from bottom on open; sink fully off-screen on close (YT Music reveal).
  const sheetTransition = reduced
    ? { duration: motionTokens.duration.instant }
    : { type: 'spring' as const, stiffness: 260, damping: 36, mass: 0.95 };

  return (
    <AnimatePresence>
      {song ? (
        <motion.div
          key="listening-world"
          className={`listening-world${mode === 'workspace' ? ' is-lyrics' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="player-title"
          aria-label="Now playing"
          style={
            {
              '--art-primary': palette.primary,
              '--art-secondary': palette.secondary
            } as CSSProperties
          }
          initial={reduced ? { opacity: 0 } : { y: '100vh' }}
          animate={reduced ? { opacity: 1 } : { y: '0vh' }}
          exit={reduced ? { opacity: 0 } : { y: '100vh' }}
          transition={sheetTransition}
        >
          <div className="listening-world__atmosphere" aria-hidden="true">
            {/* Gradient atmosphere, not a blurred cover: two composited layers instead of
                stacked filter:blur passes, so it stays smooth on a phone. */}
            <DynamicLyricsBackground artworkUrl={song.artwork} palette={palette} light={light} />
            <div className="listening-world__glow" />
          </div>

          <div
            className="listening-world__shell"
            style={
              {
                '--panel-accent': palette.primary,
                '--art-primary': palette.primary,
                '--art-secondary': palette.secondary
              } as CSSProperties
            }
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
                  aria-label="Lyrics"
                  onClick={() => selectTab('lyrics')}
                >
                  <Waves size={14} aria-hidden="true" /> Lyrics
                </button>
                <button
                  type="button"
                  className="ptab"
                  role="tab"
                  aria-selected={tab === 'queue'}
                  aria-label="Up next"
                  onClick={() => selectTab('queue')}
                >
                  <ListMusic size={14} aria-hidden="true" /> Up Next
                </button>
                <button
                  type="button"
                  className="ptab"
                  role="tab"
                  aria-selected={tab === 'related'}
                  aria-label="Related"
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
                  {/* No shared layoutId — shared morphs read as top-left; sheet rises from the bottom. */}
                  <Artwork song={song} size="large" />
                </motion.div>
                <div className="np-meta">
                  <h2 id="player-title" className="np-title">
                    {onOpenAlbum ? (
                      <button
                        type="button"
                        className="np-link np-link--title"
                        title={song.album ? `Open album ${song.album}` : `Open ${song.title}`}
                        onClick={() => onOpenAlbum(song)}
                      >
                        {song.title}
                      </button>
                    ) : (
                      song.title
                    )}
                  </h2>
                  <p className="np-artist">
                    {onOpenArtist && artists.length > 0
                      ? artists.map((name, index) => (
                          <span key={`${name}-${index}`}>
                            {index > 0 ? <span className="np-artist-sep">, </span> : null}
                            <button
                              type="button"
                              className="np-link np-link--artist"
                              title={`Open artist ${name}`}
                              onClick={() => onOpenArtist(name)}
                            >
                              {name}
                            </button>
                          </span>
                        ))
                      : song.artist}
                  </p>
                </div>
                <div className="np-controls">
                  <Scrubber currentTime={currentTime} duration={duration} progress={audioProgress} onSeek={onSeek} />
                  {playbackError ? <p className="playback-error" role="alert">{playbackError}</p> : null}
                  <div className="np-btns">
                    <IconButton icon={SkipBack} label="Previous track" onClick={onPrevious} />
                    <button
                      className={`ctrl-play${isBuffering ? ' is-buffering' : ''}`}
                      onClick={onToggle}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                      aria-busy={isBuffering || undefined}
                    >
                      <PlayPauseGlyph isPlaying={isPlaying} />
                      {/* A ring around the button, not a swapped glyph: the control keeps
                          its shape and stays pressable while the track loads. */}
                      {isBuffering ? <span className="ctrl-play-wait" aria-hidden="true" /> : null}
                    </button>
                    <IconButton icon={SkipForward} label="Next track" onClick={onNext} />
                  </div>
                  <div className="np-actions">
                    <IconButton icon={Heart} label={liked ? 'Remove from likes' : 'Add to likes'} active={liked} onClick={onLike} />
                    <PlaylistMenu song={song} />
                    <IconButton icon={muted ? VolumeX : Volume2} label={muted ? 'Unmute' : 'Mute'} active={muted} onClick={onMute} />
                  </div>
                  {karaoke?.available ? (
                    <div className="np-karaoke">
                      <TactileButton
                        variant={karaoke.mode === 'on' ? 'primary' : 'secondary'}
                        icon={Mic2}
                        className={`np-karaoke-btn${karaoke.busy ? ' is-busy' : ''}${karaoke.mode === 'on' ? ' is-on' : ''}`}
                        disabled={karaoke.busy}
                        aria-pressed={karaoke.mode === 'on'}
                        aria-busy={karaoke.busy || undefined}
                        onClick={() => {
                          tapHaptic(10);
                          void karaoke.toggle();
                        }}
                      >
                        {karaoke.busy
                          ? 'Preparing Sing…'
                          : karaoke.mode === 'on'
                            ? 'Sing on'
                            : 'Sing'}
                      </TactileButton>
                      {karaoke.error ? (
                        <p className="np-karaoke-error" role="alert">
                          {karaoke.error}
                        </p>
                      ) : null}
                      {karaoke.busy ? (
                        <p className="np-karaoke-hint">Separating vocals and instruments…</p>
                      ) : null}
                      {karaoke.mode === 'on' && !karaoke.busy && karaoke.vocalsUrl ? (
                        <div className="np-karaoke-sliders">
                          <label className="np-karaoke-slider">
                            <span>Voice</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(karaoke.vocalsLevel * 100)}
                              aria-valuetext={`${Math.round(karaoke.vocalsLevel * 100)}%`}
                              onChange={(event) => karaoke.setVocalsLevel(Number(event.target.value) / 100)}
                            />
                            <span className="np-karaoke-pct">{Math.round(karaoke.vocalsLevel * 100)}%</span>
                          </label>
                          <label className="np-karaoke-slider">
                            <span>Instrumental</span>
                            <input
                              type="range"
                              min={0}
                              max={100}
                              value={Math.round(karaoke.instrumentalLevel * 100)}
                              aria-valuetext={`${Math.round(karaoke.instrumentalLevel * 100)}%`}
                              onChange={(event) => karaoke.setInstrumentalLevel(Number(event.target.value) / 100)}
                            />
                            <span className="np-karaoke-pct">{Math.round(karaoke.instrumentalLevel * 100)}%</span>
                          </label>
                        </div>
                      ) : null}
                      {karaoke.mode === 'on' && !karaoke.busy && !karaoke.vocalsUrl ? (
                        <p className="np-karaoke-hint">Instrumental playing — sing along with the lyrics.</p>
                      ) : null}
                    </div>
                  ) : null}
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
          </div>
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

/** "1 Minute and 19 Seconds" — what Apple Music reads out for its timers. */
function spokenTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  const minutePart = minutes > 0 ? `${minutes} ${minutes === 1 ? 'Minute' : 'Minutes'}` : '';
  const secondPart = rest > 0 || minutes === 0 ? `${rest} ${rest === 1 ? 'Second' : 'Seconds'}` : '';
  return [minutePart, secondPart].filter(Boolean).join(' and ');
}

/**
 * Playback position, built the way Apple Music's web player builds it.
 *
 * A native `<input type="range">` rather than a hand-rolled pointer dance: dragging past
 * the edge of the bar, releasing off-screen, arrow and Page keys, and screen-reader
 * semantics all come for free and all behaved badly in the custom version.
 *
 * The visual is only the track — a 7px bar whose fill edge is the playhead. The thumb is
 * an 18px transparent circle that exists purely to be grabbed, which is exactly what
 * Apple does: no knob appears, even on hover.
 *
 * The right-hand label counts down (-1:19), it does not show the track length.
 */
function Scrubber({
  duration,
  progress,
  onSeek
}: {
  readonly currentTime: number;
  readonly duration: number;
  readonly progress: number;
  readonly onSeek: (seconds: number) => void;
}) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const span = Math.max(duration, 1);
  // While dragging, the labels and fill follow the finger; the audio only moves on release
  // so a drag across a long track is one range request instead of a hundred.
  const value = clamp(dragValue ?? progress * duration, 0, span);
  const remaining = Math.max(0, duration - value);

  const commit = (): void => {
    if (dragValue === null) return;
    const next = dragValue;
    setDragValue(null);
    onSeek(next);
  };

  return (
    <div className="progress listening-progress">
      <time
        className="progress-time"
        role="timer"
        dateTime={`PT${Math.floor(value)}S`}
        aria-label={`Elapsed ${spokenTime(value)}`}
      >
        {formatTime(value)}
      </time>
      <input
        type="range"
        className={`progress-range${dragValue !== null ? ' is-dragging' : ''}`}
        min={0}
        max={span}
        step={1}
        value={value}
        disabled={duration <= 0}
        aria-label="Playback progress"
        aria-valuetext={`${spokenTime(value)} of ${spokenTime(duration)}`}
        style={{ '--progress': `${(value / span) * 100}%` } as CSSProperties}
        onChange={(event) => setDragValue(Number(event.target.value))}
        onPointerDown={() => tapHaptic()}
        onPointerUp={commit}
        onPointerCancel={() => setDragValue(null)}
        onKeyUp={commit}
        onBlur={commit}
      />
      <time
        className="progress-time"
        role="timer"
        dateTime={`PT${Math.floor(remaining)}S`}
        aria-label={`Remaining ${spokenTime(remaining)}`}
      >
        -{formatTime(remaining)}
      </time>
    </div>
  );
}


