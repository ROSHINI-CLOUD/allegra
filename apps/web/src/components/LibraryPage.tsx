import { ArrowUpRight, Clock3, Heart, RefreshCw, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

import type { UnifiedSong } from '@shared/types';

import { SongCard } from './SongCard';
import { EmptyState, TactileButton } from './ui';
import { itemVariants, motionTokens, pageVariants } from '../motion';

interface LibraryPageProps {
  readonly likedSongs: UnifiedSong[];
  readonly recentlyPlayed: UnifiedSong[];
  readonly likedIds: Set<string>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly actionError: string | null;
  readonly currentSongId?: string;
  readonly isPlaying: boolean;
  readonly onPlay: (song: UnifiedSong) => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onRetry: () => void;
  readonly onDiscover: () => void;
}

export function LibraryPage({ likedSongs, recentlyPlayed, likedIds, loading, error, actionError, currentSongId, isPlaying, onPlay, onLike, onRetry, onDiscover }: LibraryPageProps) {
  const reduced = useReducedMotion();
  const transition = reduced ? { duration: motionTokens.duration.instant } : undefined;

  return (
    <motion.div className="library-page" variants={pageVariants} initial="hidden" animate="visible" transition={transition}>
      <motion.section className="inner-hero" variants={itemVariants}>
        <div>
          <span className="eyebrow eyebrow-accent"><Sparkles size={13} aria-hidden="true" /> Your listening room</span>
          <h1>Keep the songs<br /><em>that found you.</em></h1>
          <p>Your likes and recent listening stay close, ready for the next room you want to make.</p>
        </div>
        <div className="library-stat-grid" aria-label="Library summary">
          <div className="library-stat"><Heart size={16} aria-hidden="true" /><strong>{likedSongs.length}</strong><span>kept close</span></div>
          <div className="library-stat"><Clock3 size={16} aria-hidden="true" /><strong>{recentlyPlayed.length}</strong><span>recent traces</span></div>
        </div>
      </motion.section>

      {actionError ? <p className="library-sync-notice" role="status">{actionError}</p> : null}

      {loading ? (
        <section className="library-state" aria-live="polite"><div className="library-loading-mark"><span /><span /><span /></div><p>Gathering your room…</p></section>
      ) : error ? (
        <section className="library-state library-state-error" role="alert"><span className="state-mark" aria-hidden="true">✦</span><h2>The room is still waking up.</h2><p>{error}</p><TactileButton icon={RefreshCw} variant="primary" onClick={onRetry}>Try again</TactileButton></section>
      ) : (
        <>
          <LibrarySection eyebrow="Kept close" title="Your likes" icon={<Heart size={15} aria-hidden="true" />}>
            {likedSongs.length > 0 ? <SongGrid songs={likedSongs} currentSongId={currentSongId} isPlaying={isPlaying} likedIds={likedIds} onPlay={onPlay} onLike={onLike} /> : <EmptyState title="Make a small collection" copy="Tap the heart on any track and it will land here for the next listening session." action={<TactileButton variant="accent" icon={ArrowUpRight} onClick={onDiscover}>Find something to keep</TactileButton>} />}
          </LibrarySection>
          <LibrarySection eyebrow="Recent traces" title="Played lately" icon={<Clock3 size={15} aria-hidden="true" />}>
            {recentlyPlayed.length > 0 ? <SongGrid songs={recentlyPlayed} currentSongId={currentSongId} isPlaying={isPlaying} likedIds={likedIds} onPlay={onPlay} onLike={onLike} /> : <EmptyState title="The first song is waiting" copy="Start with a search, follow a mood, and your recent path will appear here." action={<TactileButton variant="primary" onClick={onDiscover}>Open discover</TactileButton>} />}
          </LibrarySection>
        </>
      )}
    </motion.div>
  );
}

function LibrarySection({ eyebrow, title, icon, children }: { readonly eyebrow: string; readonly title: string; readonly icon: ReactNode; readonly children: ReactNode }) {
  return <motion.section className="library-section" variants={itemVariants}><div className="library-section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><span className="library-section-icon">{icon}</span></div>{children}</motion.section>;
}

function SongGrid({ songs, currentSongId, isPlaying, likedIds, onPlay, onLike }: { readonly songs: UnifiedSong[]; readonly currentSongId?: string; readonly isPlaying: boolean; readonly likedIds: Set<string>; readonly onPlay: (song: UnifiedSong) => void; readonly onLike: (song: UnifiedSong) => void }) {
  return <div className="library-track-list">{songs.map((song, index) => <SongCard key={song.id} song={song} index={index} isCurrent={song.id === currentSongId} isPlaying={song.id === currentSongId && isPlaying} onPlay={() => onPlay(song)} onLike={() => onLike(song)} liked={likedIds.has(song.id)} />)}</div>;
}
