import { ArrowRight, Disc3, ListMusic, Music2, Play, Sparkles, Users } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import type { UnifiedSong } from '@shared/types';

import { ArtistPreviewCard } from './ArtistPreviewCard';
import { SongCard } from './SongCard';
import { Artwork, EmptyState, SkeletonCard, TactileButton } from './ui';
import type { LibraryRecord } from '../lib/api';
import { bestArtistMatch } from '../lib/artistMatch';
import { pickTopResult } from '../lib/topResult';
import { creditedArtists, formatTime } from '../lib/utils';
import { motionTokens, spring } from '../motion';

export type SearchTab = 'all' | 'songs' | 'artists' | 'albums' | 'playlists';

interface AlbumHit {
  readonly key: string;
  readonly name: string;
  readonly seed: UnifiedSong;
  readonly trackCount: number;
}

interface SearchResultsProps {
  readonly query: string;
  readonly songs: readonly UnifiedSong[];
  readonly playlists: readonly LibraryRecord[];
  readonly faces: Record<string, string>;
  readonly searching: boolean;
  readonly error: string | null;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: Set<string>;
  readonly onPlayTrack: (song: UnifiedSong, queue?: UnifiedSong[]) => void;
  readonly onLike: (song: UnifiedSong) => void;
  readonly onOpenAlbum: (song: UnifiedSong) => void;
  readonly onOpenArtist: (name: string) => void;
  readonly onOpenPlaylist: (id: string) => void;
  readonly onRetry: () => void;
}

const TABS = [
  { id: 'all' as const, label: 'All', icon: Sparkles },
  { id: 'songs' as const, label: 'Songs', icon: Music2 },
  { id: 'artists' as const, label: 'Artists', icon: Users },
  { id: 'albums' as const, label: 'Albums', icon: Disc3 },
  { id: 'playlists' as const, label: 'Playlists', icon: ListMusic }
];

/** Lead + featured credits, so a search for a featured artist still surfaces them.
 *  Exported so App can prefetch faces for exactly the artists this panel will show. */
export function artistsFromSongs(songs: readonly UnifiedSong[], limit: number): { name: string; song: UnifiedSong }[] {
  const seen = new Set<string>();
  const list: { name: string; song: UnifiedSong }[] = [];
  for (const song of songs) {
    for (const name of creditedArtists(song.artist)) {
      const key = name.toLocaleLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push({ name, song });
      if (list.length >= limit) return list;
    }
  }
  return list;
}

function albumsFromSongs(songs: readonly UnifiedSong[], limit: number): AlbumHit[] {
  const byKey = new Map<string, { name: string; seed: UnifiedSong; trackCount: number }>();
  for (const song of songs) {
    const name = song.album?.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const found = byKey.get(key);
    if (found) found.trackCount += 1;
    else byKey.set(key, { name, seed: song, trackCount: 1 });
  }
  return [...byKey.entries()].slice(0, limit).map(([key, value]) => ({ key, ...value }));
}

export function SearchResults({
  query,
  songs,
  playlists,
  faces,
  searching,
  error,
  currentSongId,
  isPlaying,
  likedIds,
  onPlayTrack,
  onLike,
  onOpenAlbum,
  onOpenArtist,
  onOpenPlaylist,
  onRetry
}: SearchResultsProps) {
  const reduced = useReducedMotion();
  const [tab, setTab] = useState<SearchTab>('all');

  // A new search is a new set of answers: drop back to the overview.
  useEffect(() => {
    setTab('all');
  }, [query]);

  const artists = useMemo(() => artistsFromSongs(songs, 18), [songs]);
  const albums = useMemo(() => albumsFromSongs(songs, 18), [songs]);
  const matchedPlaylists = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    return playlists.filter((playlist) => playlist.name.toLocaleLowerCase().includes(needle));
  }, [playlists, query]);

  const counts: Record<SearchTab, number> = {
    all: songs.length,
    songs: songs.length,
    artists: artists.length,
    albums: albums.length,
    playlists: matchedPlaylists.length
  };

  // Not songs[0]: the provider often lists an editorial compilation ahead of the
  // release the listener means. See pickTopResult for how the two are told apart.
  const topResult = useMemo(() => pickTopResult(songs, query), [songs, query]);
  const totalDuration = useMemo(() => songs.reduce((sum, song) => sum + song.duration, 0), [songs]);

  const fade = reduced
    ? { duration: motionTokens.duration.instant }
    : { duration: motionTokens.duration.base, ease: motionTokens.ease.standard };

  const renderSongRows = (list: readonly UnifiedSong[]): ReactElement => (
    <>
      <div className="track-head" aria-hidden="true">
        <span>Track</span>
        <span>Album</span>
        <span>Length</span>
      </div>
      <div className="track-list">
        {list.map((song, index) => (
          <SongCard
            key={song.id}
            song={song}
            index={index}
            isCurrent={song.id === currentSongId}
            isPlaying={song.id === currentSongId && isPlaying}
            onPlay={(pick) => onPlayTrack(pick)}
            onLike={() => onLike(song)}
            liked={likedIds.has(song.id)}
            onOpenAlbum={onOpenAlbum}
          />
        ))}
      </div>
    </>
  );

  const artistCard = (artist: { name: string; song: UnifiedSong }): ReactElement => (
    <ArtistPreviewCard
      key={artist.name}
      name={artist.name}
      image={faces[artist.name.toLocaleLowerCase()] || null}
      photoPending={!(artist.name.toLocaleLowerCase() in faces)}
      currentSongId={currentSongId}
      isPlaying={isPlaying}
      onPlayTrack={(song, queue) => onPlayTrack(song, queue)}
      onOpenArtist={onOpenArtist}
    />
  );

  const renderArtists = (list: { name: string; song: UnifiedSong }[], featured = true): ReactElement => {
    // The artist the query was actually about leads; everyone else is a supporting credit.
    const { feature, rest } = featured
      ? bestArtistMatch(list, query)
      : { feature: null, rest: list };
    const photo = feature ? faces[feature.name.toLocaleLowerCase()] || null : null;

    return (
      <>
        {feature ? (
          <button
            type="button"
            className="artist-spotlight"
            onClick={() => onOpenArtist(feature.name)}
            aria-label={`Open artist ${feature.name}`}
          >
            <span className="artist-spotlight-photo">
              {photo ? (
                <img src={photo} alt="" loading="lazy" crossOrigin="anonymous" />
              ) : (
                <span className="artist-card-initial" aria-hidden="true">
                  {feature.name.trim().slice(0, 1).toLocaleUpperCase()}
                </span>
              )}
            </span>
            <span className="artist-spotlight-copy">
              <em>Artist</em>
              <strong>{feature.name}</strong>
              <span>Open their page</span>
            </span>
            <span className="artist-spotlight-go" aria-hidden="true"><ArrowRight size={20} /></span>
          </button>
        ) : null}
        {rest.length > 0 ? <div className="search-artist-grid">{rest.map(artistCard)}</div> : null}
      </>
    );
  };

  const renderAlbums = (list: AlbumHit[]): ReactElement => (
    <div className="media-grid">
      {list.map((album) => (
        <div className="media-card" key={album.key}>
          <button
            type="button"
            className="media-card-open"
            onClick={() => onOpenAlbum(album.seed)}
            aria-label={`Open album ${album.name}`}
          >
            <span className="media-card-art">
              <Artwork song={album.seed} size="large" />
            </span>
            <span className="media-card-title">{album.name}</span>
            <span className="media-card-sub">
              {album.seed.artist} · {album.trackCount} {album.trackCount === 1 ? 'song' : 'songs'}
            </span>
          </button>
          <button
            type="button"
            className="media-card-play"
            onClick={() =>
              onPlayTrack(
                album.seed,
                songs.filter((song) => song.album?.trim().toLocaleLowerCase() === album.key)
              )
            }
            aria-label={`Play ${album.name}`}
          >
            <Play size={20} fill="currentColor" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );

  const renderPlaylists = (list: readonly LibraryRecord[]): ReactElement =>
    list.length > 0 ? (
      <div className="media-grid">
        {list.map((playlist) => (
          <div className="media-card" key={playlist.id}>
            <button
              type="button"
              className="media-card-open"
              onClick={() => onOpenPlaylist(playlist.id)}
              aria-label={`Open playlist ${playlist.name}`}
            >
              <span className="media-card-art">
                {playlist.coverUrl ? (
                  <img src={playlist.coverUrl} alt="" loading="lazy" crossOrigin="anonymous" />
                ) : (
                  <span className="media-card-glyph" aria-hidden="true"><ListMusic size={26} /></span>
                )}
              </span>
              <span className="media-card-title">{playlist.name}</span>
              <span className="media-card-sub">
                {playlist.songIds.length} {playlist.songIds.length === 1 ? 'song' : 'songs'}
              </span>
            </button>
          </div>
        ))}
      </div>
    ) : (
      <EmptyState
        title="No playlists match that"
        copy="Only your own playlists are searched here. Save a few songs into one and it will show up."
      />
    );

  if (searching && songs.length === 0) {
    return (
      <section className="search-results" aria-busy="true" aria-label={`Searching for ${query}`}>
        <div className="search-results-head">
          <h2>Results for “{query}”</h2>
          <span className="result-count">Listening…</span>
        </div>
        <div className="track-list">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </section>
    );
  }

  if (error && songs.length === 0) {
    return (
      <section className="search-results" aria-label={`Results for ${query}`}>
        <div className="search-results-head">
          <h2>Results for “{query}”</h2>
        </div>
        <EmptyState
          title="That search did not come back"
          copy={error}
          action={<TactileButton variant="primary" onClick={onRetry}>Try the search again</TactileButton>}
        />
      </section>
    );
  }

  if (songs.length === 0) {
    return (
      <section className="search-results" aria-label={`Results for ${query}`}>
        <div className="search-results-head">
          <h2>Results for “{query}”</h2>
        </div>
        <EmptyState
          title="Nothing came back"
          copy="Try an artist, a lyric, or a mood. Start with “Arijit Singh” or “late night.”"
        />
      </section>
    );
  }

  return (
    <section className="search-results" aria-label={`Results for ${query}`}>
      <div className="search-results-head">
        <h2>Results for “{query}”</h2>
        <span className="result-count" aria-live="polite">
          {searching ? 'Listening…' : `${songs.length} tracks · ${formatTime(totalDuration)}`}
        </span>
      </div>

      <nav className="search-tabs" role="tablist" aria-label="Result types">
        {TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`search-tab-${item.id}`}
              aria-selected={active}
              aria-controls={`search-panel-${item.id}`}
              className={`search-tab${active ? ' is-active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              {active ? (
                <motion.span
                  layoutId="search-tab-bg"
                  className="search-tab-bg"
                  transition={reduced ? { duration: motionTokens.duration.instant } : spring.tactile}
                />
              ) : null}
              <span className="search-tab-label">
                <item.icon size={14} aria-hidden="true" />
                {item.label}
                {item.id !== 'all' && counts[item.id] > 0 ? (
                  <em className="search-tab-count">{counts[item.id]}</em>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          id={`search-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`search-tab-${tab}`}
          className="search-panel"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
          transition={fade}
        >
          {tab === 'all' ? (
            <>
              {topResult ? (
                <div className="search-block search-block--top">
                  <h3>Top result</h3>
                  <button
                    type="button"
                    className="search-top-card"
                    onClick={() => onPlayTrack(topResult)}
                    aria-label={`Play ${topResult.title}`}
                  >
                    <span className="search-top-art"><Artwork song={topResult} size="large" /></span>
                    <span className="search-top-copy">
                      <strong>{topResult.title}</strong>
                      <span>{topResult.artist}</span>
                      <em>Song{topResult.album ? ` · ${topResult.album}` : ''}</em>
                    </span>
                    <span className="search-top-play" aria-hidden="true"><Play size={20} fill="currentColor" /></span>
                  </button>
                </div>
              ) : null}

              <div className="search-block">
                <div className="search-block-head">
                  <h3>Songs</h3>
                  {songs.length > 5 ? (
                    <button type="button" className="search-more" onClick={() => setTab('songs')}>
                      Show all
                    </button>
                  ) : null}
                </div>
                {renderSongRows(songs.slice(0, 5))}
              </div>

              {artists.length > 0 ? (
                <div className="search-block">
                  <div className="search-block-head">
                    <h3>Artists</h3>
                    {artists.length > 6 ? (
                      <button type="button" className="search-more" onClick={() => setTab('artists')}>
                        Show all
                      </button>
                    ) : null}
                  </div>
                  {renderArtists(artists.slice(0, 6), false)}
                </div>
              ) : null}

              {albums.length > 0 ? (
                <div className="search-block">
                  <div className="search-block-head">
                    <h3>Albums</h3>
                    {albums.length > 6 ? (
                      <button type="button" className="search-more" onClick={() => setTab('albums')}>
                        Show all
                      </button>
                    ) : null}
                  </div>
                  {renderAlbums(albums.slice(0, 6))}
                </div>
              ) : null}
            </>
          ) : tab === 'songs' ? (
            renderSongRows(songs)
          ) : tab === 'artists' ? (
            renderArtists(artists)
          ) : tab === 'albums' ? (
            renderAlbums(albums)
          ) : (
            renderPlaylists(matchedPlaylists)
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
