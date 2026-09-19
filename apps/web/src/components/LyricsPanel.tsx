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
  const activeIndex = useMemo(() => findActiveLine(lines, currentTime), [currentTime, lines]);

  useEffect(() => {
    const active = lineRefs.current[activeIndex];
    active?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeIndex]);

  return (
    <section className={`lyrics-panel ${compact ? 'lyrics-compact' : ''}`} aria-labelledby="lyrics-heading">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">The words between</span>
          <h2 id="lyrics-heading">Lyrics</h2>
        </div>
        <span className="lyrics-status">{lines.length > 0 ? 'Tap a line to jump' : 'Waiting for a song'}</span>
      </div>
      {loading ? (
        <div className="lyrics-loading" role="status"><LoaderCircle className="spin" size={20} /><span>Finding the feeling…</span></div>
      ) : error ? (
        <div className="lyrics-error" role="alert"><p>{error}</p><TactileButton icon={RefreshCw} onClick={onRetry}>Try again</TactileButton></div>
      ) : lines.length === 0 ? (
        <EmptyState title="A quiet track" copy="There are no lyrics for this one yet." />
      ) : (
        <div className="lyrics-scroll" role="list" aria-label="Song lyrics">
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
