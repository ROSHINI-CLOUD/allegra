import { ArrowLeft, BadgeCheck, Heart, Pause, Play, Shuffle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { ArtistProfile, UnifiedSong } from '@shared/types';

import { ArtistAbout } from './ArtistAbout';
import { PlaylistMenu } from './PlaylistMenu';
import { Artwork, EmptyState, IconButton, SkeletonCard, TactileButton } from './ui';
import { formatAlbumDuration } from '../lib/album';
import { extractPalette } from '../lib/palette';
import type { Palette } from '../lib/palette';
import { formatTime } from '../lib/utils';

export interface RelatedArtist {
  readonly name: string;
  /** A song to borrow artwork from when the artist has no photo. */
  readonly song?: UnifiedSong;
  readonly image?: string | null;
}

interface ArtistPageProps {
  readonly name: string;
  /** Provider profile: real photo, followers, verified flag, albums. Null while loading or when unavailable. */
  readonly profile: ArtistProfile | null;
  /** The artist's photo from the face lookup, used when the full profile did not load. Never a song cover. */
  readonly photoFallback?: string | null;
  /** This artist's tracks, most popular first. */
  readonly songs: readonly UnifiedSong[];
  readonly related: readonly RelatedArtist[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: Set<string>;
  readonly onBack: () => void;
  readonly onRetry: () => void;
  readonly onToggle: () => void;
  readonly onPlayTrack: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onPlayAll: (shuffle: boolean) => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onOpenAlbum: (albumName: string, seed: UnifiedSong | null) => void;
  readonly onOpenArtist: (name: string) => void;
}

const TOP_COLLAPSED = 5;
const TOP_EXPANDED = 10;

/** 1240 -> "1.2k", 177_000_000 -> "177m". Empty when the provider gave no count. */
function formatPlays(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  const trim = (value: number): string => (value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, ''));
  if (count >= 1e9) return `${trim(count / 1e9)}b plays`;
  if (count >= 1e6) return `${trim(count / 1e6)}m plays`;
  if (count >= 1e3) return `${trim(count / 1e3)}k plays`;
  return `${count} plays`;
}

function formatFollowers(count: number): string {
  const trim = (value: number): string => (value >= 100 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, ''));
  if (count >= 1e9) return `${trim(count / 1e9)}B followers`;
  if (count >= 1e6) return `${trim(count / 1e6)}M followers`;
  if (count >= 1e3) return `${trim(count / 1e3)}K followers`;
  return `${count} followers`;
}

/**
 * Artist surface: a contained hero plate — the photo framed as a portrait card beside the name,
 * over the same photo blurred past recognition — then Top songs (plays + album columns), albums
 * as cards, and similar artists.
 */
export function ArtistPage({
  name,
  profile,
  photoFallback = null,
  songs,
  related,
  loading,
  error,
  currentSongId,
  isPlaying,
  likedIds,
  onBack,
  onRetry,
  onToggle,
  onPlayTrack,
  onPlayAll,
  onLike,
  onOpenAlbum,
  onOpenArtist
}: ArtistPageProps) {
  const [expanded, setExpanded] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [palette, setPalette] = useState<Palette | null>(null);
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const queue = useMemo(() => [...songs], [songs]);
  // The portrait is the artist, never a song cover: without a photo it is a monogram.
  const photo = profile?.image ?? photoFallback;
  const heroImage = photo;
  const displayName = profile?.name ?? name;

  // Once the hero has scrolled off the top, a compact bar (name + play) takes over so the controls stay reachable.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;
    // The bar takes over once the hero's foot is within 220px of the top, i.e. as the name lifts away.
    const observer = new IntersectionObserver(([entry]) => {
      setStuck(entry !== undefined && !entry.isIntersecting && entry.boundingClientRect.top < 220);
    }, { rootMargin: '-220px 0px 0px 0px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Tint behind the photo comes from the photo itself, so the hero always matches the person.
  useEffect(() => {
    setPalette(null);
    if (!heroImage) return undefined;
    const controller = new AbortController();
    void extractPalette(heroImage, controller.signal).then((next) => {
      if (!controller.signal.aborted) setPalette(next);
    });
    return () => controller.abort();
  }, [heroImage]);

  const heroStyle = {
    '--art-primary': palette?.primary ?? '#3a3d45',
    '--art-secondary': palette?.secondary ?? '#2c2f36',
    '--art-tertiary': palette?.tertiary ?? '#3a3d45',
    ...(heroImage ? { '--cover': `url(${JSON.stringify(heroImage)})` } : {})
  } as CSSProperties;

  const artistIsCurrent = currentSongId !== null && songs.some((song) => song.id === currentSongId);
  const artistPlaying = artistIsCurrent && isPlaying;
  const totalSeconds = useMemo(() => songs.reduce((sum, song) => sum + song.duration, 0), [songs]);
  const totalPlays = useMemo(() => songs.reduce((sum, song) => sum + (Number.isFinite(song.playCount) ? song.playCount : 0), 0), [songs]);

  // Real albums (cover + year) from the provider when we have them; otherwise group the songs by album.
  const albums = useMemo(() => {
    if (profile && profile.albums.length > 0) {
      return profile.albums.map((album) => ({
        key: album.id,
        name: album.name,
        year: album.year,
        image: album.image,
        seed: songs.find((song) => song.album?.trim().toLocaleLowerCase() === album.name.trim().toLocaleLowerCase()) ?? null,
        trackCount: songs.filter((song) => song.album?.trim().toLocaleLowerCase() === album.name.trim().toLocaleLowerCase()).length
      }));
    }
    const groups = new Map<string, { key: string; name: string; year: string | null; image: string | null; seed: UnifiedSong; trackCount: number }>();
    for (const song of songs) {
      const album = song.album?.trim();
      if (!album) continue;
      const key = album.toLocaleLowerCase();
      const group = groups.get(key);
      if (group) group.trackCount += 1;
      else groups.set(key, { key, name: album, year: null, image: song.artwork || null, seed: song, trackCount: 1 });
    }
    return [...groups.values()].slice(0, 12);
  }, [profile, songs]);

  const topSongs = songs.slice(0, expanded ? TOP_EXPANDED : TOP_COLLAPSED);
  // Each fact is its own frosted pill in the hero, so the line never reads as one grey run-on.
  const stats = [
    profile?.followerCount ? formatFollowers(profile.followerCount) : '',
    loading ? 'Finding their songs…' : songs.length > 0 ? `${songs.length} top songs` : 'No songs found yet',
    !loading && !profile?.followerCount && totalPlays > 0 ? formatPlays(totalPlays) : '',
    !loading && songs.length > 0 ? formatAlbumDuration(totalSeconds) : ''
  ].filter(Boolean);

  return (
    <div className="artist-page">
      <div className={`detail-bar ${stuck ? 'is-visible' : ''}`} aria-hidden={!stuck}>
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back" tabIndex={stuck ? 0 : -1}><ArrowLeft size={18} aria-hidden="true" /></button>
        <strong>{displayName}</strong>
        {songs.length > 0 ? (
          <button type="button" className="detail-bar-play" tabIndex={stuck ? 0 : -1} onClick={() => { if (artistIsCurrent) onToggle(); else onPlayAll(false); }} aria-label={artistPlaying ? `Pause ${displayName}` : `Play ${displayName}`}>
            {artistPlaying ? <Pause size={18} fill="currentColor" aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
          </button>
        ) : null}
      </div>
      <header className="artist-hero" style={heroStyle}>
        {heroImage ? <div className="artist-hero__field" aria-hidden="true" /> : null}
        <div className="artist-hero__inner">
          {photo ? (
            <figure className="artist-portrait"><img src={photo} alt="" crossOrigin="anonymous" /></figure>
          ) : (
            <figure className={`artist-portrait artist-portrait--monogram${loading ? ' is-loading' : ''}`} aria-hidden="true">
              <span>{displayName.trim().slice(0, 1).toLocaleUpperCase()}</span>
            </figure>
          )}
          <div className="artist-hero-copy">
            <span className="artist-hero-eyebrow">{profile?.isVerified ? 'Verified artist' : 'Artist'}</span>
            <h1>
              {displayName}
              {profile?.isVerified ? <span className="artist-verified artist-verified--inline" aria-label="Verified artist" title="Verified artist"><BadgeCheck size={15} aria-hidden="true" /></span> : null}
            </h1>
            {stats.length > 0 ? (
              <ul className="artist-stats">
                {stats.map((stat) => <li key={stat}>{stat}</li>)}
              </ul>
            ) : null}
            {songs.length > 0 ? (
              <div className="artist-actions">
                <TactileButton variant="primary" icon={artistPlaying ? Pause : Play} onClick={() => { if (artistIsCurrent) onToggle(); else onPlayAll(false); }}>
                  {artistPlaying ? 'Pause' : 'Play'}
                </TactileButton>
                <TactileButton variant="primary" icon={Shuffle} onClick={() => onPlayAll(true)}>Shuffle</TactileButton>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <div ref={sentinelRef} className="detail-sentinel" aria-hidden="true" />

      {profile?.bio ? (
        <section className="artist-about-panel" aria-label="About the artist">
          <span className="artist-about-panel__kicker">About</span>
          <p className="artist-about-panel__bio is-clamped">{profile.bio}</p>
          <button type="button" className="show-more" aria-haspopup="dialog" onClick={() => setAboutOpen(true)}>
            Read the full story
          </button>
          <ArtistAbout
            open={aboutOpen}
            name={displayName}
            photo={photo}
            verified={profile.isVerified}
            bio={profile.bio}
            facts={stats}
            tint={heroStyle}
            onClose={() => setAboutOpen(false)}
          />
        </section>
      ) : null}

      {loading ? (
        <section className="artist-section-block" aria-label="Loading songs" aria-busy="true">
          <div className="track-list"><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></div>
        </section>
      ) : error ? (
        <EmptyState title="This artist did not load" copy={error} action={<TactileButton variant="primary" onClick={onRetry}>Try again</TactileButton>} />
      ) : songs.length === 0 ? (
        <EmptyState title="No songs for this artist" copy="Try another artist from Browse." action={<TactileButton variant="primary" onClick={onBack}>Back</TactileButton>} />
      ) : (
        <>
          <section className="artist-section-block" aria-labelledby="artist-top-heading">
            <div className="section-heading"><h2 id="artist-top-heading">Top songs</h2></div>
            <div className="top-songs" role="list">
              {topSongs.map((song) => {
                const current = song.id === currentSongId;
                const playing = current && isPlaying;
                return (
                  <article className={`top-song ${current ? 'is-current' : ''}`} key={song.id} role="listitem">
                    <button type="button" className="top-song-art" onClick={() => onPlayTrack(song, queue)} aria-label={`${playing ? 'Pause' : 'Play'} ${song.title}`}>
                      <Artwork song={song} size="small" />
                      <span className="card-play">{playing ? <Pause size={16} fill="currentColor" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}</span>
                    </button>
                    <button type="button" className="top-song-title" title={`Play ${song.title}`} onClick={() => onPlayTrack(song, queue)}>{song.title}</button>
                    <span className="top-song-artist" title={song.artist}>{song.artist}</span>
                    <span className="top-song-plays">{formatPlays(song.playCount)}</span>
                    {song.album ? (
                      <button type="button" className="top-song-album" title={`Open album ${song.album}`} onClick={() => onOpenAlbum(song.album ?? '', song)}>{song.album}</button>
                    ) : (
                      <span className="top-song-album">Single</span>
                    )}
                    <span className="top-song-actions">
                      <IconButton icon={Heart} label={likedIds.has(song.id) ? 'Remove from likes' : 'Add to likes'} active={likedIds.has(song.id)} onClick={() => onLike(song)} />
                      <PlaylistMenu song={song} />
                      <span className="top-song-time">{formatTime(song.duration)}</span>
                    </span>
                  </article>
                );
              })}
            </div>
            {songs.length > TOP_COLLAPSED ? (
              <button type="button" className="show-more" onClick={() => setExpanded((value) => !value)}>
                {expanded ? 'Show less' : 'Show all'}
              </button>
            ) : null}
          </section>

          {albums.length > 0 ? (
            <section className="artist-section-block" aria-labelledby="artist-albums-heading">
              <div className="section-heading"><h2 id="artist-albums-heading">Albums &amp; singles</h2></div>
              <div className="media-grid">
                {albums.map((album) => (
                  <div className="media-card" key={album.key}>
                    <button type="button" className="media-card-open" onClick={() => onOpenAlbum(album.name, album.seed)} aria-label={`Open album ${album.name}`}>
                      <span className="media-card-art">
                        {album.image ? <img src={album.image} alt="" loading="lazy" crossOrigin="anonymous" /> : album.seed ? <Artwork song={album.seed} size="large" /> : null}
                      </span>
                      <span className="media-card-title">{album.name}</span>
                      <span className="media-card-sub">{[album.year, album.trackCount > 0 ? `${album.trackCount} ${album.trackCount === 1 ? 'song' : 'songs'}` : ''].filter(Boolean).join(' · ') || 'Album'}</span>
                    </button>
                    {album.seed ? (
                      <button
                        type="button"
                        className="media-card-play"
                        onClick={() => onPlayTrack(album.seed as UnifiedSong, songs.filter((song) => song.album?.trim().toLocaleLowerCase() === album.name.trim().toLocaleLowerCase()))}
                        aria-label={`Play ${album.name}`}
                      >
                        <Play size={20} fill="currentColor" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {related.length > 0 ? (
        <section className="artist-section-block" aria-labelledby="artist-related-heading">
          <div className="section-heading"><h2 id="artist-related-heading">Fans also like</h2></div>
          <div className="media-grid">
            {related.map((artist) => (
              <div className="media-card media-card--round" key={artist.name}>
                <button type="button" className="media-card-open" onClick={() => onOpenArtist(artist.name)} aria-label={`Open ${artist.name}`}>
                  <span className="media-card-art">
                    {artist.image ? <img src={artist.image} alt="" loading="lazy" crossOrigin="anonymous" /> : artist.song ? <Artwork song={artist.song} size="large" /> : null}
                  </span>
                  <span className="media-card-title">{artist.name}</span>
                  <span className="media-card-sub">Artist</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
