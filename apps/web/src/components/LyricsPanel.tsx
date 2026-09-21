import { Languages, LoaderCircle, Music, RefreshCw } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { MutableRefObject } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { LyricLine } from '@shared/types';

import { EmptyState, TactileButton } from './ui';
import { clamp } from '../lib/utils';
import { motionTokens, spring } from '../motion';

interface LyricsPanelProps {
  readonly lines: LyricLine[];
  readonly currentTime: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onSeek: (timestamp: number) => void;
  readonly compact?: boolean;
  readonly artworkUrl?: string | null;
  readonly translating?: boolean;
  readonly translated?: boolean;
  readonly translateError?: string | null;
  readonly translateProvider?: string | null;
  readonly onToggleTranslate?: () => void;
  readonly hideBackdrop?: boolean;
  /** Soft-focus stage: active line stays optically anchored (default true). */
  readonly softFocus?: boolean;
  /** Optional sub-line (letter/word sweep) fill. Off by default: lyrics highlight line by line. */
  readonly karaokeProgress?: boolean;
}

/**
 * Full-screen quality synced lyrics: soft focus zone, spring line changes,
 * optional karaoke progress mask. No continuous page shove.
 */
export function LyricsPanel({
  lines,
  currentTime,
  loading,
  error,
  onRetry,
  onSeek,
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
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [focusOffset, setFocusOffset] = useState(0);
  const activeIndex = useMemo(() => findActiveLine(lines, currentTime), [currentTime, lines]);
  const lineProgress = useMemo(
    () => activeLineProgress(lines, activeIndex, currentTime),
    [lines, activeIndex, currentTime]
  );

  useLayoutEffect(() => {
    if (!softFocus || compact) return;
    const stage = stageRef.current;
    const active = lineRefs.current[activeIndex];
    if (!stage || !active) return;
    const stageBox = stage.getBoundingClientRect();
    const lineBox = active.getBoundingClientRect();
    const targetCenter = stageBox.top + stageBox.height * 0.42;
    const lineCenter = lineBox.top + lineBox.height / 2;
    setFocusOffset((current) => current + (targetCenter - lineCenter));
  }, [activeIndex, softFocus, compact, lines.length]);

  // Compact / fallback: classic center scroll without shoving the whole page.
  useLayoutEffect(() => {
    if (softFocus && !compact) return;
    const container = scrollRef.current;
    const active = lineRefs.current[activeIndex];
    if (!container || !active) return;
    const target = active.offsetTop - container.clientHeight / 2 + active.offsetHeight / 2;
    container.scrollTo({
      top: Math.max(0, target),
      behavior: reduced ? 'auto' : 'smooth'
    });
  }, [activeIndex, softFocus, compact, reduced]);

  const transition = reduced
    ? { duration: motionTokens.duration.instant }
    : spring.lyrics;

  return (
    <section
      className={`ytm-lyrics ${compact ? 'ytm-lyrics--compact' : ''} ${hideBackdrop ? 'ytm-lyrics--nobackdrop' : ''} ${softFocus && !compact ? 'ytm-lyrics--softfocus' : ''}`}
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

      {loading ? (
        <div className="ytm-lyrics__state ytm-lyrics__state--loading" role="status" aria-live="polite">
          <div className="lyrics-loading-card">
            <div className="lyrics-loading-orbit" aria-hidden="true">
              <span className="lyrics-loading-ring" />
              <span className="lyrics-loading-core"><LoaderCircle className="spin" size={19} /></span>
            </div>
            <div className="lyrics-loading-copy">
              <strong>Loading synchronized lyrics…</strong>
              <span>Finding the beat and lining up every word.</span>
            </div>
            <div className="lyrics-loading-wave" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
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
      ) : softFocus && !compact ? (
        <div ref={stageRef} className="ytm-lyrics__stage" role="list" aria-label="Song lyrics">
          <motion.div
            className="ytm-lyrics__focus-track"
            animate={{ y: focusOffset }}
            transition={transition}
          >
            {lines.map((line, index) => (
              <LyricLineButton
                key={`${line.lineOrder}-${line.timestamp}`}
                line={line}
                index={index}
                activeIndex={activeIndex}
                progress={index === activeIndex ? lineProgress : 0}
                karaoke={karaokeProgress && index === activeIndex}
                onSeek={onSeek}
                lineRefs={lineRefs}
                transition={transition}
              />
            ))}
          </motion.div>
        </div>
      ) : (
        <div ref={scrollRef} className="ytm-lyrics__scroll" role="list" aria-label="Song lyrics">
          {lines.map((line, index) => (
            <LyricLineButton
              key={`${line.lineOrder}-${line.timestamp}`}
              line={line}
              index={index}
              activeIndex={activeIndex}
              progress={index === activeIndex ? lineProgress : 0}
              karaoke={karaokeProgress && index === activeIndex}
              onSeek={onSeek}
              lineRefs={lineRefs}
              transition={transition}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LyricLineButton({
  line,
  index,
  activeIndex,
  progress,
  karaoke,
  onSeek,
  lineRefs,
  transition
}: {
  readonly line: LyricLine;
  readonly index: number;
  readonly activeIndex: number;
  readonly progress: number;
  readonly karaoke: boolean;
  readonly onSeek: (timestamp: number) => void;
  readonly lineRefs: MutableRefObject<Record<number, HTMLButtonElement | null>>;
  readonly transition: object;
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

  const opacity = index === activeIndex ? 1 : distance === 1 ? 0.5 : distance === 2 ? 0.32 : distance === 3 ? 0.2 : 0.12;
  const instrumental = line.text === '[INSTRUMENTAL]' || line.text === '🎵';

  return (
    <motion.button
      className={`ytm-lyrics__line ${state}`}
      type="button"
      ref={(element) => {
        lineRefs.current[index] = element;
      }}
      onClick={() => onSeek(line.timestamp)}
      role="listitem"
      aria-current={index === activeIndex ? 'true' : undefined}
      animate={{ opacity }}
      transition={transition}
    >
      {instrumental ? (
        <span className="ytm-lyrics__instrumental" aria-label="Instrumental break">
          <Music size={16} />
        </span>
      ) : karaoke ? (
        <KaraokeLine text={line.text} progress={progress} />
      ) : (
        line.text
      )}
    </motion.button>
  );
}

/** Transform-only karaoke reveal: played words full ink, future words dimmed. */
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
