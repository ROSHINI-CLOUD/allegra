import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { TargetAndTransition } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';

import type { UnifiedSong } from '@shared/types';

import { motionTokens, spring } from '../motion';
import { titleAccent } from '../lib/utils';

/** Covers kept mounted on each side of the centre one. Past this they are invisible anyway. */
const SIDE_COUNT = 3;
/** A pointer that travelled less than this was a tap, not a swipe. */
const SWIPE_PX = 48;
/** Trackpads fire wheel events continuously; one cover per window keeps the shelf readable. */
const WHEEL_COOLDOWN_MS = 260;
/** A click this soon after a swipe is that swipe finishing, not a tap on the cover underneath. */
const SWIPE_TAIL_MS = 160;

/**
 * Where a cover sits, given how far it is from the centre.
 *
 * Spacing is a percentage of the card's own width, so the whole shelf rescales with the CSS card
 * size — phone, tablet and desktop share one set of numbers and nothing has to be measured.
 */
function poseFor(offset: number, reduced: boolean): TargetAndTransition {
  const distance = Math.abs(offset);
  if (distance === 0) return { x: '0%', z: 0, rotateY: 0, scale: 1, opacity: 1 };
  const side = Math.sign(offset);
  const spread = 52 + (distance - 1) * 30;
  const opacity = Math.max(0, 0.86 - (distance - 1) * 0.3);
  // Reduced motion keeps the shelf, drops the perspective: a flat row that fades instead of turning.
  if (reduced) return { x: `${side * spread}%`, z: 0, rotateY: 0, scale: 0.9, opacity };
  return {
    x: `${side * spread}%`,
    z: -70 * distance,
    rotateY: -side * Math.min(52, 38 + (distance - 1) * 7),
    scale: Math.max(0.68, 1 - distance * 0.09),
    opacity
  };
}

interface CoverFlowProps {
  readonly songs: readonly UnifiedSong[];
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  /** Names the shelf for assistive tech, e.g. "Late night drive covers". */
  readonly label: string;
  /** Centre cover tapped while some other song is playing. */
  readonly onPlay: (song: UnifiedSong) => void;
  /** Centre cover tapped while it is already the playing song. */
  readonly onToggle: () => void;
}

/**
 * The collection hero's cover shelf: the centred song faces you, its neighbours turn away in
 * perspective. Click a neighbour to bring it forward, click the centre to play it. Swipe, arrow
 * keys and a horizontal wheel all move the shelf, and it re-centres on whatever is playing.
 */
export function CoverFlow({ songs, currentSongId, isPlaying, label, onPlay, onToggle }: CoverFlowProps) {
  const reduced = useReducedMotion() ?? false;
  const [active, setActive] = useState(0);
  const centreRef = useRef<HTMLButtonElement | null>(null);
  const wheelAt = useRef(0);
  const focusWanted = useRef(false);
  const swipedAt = useRef(0);
  const releaseSwipe = useRef<(() => void) | null>(null);
  // Where the shelf is pointing right now. A burst of arrow presses lands three covers along even
  // though React has not re-rendered between them, and a handler can read the result immediately.
  const activeRef = useRef(0);
  const last = Math.max(songs.length - 1, 0);

  const goTo = useCallback((next: number): number => {
    const landed = Math.min(Math.max(next, 0), Math.max(songs.length - 1, 0));
    activeRef.current = landed;
    setActive(landed);
    return landed;
  }, [songs.length]);

  const step = useCallback((delta: number): number => goTo(activeRef.current + delta), [goTo]);

  // Playback leads: start a song from the list below, or let the queue advance, and the shelf follows.
  useEffect(() => {
    if (!currentSongId) return;
    const index = songs.findIndex((song) => song.id === currentSongId);
    if (index >= 0) goTo(index);
  }, [currentSongId, songs, goTo]);

  // A shorter list must not leave the shelf pointing past its end.
  useEffect(() => { goTo(activeRef.current); }, [songs.length, goTo]);

  // A shelf that unmounts mid-swipe leaves nothing listening on the window.
  useEffect(() => () => releaseSwipe.current?.(), []);

  // Roving tabindex: only the centre card is tabbable, so keyboard nav has to carry focus with it.
  useEffect(() => {
    if (!focusWanted.current) return;
    focusWanted.current = false;
    centreRef.current?.focus();
  }, [active]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight') step(1);
    else if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'Home') goTo(0);
    else if (event.key === 'End') goTo(last);
    else return;
    event.preventDefault();
    focusWanted.current = true;
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    // Vertical intent belongs to the page, not the shelf.
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const now = Date.now();
    if (now - wheelAt.current < WHEEL_COOLDOWN_MS) return;
    wheelAt.current = now;
    step(event.deltaX > 0 ? 1 : -1);
  };

  /*
   * Swipe. The release is read from the window rather than by capturing the pointer: capturing
   * re-targets pointerup at the shelf, and the browser then fires no click on the cover that was
   * pressed, which would leave every cover untappable.
   */
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // A second press before the first release resolved would otherwise orphan its listeners.
    releaseSwipe.current?.();
    const from = event.clientX;
    const finish = (up: PointerEvent): void => {
      releaseSwipe.current?.();
      if (up.type !== 'pointerup') return;
      const travelled = up.clientX - from;
      if (Math.abs(travelled) < SWIPE_PX) return;
      // The cover under the finger must not also take the release as a tap. Marking the time rather
      // than setting a flag means a swipe that draws no click cannot swallow a later real one.
      swipedAt.current = Date.now();
      step(travelled < 0 ? 1 : -1);
    };
    releaseSwipe.current = () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      releaseSwipe.current = null;
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };

  /** An arrow button about to disable itself hands focus to the centre card. */
  const nudge = (delta: number): void => {
    const landed = step(delta);
    if (landed === 0 || landed === last) focusWanted.current = true;
  };

  const centre = songs[active];
  if (!centre) return null;

  return (
    <div className="coverflow" onWheel={onWheel}>
      <div
        className="coverflow-stage"
        role="group"
        aria-label={label}
        aria-roledescription="cover shelf"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
      >
        {songs.map((song, index) => {
          const offset = index - active;
          if (Math.abs(offset) > SIDE_COUNT) return null;
          const distance = Math.abs(offset);
          const isCentre = distance === 0;
          const isCurrent = song.id === currentSongId;
          return (
            <motion.button
              key={`${song.id}-${index}`}
              ref={isCentre ? centreRef : undefined}
              type="button"
              className="coverflow-card"
              data-centre={isCentre ? 'true' : undefined}
              data-current={isCurrent ? 'true' : undefined}
              data-playing={isCurrent && isPlaying ? 'true' : undefined}
              style={{ zIndex: SIDE_COUNT + 1 - distance } as CSSProperties}
              initial={false}
              animate={poseFor(offset, reduced)}
              transition={reduced ? { duration: motionTokens.duration.instant, ease: motionTokens.ease.standard } : spring.hero}
              whileTap={reduced || !isCentre ? undefined : { scale: 0.97 }}
              tabIndex={isCentre ? 0 : -1}
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={isCentre
                ? `${isCurrent && isPlaying ? 'Pause' : 'Play'} ${song.title} by ${song.artist}`
                : `Show ${song.title} by ${song.artist}`}
              onClick={() => {
                if (Date.now() - swipedAt.current < SWIPE_TAIL_MS) return;
                if (!isCentre) { goTo(index); return; }
                if (isCurrent) onToggle(); else onPlay(song);
              }}
            >
              <span className="coverflow-art" style={{ backgroundColor: titleAccent(song.title) }}>
                <span className="coverflow-initial" aria-hidden="true">{song.title.slice(0, 1).toUpperCase()}</span>
                {song.artwork ? (
                  <img src={song.artwork} alt="" loading="lazy" draggable={false} crossOrigin="anonymous" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
                ) : null}
                <span className="coverflow-badge" aria-hidden="true">
                  {isCurrent && isPlaying ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} />}
                </span>
              </span>
              <span className="coverflow-caption">
                <strong>{song.title}</strong>
                <span>{song.artist}</span>
              </span>
            </motion.button>
          );
        })}
      </div>

      <button type="button" className="coverflow-arrow coverflow-arrow--prev" onClick={() => nudge(-1)} disabled={active === 0} aria-label="Previous cover">
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <button type="button" className="coverflow-arrow coverflow-arrow--next" onClick={() => nudge(1)} disabled={active === last} aria-label="Next cover">
        <ChevronRight size={20} aria-hidden="true" />
      </button>

      <p className="coverflow-count" aria-hidden="true">{active + 1} / {songs.length}</p>
      <p className="sr-only" aria-live="polite">{`${centre.title} by ${centre.artist}, ${active + 1} of ${songs.length}`}</p>
    </div>
  );
}
