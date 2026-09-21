import { Heart, Pause, Play, Shuffle } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';
import type { CSSProperties } from 'react';

import type { UnifiedSong } from '@shared/types';

import { Artwork, IconButton, TactileButton } from './ui';
import { formatAlbumDuration } from '../lib/album';
import type { Palette } from '../lib/palette';
import { formatTime } from '../lib/utils';
import { itemVariants, motionTokens, pageVariants, spring } from '../motion';

interface AlbumPageProps {
  readonly seed: UnifiedSong;
  readonly tracks: UnifiedSong[];
  readonly palette: Palette;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: Set<string>;
  readonly onPlayTrack: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onPlayAll: () => void;
  readonly onShuffle: () => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onLikeAlbum: () => void;
  readonly albumLiked: boolean;
}

/**
 * Immersive album surface: artwork palette + WebGL field + dark mask behind a
 * hero + track list. Feeling of the cover, not a giant blurry wallpaper.
 */
export function AlbumPage({
  seed,
  tracks,
  palette,
  currentSongId,
  isPlaying,
  likedIds,
  onPlayTrack,
  onPlayAll,
  onShuffle,
  onLike,
  onLikeAlbum,
  albumLiked
}: AlbumPageProps) {
  const reduced = useReducedMotion();
  const totalDuration = useMemo(() => tracks.reduce((sum, track) => sum + track.duration, 0), [tracks]);
  const yearGuess = useMemo(() => inferYearHint(seed), [seed]);

  const shellStyle = {
    '--album-primary': palette.primary,
    '--album-secondary': palette.secondary,
    '--album-tertiary': palette.tertiary,
    ...(seed.artwork ? { '--cover': `url(${JSON.stringify(seed.artwork)})` } : {})
  } as CSSProperties;

  return (
    <motion.div
      className="album-page"
      style={shellStyle}
      variants={pageVariants}
      initial="hidden"
      animate="visible"
      transition={reduced ? { duration: motionTokens.duration.instant } : undefined}
    >
      <motion.section className="album-hero" variants={itemVariants} aria-labelledby="album-title">
        <motion.div
          className="album-hero__art"
          animate={reduced ? undefined : { scale: isPlaying && currentSongId && tracks.some((t) => t.id === currentSongId) ? 1.015 : 1 }}
          transition={spring.breathe}
        >
          <Artwork song={seed} size="large" layoutId={`album-art-${seed.id}`} />
        </motion.div>

        <div className="album-hero__copy">
          <span className="album-hero__eyebrow">Album</span>
          <h1 id="album-title">{seed.album?.trim() || seed.title}</h1>
          <p className="album-hero__artist">{seed.artist}</p>
          <p className="album-hero__meta">
            {yearGuess ? `${yearGuess} · ` : ''}
            {tracks.length} {tracks.length === 1 ? 'Song' : 'Songs'} · {formatAlbumDuration(totalDuration)}
          </p>
          <div className="album-hero__actions">
            <TactileButton variant="primary" icon={Play} onClick={onPlayAll}>
              Play
            </TactileButton>
            <TactileButton variant="secondary" icon={Shuffle} onClick={onShuffle}>
              Shuffle
            </TactileButton>
            <IconButton
              icon={Heart}
              label={albumLiked ? 'Remove album from likes' : 'Like album'}
              active={albumLiked}
              onClick={onLikeAlbum}
            />
          </div>
        </div>
      </motion.section>

      <motion.section className="album-tracklist" variants={itemVariants} aria-label="Album tracks">
        {tracks.map((track, index) => {
          const current = track.id === currentSongId;
          const playing = current && isPlaying;
          return (
            <div key={track.id} className={`album-track ${current ? 'is-current' : ''}`} aria-current={current ? 'true' : undefined}>
              <button
                type="button"
                className="album-track__main"
                onClick={() => onPlayTrack(track, tracks)}
                aria-label={`${playing ? 'Pause' : 'Play'} ${track.title}`}
              >
                <span className="album-track__index" aria-hidden="true">
                  {playing ? <Pause size={14} fill="currentColor" /> : current ? <Play size={14} fill="currentColor" /> : String(index + 1).padStart(2, '0')}
                </span>
                <span className="album-track__title">{track.title}</span>
                <span className="album-track__duration">{formatTime(track.duration)}</span>
              </button>
              <IconButton
                icon={Heart}
                className="album-track__more"
                label={likedIds.has(track.id) ? 'Remove from likes' : 'Add to likes'}
                active={likedIds.has(track.id)}
                onClick={() => onLike(track)}
              />
            </div>
          );
        })}
      </motion.section>
    </motion.div>
  );
}

function inferYearHint(song: UnifiedSong): string | null {
  // Providers rarely expose year; keep the meta row honest without inventing one.
  void song;
  return null;
}
