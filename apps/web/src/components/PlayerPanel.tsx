import {
  ChevronDown,
  Heart,
  ListMusic,
  Mic,
  Mic2,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
  Waves
} from 'lucide-react';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import { DynamicLyricsBackground } from './DynamicLyricsBackground';
import { FluidArtBackground } from './FluidArtBackground';
import { LyricsPanel } from './LyricsPanel';
import { PlaylistMenu } from './PlaylistMenu';
import { Artwork, IconButton, TactileButton } from './ui';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import { usePress } from '../hooks/usePress';
import type { KaraokeController } from '../hooks/useKaraoke';
import type { LiveKaraokeController } from '../hooks/useLiveKaraoke';
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
  readonly liveKaraoke?: LiveKaraokeController;
  readonly onCollapse: () => void;
  readonly onOpenWorkspace: () => void;
  readonly onOpenImmersive: () => void;
  readonly onToggle: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onSeek: (seconds: number) => void;
  readonly onLike: () => void;
  readonly onPlayQueueSong?: (song: UnifiedSong) => void;
  /** Song title -> official album / track list. Sheet slides away first. */
  readonly onOpenAlbum?: (song: UnifiedSong) => void;
  /** Artist credit -> artist page. Sheet slides away first. */
  readonly onOpenArtist?: (name: string) => void;
  readonly muted: boolean;
  readonly onMute: () => void;
}

/**
 * Listening World - shell from allegra-v2-immersive-shell:
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
  liveKaraoke,
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const playPress = usePress();
  const dragControls = useDragControls();
  const isNarrowViewport = useNarrowViewport();
  // Swipe-down-to-dismiss mirrors Apple Music / YT Music on a phone; desktop has no
  // equivalent affordance, and reduced-motion listeners keep the Back button + Escape
  // as their dismiss path rather than a springy drag-to-close.
  const swipeToDismissEnabled = isNarrowViewport && !reduced;

  useEffect(() => {
    if (mode === 'workspace') setTab('lyrics');
  }, [mode]);

  // The panel is a persistent portion of the tree (App.tsx keeps `song` null while
  // closed rather than unmounting PlayerPanel), so `song` is the "currently visible"
  // signal the mini-player control opens and closes.
  useFocusTrap(Boolean(song), panelRef);

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
          ref={panelRef}
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
          drag={swipeToDismissEnabled ? 'y' : false}
          dragControls={dragControls}
          dragListener={false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.55 }}
          onDragEnd={(_event, info) => {
            if (info.offset.y > 120 || info.velocity.y > 500) onCollapse();
          }}
        >
          <div className="listening-world__atmosphere" aria-hidden="true">
            {/* Gradient atmosphere, not a blurred cover: two composited layers instead of
                stacked filter:blur passes, so it stays smooth on a phone. */}
            {song.artwork ? (
              <FluidArtBackground artworkUrl={song.artwork} />
            ) : (
              <DynamicLyricsBackground artworkUrl={song.artwork} palette={palette} light={light} />
            )}
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
            {swipeToDismissEnabled ? (
              <div
                className="listening-grabber"
                aria-hidden="true"
                onPointerDown={(event) => dragControls.start(event)}
              />
            ) : null}
            <div className="listening-top">
              <button type="button" className="listening-collapse" onClick={onCollapse} aria-label="Back to browse">
                <ChevronDown size={18} aria-hidden="true" />
                <span className="listening-collapse__label">Back to browse</span>
              </button>
              {mode === 'workspace' ? (
                <div className="mobile-lyrics-chip" aria-hidden={false}>
                  <div className="mobile-lyrics-chip__art">
                    <Artwork song={song} size="small" />
                  </div>
                  <div className="mobile-lyrics-chip__meta">
                    <span className="mobile-lyrics-chip__title">{song.title}</span>
                    <span className="mobile-lyrics-chip__artist">{song.artist}</span>
                  </div>
                </div>
              ) : null}
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
                  animate={
                    reduced
                      ? { opacity: mode === 'workspace' ? 0 : 1 }
                      : mode === 'workspace'
                        ? { opacity: 0, scale: 0.72, y: -16 }
                        : { opacity: 1, scale: isPlaying ? 1.015 : 1, y: 0 }
                  }
                  transition={reduced ? { duration: motionTokens.duration.instant } : spring.lyrics}
                >
                  {/* No shared layoutId - shared morphs read as top-left; sheet rises from the bottom. */}
                  <Artwork song={song} size="large" />
                </motion.div>
                <div className="np-meta">
                  <h2 id="player-title" className="np-title">
                    <MarqueeText text={song.title}>
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
                    </MarqueeText>
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
                      className={`ctrl-play tactile-control${isBuffering ? ' is-buffering' : ''}`}
                      onClick={onToggle}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                      aria-busy={isBuffering || undefined}
                      {...playPress}
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
                    <IconButton
                      icon={Waves}
                      label={mode === 'workspace' ? 'Show cover' : 'Show lyrics'}
                      active={mode === 'workspace'}
                      onClick={() => (mode === 'workspace' ? onOpenImmersive() : onOpenWorkspace())}
                    />
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

                  {song ? (
                    <div className="np-live-karaoke">
                      <TactileButton
                        variant={liveKaraoke?.active ? 'primary' : 'secondary'}
                        icon={Mic}
                        className={`np-live-karaoke-btn${liveKaraoke?.busy ? ' is-busy' : ''}${liveKaraoke?.active ? ' is-on' : ''}`}
                        disabled={Boolean(liveKaraoke?.busy) || karaoke?.mode === 'on'}
                        aria-pressed={liveKaraoke?.active ?? false}
                        aria-busy={liveKaraoke?.busy || undefined}
                        onClick={() => {
                          tapHaptic(10);
                          void liveKaraoke?.toggle();
                        }}
                      >
                        {liveKaraoke?.busy
                          ? 'Preparing…'
                          : liveKaraoke?.active
                            ? 'Karaoke on'
                            : 'Karaoke'}
                      </TactileButton>
                      {liveKaraoke?.error ? (
                        <p className="np-live-karaoke-error" role="alert">
                          {liveKaraoke.error}
                        </p>
                      ) : null}
                      {liveKaraoke?.monoWarning && liveKaraoke.active ? (
                        <p className="np-live-karaoke-hint">
                          This track is mono — vocal removal may be weak. Prefer stereo or Sing.
                        </p>
                      ) : !liveKaraoke?.error ? (
                        <p className="np-live-karaoke-hint">
                          Downloads the track, then strips centered vocals in your browser
                        </p>
                      ) : null}
                    </div>
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
                        <p className="np-karaoke-hint">Instrumental playing - sing along with the lyrics.</p>
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

/** "1 Minute and 19 Seconds" - what Apple Music reads out for its timers. */
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
 * The visual is only the track - a 7px bar whose fill edge is the playhead. The thumb is
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



/** Pixels per second the title drifts at: slow enough to read, fast enough to finish a lap. */
const MARQUEE_SPEED = 36;
/** Space between the end of one lap and the start of the next; keep in step with .np-marquee__track gap. */
const MARQUEE_GAP = 48;

/**
 * One-line title. When it fits it sits still; when it does not, two copies drift right to
 * left in a seamless loop (translateX only). Reduced motion falls back to an ellipsis.
 */
function MarqueeText({ text, children }: { readonly text: string; readonly children: ReactNode }) {
  const frameRef = useRef<HTMLSpanElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState<number | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const measure = measureRef.current;
    if (!frame || !measure) return undefined;
    const update = (): void => {
      const width = measure.getBoundingClientRect().width;
      setOverflow(width > frame.clientWidth + 1 ? width : null);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [text]);

  const style = overflow ? ({ '--marquee-duration': `${Math.max(8, (overflow + MARQUEE_GAP) / MARQUEE_SPEED)}s`, '--marquee-shift': `${overflow + MARQUEE_GAP}px` } as CSSProperties) : undefined;

  return (
    <span ref={frameRef} className={`np-marquee${overflow ? ' is-scrolling' : ''}`} style={style}>
      <span className="np-marquee__track">
        <span ref={measureRef} className="np-marquee__item">{children}</span>
        {overflow ? <span className="np-marquee__item" aria-hidden="true">{text}</span> : null}
      </span>
    </span>
  );
}
