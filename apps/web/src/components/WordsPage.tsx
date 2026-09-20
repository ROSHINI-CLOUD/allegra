import { ArrowLeft, ArrowUpRight, RefreshCw, Waves } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

import type { LyricLine, UnifiedSong } from '@shared/types';

import { LyricsPanel } from './LyricsPanel';
import { SongCard } from './SongCard';
import { Artwork, EmptyState, TactileButton } from './ui';
import { itemVariants, motionTokens, pageVariants } from '../motion';

interface WordsPageProps {
  readonly song: UnifiedSong | null;
  readonly lines: LyricLine[];
  readonly currentTime: number;
  readonly lyricsLoading: boolean;
  readonly lyricsError: string | null;
  readonly suggestions: UnifiedSong[];
  readonly suggestionsLoading: boolean;
  readonly suggestionsError: string | null;
  readonly likedIds: Set<string>;
  readonly isPlaying: boolean;
  readonly onRetryLyrics: () => void;
  readonly onRetrySuggestions: () => void;
  readonly onSeek: (timestamp: number) => void;
  readonly onPlay: (song: UnifiedSong) => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onDiscover: () => void;
}

export function WordsPage({ song, lines, currentTime, lyricsLoading, lyricsError, suggestions, suggestionsLoading, suggestionsError, likedIds, isPlaying, onRetryLyrics, onRetrySuggestions, onSeek, onPlay, onLike, onDiscover }: WordsPageProps) {
  const reduced = useReducedMotion();
  const transition = reduced ? { duration: motionTokens.duration.instant } : undefined;

  return (
    <motion.div className="words-page" variants={pageVariants} initial="hidden" animate="visible" transition={transition}>
      <motion.section className="words-hero" variants={itemVariants}>
        <div className="words-hero-art">{song ? <Artwork song={song} size="large" /> : <div className="words-empty-art"><Waves size={28} aria-hidden="true" /></div>}</div>
        <div className="words-hero-copy">
          <span className="eyebrow eyebrow-accent"><Waves size={13} aria-hidden="true" /> Words in the air</span>
          <h1>Let the song <em>say it for you.</em></h1>
          {song ? <><p className="words-now-label">Now listening</p><h2>{song.title}</h2><p>{song.artist}</p><TactileButton variant="secondary" icon={ArrowLeft} onClick={onDiscover}>Back to discover</TactileButton></> : <><p>Choose a song first and the room will bring its words closer, line by line.</p><TactileButton variant="primary" icon={ArrowUpRight} onClick={onDiscover}>Find a song</TactileButton></>}
        </div>
      </motion.section>

      {song ? <>
        <motion.section className="words-lyrics-section" variants={itemVariants}>
          <LyricsPanel lines={lines} currentTime={currentTime} loading={lyricsLoading} error={lyricsError} onRetry={onRetryLyrics} onSeek={onSeek} />
        </motion.section>
        <motion.section className="library-section words-suggestions" variants={itemVariants} aria-labelledby="suggestions-heading">
          <div className="library-section-heading"><div><span className="eyebrow">Keep the thread moving</span><h2 id="suggestions-heading">Next words</h2></div><span className="library-section-icon"><Waves size={15} aria-hidden="true" /></span></div>
          {suggestionsLoading ? <div className="suggestions-state" role="status">Loading suggestions</div> : suggestionsError ? <div className="suggestions-state"><p>{suggestionsError}</p><TactileButton icon={RefreshCw} onClick={onRetrySuggestions}>Try again</TactileButton></div> : suggestions.length > 0 ? <div className="library-track-list">{suggestions.map((suggestion, index) => <SongCard key={suggestion.id} song={suggestion} index={index} isCurrent={suggestion.id === song.id} isPlaying={suggestion.id === song.id && isPlaying} onPlay={() => onPlay(suggestion)} onLike={() => onLike(suggestion)} liked={likedIds.has(suggestion.id)} />)}</div> : <EmptyState title="The room is quiet" copy="We could not find a nearby thread yet. Try another song from discover." action={<TactileButton variant="accent" onClick={onDiscover}>Return to discover</TactileButton>} />}
        </motion.section>
      </> : <motion.section className="words-empty-state" variants={itemVariants}><EmptyState title="Start with a song" copy="Search for an artist, title, or feeling, then come back here for the words." action={<TactileButton variant="primary" onClick={onDiscover}>Open discover</TactileButton>} /></motion.section>}
    </motion.div>
  );
}
