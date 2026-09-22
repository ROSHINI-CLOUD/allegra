import Link from 'next/link';
import { paths } from '../lib/routes';
import { ArrowUpRight, Clock3, Heart, ListMusic, Play, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import type { UnifiedSong } from '@shared/types';

import { SongCard } from './SongCard';
import { usePlaylistsContext } from '../hooks/usePlaylists';
import type { LibraryRecord } from '../lib/api';
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
  readonly onPlay: (song: UnifiedSong, queue?: UnifiedSong[]) => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onRetry: () => void;
  readonly onDiscover: () => void;
}

export function LibraryPage({ likedSongs, recentlyPlayed, likedIds, loading, error, actionError, currentSongId, isPlaying, onPlay, onLike, onRetry, onDiscover }: LibraryPageProps) {
  const reduced = useReducedMotion();
  const transition = reduced ? { duration: motionTokens.duration.instant } : undefined;
  const playlistsApi = usePlaylistsContext();

  return (
    <motion.div className="library-page" variants={pageVariants} initial="hidden" animate="visible" transition={transition}>
      <motion.section className="inner-hero" variants={itemVariants}>
        <div>
          <span className="eyebrow eyebrow-accent"><Sparkles size={13} aria-hidden="true" /> Your listening room</span>
          <h1>Keep the songs <em>that found you.</em></h1>
          <p>Your likes and recent listening stay close, ready for the next room you want to make.</p>
        </div>
        <div className="library-stat-grid" aria-label="Library summary">
          <div className="library-stat"><Heart size={16} aria-hidden="true" /><strong>{likedSongs.length}</strong><span>kept close</span></div>
          <div className="library-stat"><Clock3 size={16} aria-hidden="true" /><strong>{recentlyPlayed.length}</strong><span>recent traces</span></div>
          <div className="library-stat"><ListMusic size={16} aria-hidden="true" /><strong>{playlistsApi.playlists.length}</strong><span>playlists</span></div>
        </div>
      </motion.section>

      {actionError ? <p className="library-sync-notice" role="status">{actionError}</p> : null}

      {loading ? (
        <section className="library-state" aria-live="polite"><div className="library-loading-mark"><span /><span /><span /></div><p>Loading your library</p></section>
      ) : error ? (
        <section className="library-state library-state-error" role="alert"><span className="state-mark" aria-hidden="true">✦</span><h2>Your library did not load</h2><p>{error}</p><TactileButton icon={RefreshCw} variant="primary" onClick={onRetry}>Try again</TactileButton></section>
      ) : (
        <>
          <LibrarySection eyebrow="Kept close" title="Your likes" icon={<Heart size={15} aria-hidden="true" />}>
            {likedSongs.length > 0 ? <SongGrid songs={likedSongs} currentSongId={currentSongId} isPlaying={isPlaying} likedIds={likedIds} onPlay={onPlay} onLike={onLike} /> : <EmptyState title="Make a small collection" copy="Tap the heart on any track and it will land here for the next listening session." action={<TactileButton variant="accent" icon={ArrowUpRight} onClick={onDiscover}>Find something to keep</TactileButton>} />}
          </LibrarySection>
          <LibrarySection eyebrow="Your rooms" title="Playlists" icon={<ListMusic size={15} aria-hidden="true" />}>
            <PlaylistsSection likedIds={likedIds} currentSongId={currentSongId} isPlaying={isPlaying} onPlay={onPlay} onLike={onLike} onDiscover={onDiscover} />
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
  return <motion.section id={`library-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`} className="library-section" variants={itemVariants}><div className="library-section-heading"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><span className="library-section-icon">{icon}</span></div>{children}</motion.section>;
}

function SongGrid({ songs, currentSongId, isPlaying, likedIds, onPlay, onLike }: { readonly songs: UnifiedSong[]; readonly currentSongId?: string; readonly isPlaying: boolean; readonly likedIds: Set<string>; readonly onPlay: (song: UnifiedSong, queue?: UnifiedSong[]) => void; readonly onLike: (song: UnifiedSong) => void }) {
  return <div className="library-track-list">{songs.map((song, index) => <SongCard key={song.id} song={song} index={index} isCurrent={song.id === currentSongId} isPlaying={song.id === currentSongId && isPlaying} onPlay={(pick) => onPlay(pick, songs)} onLike={() => onLike(song)} liked={likedIds.has(song.id)} />)}</div>;
}

function PlaylistsSection({ likedIds, currentSongId, isPlaying, onPlay, onLike, onDiscover }: { readonly likedIds: Set<string>; readonly currentSongId?: string; readonly isPlaying: boolean; readonly onPlay: (song: UnifiedSong, queue?: UnifiedSong[]) => void; readonly onLike: (song: UnifiedSong) => void; readonly onDiscover: () => void }) {
  const { playlists, songs, loading, error, actionError, reload, create, remove } = usePlaylistsContext();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (creating || !name.trim()) return;
    setCreating(true);
    if (await create(name)) setName('');
    setCreating(false);
  };

  if (loading && playlists.length === 0) return <p className="playlist-note" aria-live="polite">Loading your playlists</p>;
  if (error && playlists.length === 0) return <div className="playlist-note" role="alert"><p>{error}</p><TactileButton icon={RefreshCw} variant="primary" onClick={() => void reload()}>Try again</TactileButton></div>;

  return (
    <div className="playlist-section">
      <form className="playlist-new playlist-new-inline" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="new-playlist-name">New playlist name</label>
        <input id="new-playlist-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="Name a new playlist" autoComplete="off" />
        <TactileButton type="submit" variant="primary" disabled={creating || !name.trim()}>Create playlist</TactileButton>
      </form>
      {actionError ? <p className="library-sync-notice" role="status">{actionError}</p> : null}
      {playlists.length === 0 ? <EmptyState title="Start a playlist" copy="Name one above, then use the list-plus button on any track to save it here." action={<TactileButton variant="accent" icon={ArrowUpRight} onClick={onDiscover}>Find something to save</TactileButton>} /> : (
        <div className="playlist-grid">
          {playlists.map((playlist) => <PlaylistCard key={playlist.id} playlist={playlist} songs={playlist.songIds.map((id) => songs.get(id)).filter((song): song is UnifiedSong => song !== undefined)} likedIds={likedIds} currentSongId={currentSongId} isPlaying={isPlaying} onPlay={onPlay} onLike={onLike} onDelete={() => void remove(playlist.id)} />)}
        </div>
      )}
    </div>
  );
}

function PlaylistCard({ playlist, songs, likedIds, currentSongId, isPlaying, onPlay, onLike, onDelete }: { readonly playlist: LibraryRecord; readonly songs: UnifiedSong[]; readonly likedIds: Set<string>; readonly currentSongId?: string; readonly isPlaying: boolean; readonly onPlay: (song: UnifiedSong, queue?: UnifiedSong[]) => void; readonly onLike: (song: UnifiedSong) => void; readonly onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const first = songs[0];
  return (
    <article className="playlist-card" aria-label={`Playlist ${playlist.name}`}>
      <header className="playlist-card-head">
        {playlist.coverUrl ? (
          <Link className="playlist-card-cover" href={paths.playlist(playlist.id)} aria-hidden="true" tabIndex={-1}>
            <img src={playlist.coverUrl} alt="" />
          </Link>
        ) : null}
        <div>
          <h3 title={playlist.name}><Link className="playlist-open" href={paths.playlist(playlist.id)}>{playlist.name}</Link></h3>
          <span>{playlist.songIds.length} {playlist.songIds.length === 1 ? 'track' : 'tracks'}</span>
        </div>
        <div className="playlist-card-actions">
          {first ? <TactileButton variant="secondary" icon={Play} onClick={() => onPlay(first, songs)}>Play</TactileButton> : null}
          {confirming
            ? <><TactileButton variant="accent" icon={Trash2} onClick={onDelete}>Delete it</TactileButton><TactileButton variant="ghost" onClick={() => setConfirming(false)}>Keep</TactileButton></>
            : <button type="button" className="icon-button" aria-label={`Delete playlist ${playlist.name}`} title="Delete playlist" onClick={() => setConfirming(true)}><Trash2 size={17} aria-hidden="true" /></button>}
        </div>
      </header>
      {songs.length > 0
        ? <SongGrid songs={songs} currentSongId={currentSongId} isPlaying={isPlaying} likedIds={likedIds} onPlay={onPlay} onLike={onLike} />
        : <p className="playlist-note">{playlist.songIds.length > 0 ? 'Loading tracks' : 'Empty for now. Save a track with the list-plus button.'}</p>}
    </article>
  );
}
