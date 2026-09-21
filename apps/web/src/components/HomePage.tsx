import Link from 'next/link';
import { paths } from '../lib/routes';
import { Heart, ListMusic, Pause, Play, Plus, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import type { AccountProfile, TasteSummary, UnifiedSong } from '@shared/types';

import { ArtistPreviewCard } from './ArtistPreviewCard';
import { TasteOnboarding } from './TasteOnboarding';
import { Artwork, IconButton } from './ui';
import type { LibraryRecord } from '../lib/api';
import { motionTokens } from '../motion';

interface HomePageProps {
  readonly profile: AccountProfile | null;
  readonly taste: TasteSummary | null;
  readonly recentlyPlayed: readonly UnifiedSong[];
  readonly likedSongs: readonly UnifiedSong[];
  readonly playlists: readonly LibraryRecord[];
  readonly playlistSongs: ReadonlyMap<string, UnifiedSong>;
  readonly picks: readonly UnifiedSong[];
  readonly picksReason: string | null;
  readonly picksProvider: string | null;
  readonly trending: readonly UnifiedSong[];
  readonly faces: Readonly<Record<string, string>>;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: ReadonlySet<string>;
  readonly loading: boolean;
  readonly onPlay: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onToggle: () => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onOpenArtist: (name: string) => void;
  readonly onCreatePlaylist: (name: string) => Promise<unknown>;
  readonly onSeedTaste: (artists: string[], languages: string[]) => Promise<void>;
  readonly onOpenAuth: () => void;
}

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * The personal front door: their artists, what they were playing, their playlists, their likes and picks made from
 * what they do. Trending sits last, as somewhere to wander to, not what greets them.
 */
export function HomePage({
  profile, taste, recentlyPlayed, likedSongs, playlists, playlistSongs, picks, picksReason, picksProvider, trending, faces,
  currentSongId, isPlaying, likedIds, loading, onPlay, onToggle, onLike, onOpenArtist, onCreatePlaylist, onSeedTaste, onOpenAuth
}: HomePageProps) {
  const reduced = useReducedMotion();
  const [skippedSetup, setSkippedSetup] = useState(() => window.localStorage.getItem('allegra-skip-setup') === '1');
  const name = profile?.displayName?.split(' ')[0];
  const resume = recentlyPlayed[0] ?? null;
  const topArtists = taste?.topArtists.slice(0, 10) ?? [];
  const needsSetup = taste !== null && !taste.onboarded && !skippedSetup;
  const hasActivity = likedSongs.length > 0 || playlists.length > 0 || (taste?.signals ?? 0) >= 6;
  const inRotation = topArtists.slice(0, 3).map((artist) => artist.name);

  const stagger = reduced ? undefined : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="home-page">
      <motion.header className="home-hero" {...stagger} transition={{ duration: motionTokens.duration.slow, ease: motionTokens.ease.decelerate }}>
        <div className="home-hero-copy">
          <span className="eyebrow eyebrow-accent">{greeting()}</span>
          <h1>{name ? `${name}, welcome back` : 'Your music, all in one place'}</h1>
          <p>
            {inRotation.length > 0
              ? `Lately it is ${inRotation.join(', ')}. Everything below is tuned to you.`
              : 'Tell us what you love and this page tunes itself to you, more with every song you play.'}
          </p>
        </div>

        {resume ? (
          <div className="home-resume">
            <button type="button" className="home-resume-art" onClick={() => (currentSongId === resume.id ? onToggle() : onPlay(resume, [...recentlyPlayed]))} aria-label={`${currentSongId === resume.id && isPlaying ? 'Pause' : 'Play'} ${resume.title}`}>
              <Artwork song={resume} size="large" />
              <span className="home-resume-play">{currentSongId === resume.id && isPlaying ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}</span>
            </button>
            <div className="home-resume-copy">
              <span>Pick up where you left off</span>
              <strong title={resume.title}>{resume.title}</strong>
              <small title={resume.artist}>{resume.artist}</small>
            </div>
          </div>
        ) : null}
      </motion.header>

      {profile?.isGuest && hasActivity ? (
        <div className="guest-nudge" role="note">
          <span>You are listening as a guest. Make an account to keep your likes and playlists on every device.</span>
          <button type="button" className="btn-glass tactile-control" onClick={onOpenAuth}>Create account</button>
        </div>
      ) : null}

      <TasteOnboarding
        open={needsSetup}
        onSubmit={onSeedTaste}
        onSkip={() => {
          window.localStorage.setItem('allegra-skip-setup', '1');
          setSkippedSetup(true);
        }}
      />

      {topArtists.length > 0 ? (
        <section className="home-section" aria-labelledby="home-artists">
          <div className="section-heading"><h2 id="home-artists">Your artists</h2><span className="result-count">Learned from what you play</span></div>
          <div className="artist-list">
            {topArtists.map((artist) => (
              <ArtistPreviewCard
                key={artist.name}
                name={artist.name}
                image={faces[artist.name.toLocaleLowerCase()] || null}
                currentSongId={currentSongId}
                isPlaying={isPlaying}
                onPlayTrack={(song, queue) => onPlay(song, queue)}
                onOpenArtist={onOpenArtist}
              />
            ))}
          </div>
        </section>
      ) : null}

      {recentlyPlayed.length > 1 ? (
        <Shelf id="home-recent" title="Jump back in" songs={recentlyPlayed.slice(0, 14)} {...{ currentSongId, isPlaying, likedIds, onPlay, onLike }} />
      ) : null}

      <PlaylistsShelf playlists={playlists} songs={playlistSongs} loading={loading} onCreate={onCreatePlaylist} />

      {likedSongs.length > 0 ? (
        <Shelf id="home-liked" title="Songs you love" hint={`${likedSongs.length} liked`} href={paths.liked} songs={likedSongs.slice(0, 14)} {...{ currentSongId, isPlaying, likedIds, onPlay, onLike }} />
      ) : null}

      {picks.length > 0 ? (
        <Shelf
          id="home-picks"
          title={picksReason ?? 'Made for you'}
          eyebrow={<><Sparkles size={13} aria-hidden="true" /> {picksProvider ? `Picked for you, by ${picksProvider}` : 'Picked for you'}</>}
          songs={picks.slice(0, 14)}
          {...{ currentSongId, isPlaying, likedIds, onPlay, onLike }}
        />
      ) : null}

      {trending.length > 0 ? (
        <Shelf id="home-trending" title="Trending now" hint="Somewhere new to wander" href={paths.discover} songs={trending.slice(0, 14)} {...{ currentSongId, isPlaying, likedIds, onPlay, onLike }} />
      ) : null}
    </div>
  );
}

interface ShelfProps {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly href?: string;
  readonly eyebrow?: ReactNode;
  readonly songs: readonly UnifiedSong[];
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: ReadonlySet<string>;
  readonly onPlay: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onLike: (song: UnifiedSong) => void;
}

function Shelf({ id, title, hint, href, eyebrow, songs, currentSongId, isPlaying, likedIds, onPlay, onLike }: ShelfProps) {
  const queue = useMemo(() => [...songs], [songs]);
  return (
    <section className="home-section" aria-labelledby={id}>
      <div className="section-heading">
        <div>
          {eyebrow ? <span className="eyebrow eyebrow-accent">{eyebrow}</span> : null}
          <h2 id={id}>{title}</h2>
        </div>
        {href ? <Link className="shelf-link" href={href}>{hint ?? 'See all'}</Link> : hint ? <span className="result-count">{hint}</span> : null}
      </div>
      <div className="shelf">
        {songs.map((song) => {
          const current = song.id === currentSongId;
          return (
            <article key={song.id} className={`tile ${current ? 'is-current' : ''}`}>
              <button type="button" className="tile-art" onClick={() => onPlay(song, queue)} aria-label={`${current && isPlaying ? 'Pause' : 'Play'} ${song.title}`}>
                <Artwork song={song} size="large" />
                <span className="tile-play">{current && isPlaying ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}</span>
              </button>
              <div className="tile-meta">
                <div className="tile-copy">
                  <strong title={song.title}>{song.title}</strong>
                  <span title={song.artist}>{song.artist}</span>
                </div>
                <IconButton icon={Heart} className="tile-like" label={likedIds.has(song.id) ? 'Remove from likes' : 'Add to likes'} active={likedIds.has(song.id)} onClick={() => onLike(song)} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function PlaylistsShelf({ playlists, songs, loading, onCreate }: { readonly playlists: readonly LibraryRecord[]; readonly songs: ReadonlyMap<string, UnifiedSong>; readonly loading: boolean; readonly onCreate: (name: string) => Promise<unknown> }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim()) return;
    await onCreate(name);
    setName('');
    setCreating(false);
  };

  return (
    <section className="home-section" aria-labelledby="home-playlists">
      <div className="section-heading"><h2 id="home-playlists">Your playlists</h2><Link className="shelf-link" href={paths.library}>All playlists</Link></div>
      <div className="shelf shelf--playlists">
        {creating ? (
          <form className="playlist-tile playlist-tile--new is-editing" onSubmit={(event) => void submit(event)}>
            <input autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setCreating(false); }} placeholder="Name your playlist" aria-label="Playlist name" />
            <div><button type="submit" className="btn-primary tactile-control" disabled={!name.trim()}>Create</button><button type="button" className="btn-glass tactile-control" onClick={() => setCreating(false)}>Cancel</button></div>
          </form>
        ) : (
          <button type="button" className="playlist-tile playlist-tile--new" onClick={() => setCreating(true)}>
            <span className="playlist-tile-plus"><Plus size={22} aria-hidden="true" /></span>
            <strong>New playlist</strong>
            <small>Start one with any song</small>
          </button>
        )}
        {loading && playlists.length === 0 ? null : playlists.map((playlist) => {
          const covers = playlist.songIds.map((id) => songs.get(id)).filter((song): song is UnifiedSong => song !== undefined && Boolean(song.artwork));
          const unique = covers.filter((song, index, all) => all.findIndex((other) => other.artwork === song.artwork) === index).slice(0, 4);
          return (
            <Link key={playlist.id} className="playlist-tile" href={paths.playlist(playlist.id)}>
              <span className={`playlist-tile-art ${playlist.coverUrl || unique.length < 4 ? 'is-sparse' : ''}`}>
                {playlist.coverUrl
                  ? <span className="playlist-tile-custom"><img src={playlist.coverUrl} alt="" /></span>
                  : unique.length > 0
                    ? unique.map((song) => <span key={song.id}><Artwork song={song} size="large" /></span>)
                    : <ListMusic size={30} strokeWidth={1.4} aria-hidden="true" />}
              </span>
              <strong title={playlist.name}>{playlist.name}</strong>
              <small>{playlist.songIds.length} {playlist.songIds.length === 1 ? 'song' : 'songs'}{playlist.isPublic ? ' · shared' : ''}</small>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
