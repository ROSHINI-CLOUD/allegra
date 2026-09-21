import { ChevronDown, Heart, Pause, Play } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';

import type { UnifiedSong } from '@shared/types';

import { PlaylistMenu } from './PlaylistMenu';
import { IconButton, Artwork } from './ui';
import { itemVariants, motionTokens, spring } from '../motion';
import { usePress } from '../hooks/usePress';
import { formatTime } from '../lib/utils';

interface SongCardProps {
  readonly song: UnifiedSong;
  readonly index: number;
  readonly isCurrent: boolean;
  readonly isPlaying: boolean;
  /** Play this row (or a selected variant). Origin is the tapped control. */
  readonly onPlay: (song: UnifiedSong, origin: HTMLElement) => void;
  readonly onLike: () => void;
  readonly liked: boolean;
  readonly onOpenAlbum?: (song: UnifiedSong) => void;
}

export function SongCard({ song, index, isCurrent, isPlaying, onPlay, onLike, liked, onOpenAlbum }: SongCardProps) {
  const reduced = useReducedMotion();
  const press = usePress();
  const variants = song.variants ?? [];
  const [versionsOpen, setVersionsOpen] = useState(false);
  const versionLabel = variants.length === 1 ? '1 other version' : `${variants.length} other versions`;

  return (
    <motion.article
      className={`song-card track-row ${isCurrent ? 'is-current' : ''} ${versionsOpen ? 'has-versions-open' : ''}`}
      data-playing={isPlaying ? 'true' : undefined}
      variants={itemVariants}
      custom={index}
      whileTap={reduced ? undefined : { y: 1 }}
      transition={spring.tactile}
    >
      <span className="track-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <button className="card-art-wrap" {...press} onClick={(event) => onPlay(song, event.currentTarget)} aria-label={`${isPlaying ? 'Pause' : 'Play'} ${song.title}`}>
        <Artwork song={song} size="small" layoutId={isCurrent ? `art-${song.id}` : undefined} />
        <span className="card-play">
          {isPlaying ? <Pause size={16} fill="currentColor" strokeWidth={1.5} aria-hidden="true" /> : <Play size={16} fill="currentColor" strokeWidth={1.5} aria-hidden="true" />}
        </span>
        {isCurrent ? <span className="now-badge">{isPlaying ? 'Playing' : 'Queued'}</span> : null}
      </button>
      <div className="card-copy">
        <div className="card-title-row">
          <button className="card-title-button" type="button" title={`Play ${song.title}`} onClick={(event) => onPlay(song, event.currentTarget)}>
            <h3>{song.title}</h3>
          </button>
          <IconButton icon={Heart} label={liked ? 'Remove from likes' : 'Add to likes'} active={liked} onClick={onLike} />
          <PlaylistMenu song={song} />
        </div>
        <p title={song.artist}>{song.artist}</p>
        {variants.length > 0 ? (
          <button
            type="button"
            className={`song-versions-toggle ${versionsOpen ? 'is-open' : ''}`}
            aria-expanded={versionsOpen}
            onClick={() => setVersionsOpen((open) => !open)}
          >
            <ChevronDown size={14} aria-hidden="true" />
            {versionLabel}
          </button>
        ) : null}
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
      <AnimatePresence initial={false}>
        {versionsOpen && variants.length > 0 ? (
          <motion.div
            className="song-versions"
            key="versions"
            aria-label={`${versionLabel} for ${song.title}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={reduced ? { duration: motionTokens.duration.instant } : { duration: motionTokens.duration.fast, ease: motionTokens.ease.decelerate }}
          >
            {variants.map((variant) => (
              <button
                key={variant.id}
                type="button"
                className="song-version-row"
                onClick={(event) => onPlay(variant, event.currentTarget)}
                title={`Play ${variant.title} · ${variant.album ?? 'Single'}`}
              >
                <Artwork song={variant} size="small" />
                <span className="song-version-copy">
                  <strong>{variant.album ?? 'Single'}</strong>
                  <small>{formatTime(variant.duration)}</small>
                </span>
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}
