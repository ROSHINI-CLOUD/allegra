import { Languages, LoaderCircle, RefreshCw } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject
} from 'react';

import type { LyricLine } from '@shared/types';

import { EmptyState, TactileButton } from './ui';
import { clamp } from '../lib/utils';

interface LyricsPanelProps {
  readonly lines: LyricLine[];
  readonly currentTime: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onSeek: (timestamp: number) => void;
  /** When set, tapping a line seeks and requests playback. */
  readonly onActivateLine?: (timestamp: number) => void;
  readonly compact?: boolean;
  readonly artworkUrl?: string | null;
  readonly translating?: boolean;
  readonly translated?: boolean;
  readonly translateError?: string | null;
  readonly translateProvider?: string | null;
  readonly onToggleTranslate?: () => void;
  readonly hideBackdrop?: boolean;
  /** Soft-focus stage: active line stays near the optical center (default true). */
  readonly softFocus?: boolean;
  readonly karaokeProgress?: boolean;
}

const FOLLOW_RESUME_MS = 2200;

/** easeOutCubic: fast start, gentle settle — reads as a snap rather than a drift. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Synced lyrics with a hand-rolled smooth scroll (see `scrollActiveIntoView`).
 * Soft-focus uses overflow scroll (not transform lock) so past/future lines stay reachable.
 */
export function LyricsPanel({
  lines,
  currentTime,
  loading,
  error,
  onRetry,
  onSeek,
  onActivateLine,
  compact = false,
  artworkUrl = null,
  translating = false,
  translated = false,
  translateError = null,
  translateProvider = null,
  onToggleTranslate,
  hideBackdrop = false,
  softFocus = true,
  karaokeProgress = false
}: LyricsPanelProps) {
  const reduced = useReducedMotion();
  const lineRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followPausedRef = useRef(false);
  const resumeTimerRef = useRef(0);
  /** rAF handle for our own scroll animation, so a new target can cancel the last one cleanly. */
  const scrollAnimationRef = useRef(0);
  /** True while our own animation is moving the container — the scroll handler must ignore it. */
  const isAnimatingRef = useRef(false);
  const lastSongKeyRef = useRef('');
  const [followPaused, setFollowPaused] = useState(false);

  const activeIndex = useMemo(() => findActiveLine(lines, currentTime), [currentTime, lines]);
  const lineProgress = useMemo(
    () => (karaokeProgress ? activeLineProgress(lines, activeIndex, currentTime) : 0),
    [lines, activeIndex, currentTime, karaokeProgress]
  );

  const songKey = useMemo(
    () => (lines.length > 0 ? `${lines[0]?.timestamp ?? 0}:${lines.length}:${lines[lines.length - 1]?.timestamp ?? 0}` : ''),
    [lines]
  );

  const pauseFollow = useCallback(() => {
    if (scrollAnimationRef.current) {
      window.cancelAnimationFrame(scrollAnimationRef.current);
      scrollAnimationRef.current = 0;
    }
    isAnimatingRef.current = false;
    followPausedRef.current = true;
    setFollowPaused(true);
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      followPausedRef.current = false;
      setFollowPaused(false);
    }, FOLLOW_RESUME_MS);
  }, []);

  const resumeFollowNow = useCallback(() => {
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    followPausedRef.current = false;
    setFollowPaused(false);
  }, []);

  useEffect(() => () => {
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    if (scrollAnimationRef.current) window.cancelAnimationFrame(scrollAnimationRef.current);
  }, []);

  // New lyric set (song change / reopen after load): reset scroll + follow.
  useLayoutEffect(() => {
    if (!songKey || songKey === lastSongKeyRef.current) return;
    lastSongKeyRef.current = songKey;
    resumeFollowNow();
    if (scrollAnimationRef.current) window.cancelAnimationFrame(scrollAnimationRef.current);
    isAnimatingRef.current = false;
    const container = scrollRef.current;
    if (container) container.scrollTop = 0;
  }, [songKey, resumeFollowNow]);

  const scrollActiveIntoView = useCallback(
    (instant: boolean) => {
      const container = scrollRef.current;
      const active = lineRefs.current[activeIndex];
      if (!container || !active) return;

      // A touch above centre — the sung line is the focal point, with more of what is coming below it.
      // Measured against the container's own box: offsetTop is relative to the nearest
      // positioned ancestor, which is the section, so it silently adds the chrome height
      // and parks the active line above centre.
      const offsetInScroll =
        container.scrollTop + (active.getBoundingClientRect().top - container.getBoundingClientRect().top);
      const target = offsetInScroll - container.clientHeight * ACTIVE_LINE_ANCHOR + active.offsetHeight / 2;
      const nextTop = Math.max(0, target);
      const start = container.scrollTop;
      const distance = nextTop - start;
      if (Math.abs(distance) < 2) return;

      if (scrollAnimationRef.current) window.cancelAnimationFrame(scrollAnimationRef.current);

      if (instant) {
        isAnimatingRef.current = false;
        container.scrollTop = nextTop;
        return;
      }

      // Driven by rAF, not the browser's native smooth scroll: native duration/easing
      // varies by engine and consistently lagged behind the highlight class flipping to
      // the new line, which read as the line "catching up" a beat late instead of rising
      // into place with it. A short, tuned duration keeps line-to-line hops snappy — the
      // active line comes up smoothly right as it lights up, not after.
      const duration = Math.min(520, Math.max(220, Math.abs(distance) * 0.5));
      const startedAt = performance.now();
      isAnimatingRef.current = true;

      const step = (now: number): void => {
        const elapsed = now - startedAt;
        const t = Math.min(1, elapsed / duration);
        container.scrollTop = start + distance * easeOutCubic(t);
        if (t < 1) {
          scrollAnimationRef.current = window.requestAnimationFrame(step);
        } else {
          isAnimatingRef.current = false;
          scrollAnimationRef.current = 0;
        }
      };
      scrollAnimationRef.current = window.requestAnimationFrame(step);
    },
    [activeIndex]
  );

  // Auto-follow active line unless the user is freely scrolling.
  useLayoutEffect(() => {
    if (followPausedRef.current) return;
    if (loading || lines.length === 0) return;
    scrollActiveIntoView(Boolean(reduced));
  }, [activeIndex, loading, lines.length, reduced, scrollActiveIntoView, followPaused, songKey]);

  const handleScroll = useCallback(() => {
    // Our own animation drives scrollTop every frame too, so ignore scroll events while it runs.
    if (isAnimatingRef.current) return;
    pauseFollow();
  }, [pauseFollow]);

  const handleLineActivate = useCallback(
    (timestamp: number) => {
      resumeFollowNow();
      if (onActivateLine) onActivateLine(timestamp);
      else onSeek(timestamp);
      // Snap after seek so the tapped line is centered immediately.
      window.requestAnimationFrame(() => {
        scrollActiveIntoView(Boolean(reduced));
      });
    },
    [onActivateLine, onSeek, reduced, resumeFollowNow, scrollActiveIntoView]
  );

  return (
    <section
      className={`ytm-lyrics ${compact ? 'ytm-lyrics--compact' : ''} ${hideBackdrop ? 'ytm-lyrics--nobackdrop' : ''} ${softFocus && !compact ? 'ytm-lyrics--softfocus' : ''}${followPaused ? ' is-user-scrolling' : ''}`}
      aria-labelledby="lyrics-heading"
    >
      {!hideBackdrop && (
        <>
          {artworkUrl ? (
            <div
              className="ytm-lyrics__backdrop"
              style={{ backgroundImage: `url(${JSON.stringify(artworkUrl)})` }}
              aria-hidden="true"
            />
          ) : (
            <div className="ytm-lyrics__backdrop ytm-lyrics__backdrop--empty" aria-hidden="true" />
          )}
          <div className="ytm-lyrics__veil" aria-hidden="true" />
        </>
      )}

      <div className="ytm-lyrics__chrome">
        <div className="ytm-lyrics__heading">
          <h2 id="lyrics-heading">Lyrics</h2>
          <span className="ytm-lyrics__hint">{lines.length > 0 ? 'Tap any line to jump audio' : 'Waiting for track'}</span>
        </div>
        {onToggleTranslate && lines.length > 0 ? (
          <TactileButton
            variant="ghost"
            icon={translating ? LoaderCircle : Languages}
            onClick={onToggleTranslate}
            aria-label={translated ? 'Show original lyrics' : 'Translate lyrics to English'}
          >
            {translating ? 'Translating…' : translated ? 'Original' : 'Translate'}
          </TactileButton>
        ) : null}
      </div>

      {translateError ? <p className="ytm-lyrics__alert" role="alert">{translateError}</p> : null}
      {translated && translateProvider ? (
        <p className="ytm-lyrics__note">Translated by {translateProvider} — meaning, not word-for-word.</p>
      ) : null}

      {softFocus && !compact && !loading && !error && lines.length > 0 ? (
        <>
          <div className="ytm-lyrics__edge ytm-lyrics__edge--top" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div className="ytm-lyrics__edge ytm-lyrics__edge--bottom" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        </>
      ) : null}

      {loading ? (
        <div className="ytm-lyrics__state ytm-lyrics__state--loading" role="status" aria-live="polite">
          <div className="lyrics-fetch">
            <span className="lyric-wave lyric-wave--live" aria-hidden="true"><i /><i /><i /><i /><i /></span>
            <p>Fetching lyrics</p>
          </div>
        </div>
      ) : error ? (
        <div className="ytm-lyrics__state ytm-lyrics__state--error" role="alert">
          <p>{error}</p>
          <TactileButton icon={RefreshCw} onClick={onRetry}>Try again</TactileButton>
        </div>
      ) : lines.length === 0 ? (
        <div className="ytm-lyrics__state">
          <EmptyState title="No lyrics found" copy="We could not locate synchronized lyrics for this track." />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={`ytm-lyrics__scroll${softFocus && !compact ? ' ytm-lyrics__scroll--soft' : ''}`}
          role="list"
          aria-label="Song lyrics"
          onScroll={handleScroll}
          onWheel={pauseFollow}
          onTouchStart={pauseFollow}
        >
          {lines.map((line, index) => (
            <LyricLineButton
              key={`${line.lineOrder}-${line.timestamp}`}
              line={line}
              index={index}
              activeIndex={activeIndex}
              progress={index === activeIndex ? lineProgress : 0}
              karaoke={karaokeProgress && index === activeIndex}
              onActivate={handleLineActivate}
              lineRefs={lineRefs}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const LyricLineButton = memo(function LyricLineButton({
  line,
  index,
  activeIndex,
  progress,
  karaoke,
  onActivate,
  lineRefs
}: {
  readonly line: LyricLine;
  readonly index: number;
  readonly activeIndex: number;
  readonly progress: number;
  readonly karaoke: boolean;
  readonly onActivate: (timestamp: number) => void;
  readonly lineRefs: MutableRefObject<Record<number, HTMLButtonElement | null>>;
}) {
  const distance = Math.abs(index - activeIndex);
  const state =
    index === activeIndex
      ? 'is-active'
      : index < activeIndex
        ? distance > 2
          ? 'is-past is-distant'
          : 'is-past'
        : distance > 2
          ? 'is-future is-distant'
          : 'is-future';

  const instrumental = line.text === '[INSTRUMENTAL]' || line.text === '🎵';

  return (
    <button
      className={`ytm-lyrics__line ${state}`}
      type="button"
      ref={(element) => {
        lineRefs.current[index] = element;
      }}
      onClick={() => onActivate(line.timestamp)}
      role="listitem"
      aria-current={index === activeIndex ? 'true' : undefined}
      style={{ '--lyric-fade': lineOpacity(distance, index === activeIndex) } as CSSProperties}
    >
      {instrumental ? (
        <span className="ytm-lyrics__instrumental" aria-label="Instrumental break">
          <span className="lyric-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        </span>
      ) : karaoke ? (
        <KaraokeLine text={line.text} progress={progress} />
      ) : (
        line.text
      )}
    </button>
  );
});

/** Where the sung line rests in the lyrics viewport: 0 is the top edge, 0.5 dead centre. */
const ACTIVE_LINE_ANCHOR = 0.4;

function lineOpacity(distance: number, active: boolean): number {
  if (active) return 1;
  if (distance === 1) return 0.56;
  if (distance === 2) return 0.36;
  if (distance === 3) return 0.27;
  return 0.2;
}

function KaraokeLine({ text, progress }: { readonly text: string; readonly progress: number }) {
  const amount = clamp(progress, 0, 1);
  const inverse = amount <= 0.001 ? 1 : 1 / amount;

  return (
    <span className="ytm-lyrics__karaoke">
      <span className="ytm-lyrics__karaoke-base" aria-hidden="true">
        {text}
      </span>
      <span className="ytm-lyrics__karaoke-fill" style={{ transform: `scaleX(${amount})` }}>
        <span style={{ transform: `scaleX(${inverse})` }}>{text}</span>
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}

function findActiveLine(lines: LyricLine[], time: number): number {
  let low = 0;
  let high = lines.length - 1;
  let answer = 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];
    if (!line || line.timestamp > time) high = middle - 1;
    else {
      answer = middle;
      low = middle + 1;
    }
  }
  return answer;
}

function activeLineProgress(lines: LyricLine[], activeIndex: number, time: number): number {
  const current = lines[activeIndex];
  if (!current) return 0;
  const next = lines[activeIndex + 1];
  const start = current.timestamp;
  const end = next?.timestamp ?? start + 4;
  if (end <= start) return 1;
  return clamp((time - start) / (end - start), 0, 1);
}
