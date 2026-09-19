import { Heart, Pause, Play } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import type { UnifiedSong } from '@shared/types';

import { IconButton, Artwork } from './ui';
import { itemVariants, spring } from '../motion';
import { formatTime } from '../lib/utils';

interface SongCardProps {
  readonly song: UnifiedSong;
  readonly index: number;
  readonly isCurrent: boolean;
  readonly isPlaying: boolean;
  readonly onPlay: () => void;
  readonly onLike: () => void;
  readonly liked: boolean;
}

export function SongCard({ song, index, isCurrent, isPlaying, onPlay, onLike, liked }: SongCardProps) {
  const reduced = useReducedMotion();
  return (
    <motion.article
      className={`song-card track-row ${isCurrent ? 'is-current' : ''}`}
      variants={itemVariants}
      custom={index}
      whileTap={reduced ? undefined : { y: 1 }}
      transition={spring.tactile}
    >
      <span className="track-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <button className="card-art-wrap" onClick={onPlay} aria-label={`${isPlaying ? 'Pause' : 'Play'} ${song.title}`}>
        <Artwork song={song} size="small" layoutId={isCurrent ? `art-${song.id}` : undefined} />
        <span className="card-play">
          {isPlaying ? <Pause size={16} fill="currentColor" strokeWidth={1.5} aria-hidden="true" /> : <Play size={16} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />}
        </span>
        {isCurrent ? <span className="now-badge">{isPlaying ? 'Playing' : 'Queued'}</span> : null}
      </button>
      <div className="card-copy">
        <div className="card-title-row">
          <h3 title={song.title}>{song.title}</h3>
          <IconButton icon={Heart} label={liked ? 'Remove from likes' : 'Add to likes'} active={liked} onClick={onLike} />
        </div>
        <p title={song.artist}>{song.artist}</p>
      </div>
      <div className="track-album" title={song.album ?? 'Single'}>{song.album ?? 'Single'}</div>
      <div className="card-meta"><span>{formatTime(song.duration)}</span><span className="meta-dot" aria-hidden="true" /><span>{song.language ?? song.source}</span></div>
    </motion.article>
  );
}
