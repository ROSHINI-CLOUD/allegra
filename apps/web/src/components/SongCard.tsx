import { Heart, Pause, Play } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import type { UnifiedSong } from '@shared/types';

import { PlaylistMenu } from './PlaylistMenu';
import { IconButton, Artwork } from './ui';
import { itemVariants, spring } from '../motion';
import { usePress } from '../hooks/usePress';
import { formatTime } from '../lib/utils';

interface SongCardProps {
  readonly song: UnifiedSong;
  readonly index: number;
  readonly isCurrent: boolean;
  readonly isPlaying: boolean;
  /** Receives the tapped element so the page can fly light from it to the player. */
  readonly onPlay: (origin: HTMLElement) => void;
  readonly onLike: () => void;
  readonly liked: boolean;
  readonly onOpenAlbum?: (song: UnifiedSong) => void;
}

export function SongCard({ song, index, isCurrent, isPlaying, onPlay, onLike, liked, onOpenAlbum }: SongCardProps) {
  const reduced = useReducedMotion();
  const press = usePress();
  return (
    <motion.article
      className={`song-card track-row ${isCurrent ? 'is-current' : ''}`}
      data-playing={isPlaying ? 'true' : undefined}
      variants={itemVariants}
      custom={index}
      whileTap={reduced ? undefined : { y: 1 }}
      transition={spring.tactile}
    >
      <span className="track-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <button className="card-art-wrap" {...press} onClick={(event) => onPlay(event.currentTarget)} aria-label={`${isPlaying ? 'Pause' : 'Play'} ${song.title}`}>
        <Artwork song={song} size="small" layoutId={isCurrent ? `art-${song.id}` : undefined} />
        <span className="card-play">
          {isPlaying ? <Pause size={16} fill="currentColor" strokeWidth={1.5} aria-hidden="true" /> : <Play size={16} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />}
        </span>
        {isCurrent ? <span className="now-badge">{isPlaying ? 'Playing' : 'Queued'}</span> : null}
      </button>
      <div className="card-copy">
        <div className="card-title-row">
          <button className="card-title-button" type="button" title={`Play ${song.title}`} onClick={(event) => onPlay(event.currentTarget)}>
            <h3>{song.title}</h3>
          </button>
          <IconButton icon={Heart} label={liked ? 'Remove from likes' : 'Add to likes'} active={liked} onClick={onLike} />
          <PlaylistMenu song={song} />
        </div>
        <p title={song.artist}>{song.artist}</p>
      </div>
      {onOpenAlbum && song.album ? (
        <button
          type="button"
          className="track-album track-album--link"
          title={`Open album ${song.album}`}
          onClick={() => onOpenAlbum(song)}
        >
          {song.album}
        </button>
      ) : (
        <div className="track-album" title={song.album ?? 'Single'}>{song.album ?? 'Single'}</div>
      )}
      <div className="card-meta"><span>{formatTime(song.duration)}</span><span className="meta-dot" aria-hidden="true" /><span>{song.language ?? song.source}</span></div>
    </motion.article>
  );
}
