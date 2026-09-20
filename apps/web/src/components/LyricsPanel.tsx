import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';

import type { LyricLine } from '@shared/types';

import { EmptyState, TactileButton } from './ui';

interface LyricsPanelProps {
  readonly lines: LyricLine[];
  readonly currentTime: number;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onSeek: (timestamp: number) => void;
  readonly compact?: boolean;
}

export function LyricsPanel({ lines, currentTime, loading, error, onRetry, onSeek, compact = false }: LyricsPanelProps) {
  const lineRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeIndex = useMemo(() => findActiveLine(lines, currentTime), [currentTime, lines]);

  useEffect(() => {
    const container = scrollRef.current;
    const active = lineRefs.current[activeIndex];
    if (!container || !active) return;
    const target = active.offsetTop - (container.clientHeight / 2) + (active.offsetHeight / 2);
    container.scrollTo({ top: Math.max(0, target), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [activeIndex]);

  return (
    <section className={`lyrics-panel ${compact ? 'lyrics-compact' : ''}`} aria-labelledby="lyrics-heading">
      <div className="panel-heading">
        <h2 id="lyrics-heading">Lyrics</h2>
        <span className="lyrics-status">{lines.length > 0 ? 'Tap a line to jump' : 'Waiting for a song'}</span>
      </div>
      {loading ? (
        <div className="lyrics-loading" role="status"><LoaderCircle className="spin" size={20} /><span>Loading lyrics</span></div>
      ) : error ? (
        <div className="lyrics-error" role="alert"><p>{error}</p><TactileButton icon={RefreshCw} onClick={onRetry}>Try again</TactileButton></div>
      ) : lines.length === 0 ? (
        <EmptyState title="No lyrics yet" copy="We could not find lyrics for this track." />
      ) : (
        <div ref={scrollRef} className="lyrics-scroll" role="list" aria-label="Song lyrics">
          {lines.map((line, index) => (
            <button
              className={`lyric-line ${index === activeIndex ? 'is-active' : ''} ${Math.abs(index - activeIndex) > 1 ? 'is-distant' : ''}`}
              key={`${line.lineOrder}-${line.timestamp}`}
              ref={(element) => { lineRefs.current[index] = element; }}
              onClick={() => onSeek(line.timestamp)}
              role="listitem"
              aria-current={index === activeIndex ? 'true' : undefined}
            >
              {line.text === '[INSTRUMENTAL]' ? <span className="instrumental-mark" aria-label="Instrumental">◌</span> : line.text}
            </button>
          ))}
        </div>
      )}
    </section>
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
