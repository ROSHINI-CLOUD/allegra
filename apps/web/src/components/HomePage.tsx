import Link from 'next/link';
import { ChevronLeft, ChevronRight, Heart, ListMusic, Pause, Play, Plus, Shuffle, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode, RefObject } from 'react';

import type { AccountProfile, TasteSummary, UnifiedSong } from '@shared/types';

import { ArtistPreviewCard } from './ArtistPreviewCard';
import { TasteOnboarding } from './TasteOnboarding';
import { Artwork, IconButton } from './ui';
import type { LibraryRecord } from '../lib/api';
import { paths } from '../lib/routes';
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
  readonly madeForYou: readonly UnifiedSong[];
  readonly recommended: readonly UnifiedSong[];
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
  /** Hand a query to Discover — what the mood tiles do. */
  readonly onExplore: (query: string) => void;
}

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The provider's play counts run to eight digits; nobody reads those. */
function formatPlays(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  if (count >= 1e7) return `${Math.round(count / 1e6)}M plays`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1).replace(/\.0$/, '')}M plays`;
  if (count >= 1e3) return `${Math.round(count / 1e3)}K plays`;
  return `${count} plays`;
}

/** Browse entries. Every query is one the catalog actually answers well. */
const MOODS: ReadonlyArray<{ readonly label: string; readonly note: string; readonly query: string; readonly tint: string }> = [
  { label: 'Romance', note: 'Slow and close', query: 'romantic hits', tint: '#ee6b5f' },
  { label: 'Party', note: 'Loud and late', query: 'party songs', tint: '#d9e66a' },
  { label: 'Chill', note: 'Low and easy', query: 'lofi chill songs', tint: '#7bafd4' },
  { label: 'Workout', note: 'Keep moving', query: 'workout gym songs', tint: '#f0a05a' },
  { label: 'Focus', note: 'Words out of the way', query: 'instrumental focus music', tint: '#9b8bd0' },
  { label: 'Throwback', note: 'Already know the words', query: '90s superhit songs', tint: '#6fc3a0' }
];

/** First unique recording wins, so no shelf shows the same track twice. */
function dedupe(groups: ReadonlyArray<readonly UnifiedSong[]>, limit: number): UnifiedSong[] {
  const seen = new Set<string>();
  const picked: UnifiedSong[] = [];
  for (const group of groups) {
    for (const song of group) {
      if (picked.length >= limit) return picked;
      const key = `${song.title.toLocaleLowerCase()}|${song.artist.toLocaleLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(song);
    }
  }
  return picked;
}

/** Fisher-Yates on a copy — the source array is props and must not be touched. */
function shuffled(songs: readonly UnifiedSong[]): UnifiedSong[] {
  const copy = [...songs];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const held = copy[index] as UnifiedSong;
    copy[index] = copy[swap] as UnifiedSong;
    copy[swap] = held;
  }
  return copy;
}

/**
 * The personal front door. It opens on one song worth pressing play on, then reads outward:
 * what they were playing, who they play, what we made for them, and only then the chart and
 * the moods — somewhere to wander when nothing personal is calling.
 */
export function HomePage({
  profile, taste, recentlyPlayed, likedSongs, playlists, playlistSongs, picks, picksReason, picksProvider,
  trending, madeForYou, recommended, faces,
  currentSongId, isPlaying, likedIds, loading,
  onPlay, onToggle, onLike, onOpenArtist, onCreatePlaylist, onSeedTaste, onOpenAuth, onExplore
}: HomePageProps) {
  const reduced = useReducedMotion();
  const [skippedSetup, setSkippedSetup] = useState(() => window.localStorage.getItem('allegra-skip-setup') === '1');
  const name = profile?.displayName?.split(' ')[0];
  const topArtists = taste?.topArtists.slice(0, 10) ?? [];
  const needsSetup = taste !== null && !taste.onboarded && !skippedSetup;
  const hasActivity = likedSongs.length > 0 || playlists.length > 0 || (taste?.signals ?? 0) >= 6;
  const inRotation = topArtists.slice(0, 3).map((artist) => artist.name);

  const resume = recentlyPlayed[0] ?? null;
  // The spotlight would rather be something they were in the middle of. Failing that, the
  // loudest thing we know about — never an empty card.
  const feature = resume ?? picks[0] ?? trending[0] ?? madeForYou[0] ?? null;
  const featureIsResume = feature !== null && feature === resume;
  // Resuming continues their own history, but history is one song long on the first play —
  // pad it with the catalogue so Shuffle always has somewhere to go.
  const featureQueue = useMemo(
    () => dedupe([featureIsResume ? recentlyPlayed : [], trending, madeForYou, recommended, picks], 30),
    [featureIsResume, recentlyPlayed, trending, madeForYou, recommended, picks]
  );
  // Six compact cards beside the spotlight: what they reach for, padded out with what is hot.
  const quickPicks = useMemo(
    () => dedupe([recentlyPlayed.slice(1), likedSongs, picks, trending], 6),
    [recentlyPlayed, likedSongs, picks, trending]
  );
  const chart = useMemo(() => trending.slice(0, 10), [trending]);

  const stagger = reduced ? undefined : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 } };

  const playFeature = (): void => {
    if (!feature) return;
    if (currentSongId === feature.id) onToggle();
    else onPlay(feature, featureQueue.length > 0 ? featureQueue : [feature]);
  };

  const shuffleFeature = (): void => {
    const pool = featureQueue.length > 1 ? featureQueue : feature ? [feature] : [];
    const order = shuffled(pool);
    const first = order[0];
    if (first) onPlay(first, order);
  };

  return (
    <div className="home-page">
      <motion.section
        className="home-spotlight"
        aria-labelledby="home-greeting"
        {...stagger}
        transition={{ duration: motionTokens.duration.slow, ease: motionTokens.ease.decelerate }}
      >
        {feature ? (
          <div className="home-spotlight-wash" style={{ backgroundImage: `url("${feature.artwork}")` }} aria-hidden="true" />
        ) : null}
        <div className="home-spotlight-inner">
          <div className="home-spotlight-lead">
            <span className="eyebrow eyebrow-accent">{greeting()}</span>
            <h1 id="home-greeting">{name ? `${name}, welcome back` : 'Your music, all in one place'}</h1>
            <p>
              {inRotation.length > 0
                ? `Lately it is ${inRotation.join(', ')}. Everything below is tuned to you.`
                : 'Tell us what you love and this page tunes itself to you, more with every song you play.'}
            </p>

            {feature ? (
              <div className="home-feature">
                <button
                  type="button"
                  className="home-feature-art"
                  onClick={playFeature}
                  aria-label={`${currentSongId === feature.id && isPlaying ? 'Pause' : 'Play'} ${feature.title}`}
                >
                  <Artwork song={feature} size="large" />
                  <span className="home-feature-play">
                    {currentSongId === feature.id && isPlaying
                      ? <Pause size={20} fill="currentColor" aria-hidden="true" />
                      : <Play size={20} fill="currentColor" aria-hidden="true" />}
                  </span>
                </button>
                <div className="home-feature-copy">
                  <span>{featureIsResume ? 'Pick up where you left off' : 'Start here'}</span>
                  <strong title={feature.title}>{feature.title}</strong>
                  <small title={feature.artist}>{feature.artist}</small>
                  <div className="home-feature-actions">
                    <button type="button" className="btn-primary tactile-control" onClick={playFeature}>
                      {currentSongId === feature.id && isPlaying
                        ? <><Pause size={15} fill="currentColor" aria-hidden="true" /> Pause</>
                        : <><Play size={15} fill="currentColor" aria-hidden="true" /> Play</>}
                    </button>
                    <button type="button" className="btn-glass tactile-control" onClick={shuffleFeature} disabled={featureQueue.length < 2}>
                      <Shuffle size={15} aria-hidden="true" /> Shuffle
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {quickPicks.length > 0 ? (
            <div className="home-quick" aria-label="Quick picks">
              {quickPicks.map((song) => {
                const current = song.id === currentSongId;
                return (
                  <button
                    key={song.id}
                    type="button"
                    className={`home-quick-card ${current ? 'is-current' : ''}`}
                    onClick={() => (current ? onToggle() : onPlay(song, [...quickPicks]))}
                    aria-label={`${current && isPlaying ? 'Pause' : 'Play'} ${song.title}`}
                  >
                    <Artwork song={song} size="small" />
                    <span className="home-quick-copy">
                      <strong title={song.title}>{song.title}</strong>
                      <small title={song.artist}>{song.artist}</small>
                    </span>
                    <span className="home-quick-play">
                      {current && isPlaying
                        ? <Pause size={14} fill="currentColor" aria-hidden="true" />
                        : <Play size={14} fill="currentColor" aria-hidden="true" />}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </motion.section>

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
        <Section id="home-artists" title="Your artists" hint="Learned from what you play" reduced={reduced}>
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
        </Section>
      ) : null}

      {recentlyPlayed.length > 1 ? (
        <Shelf id="home-recent" title="Jump back in" songs={recentlyPlayed.slice(0, 14)} {...{ reduced, currentSongId, isPlaying, likedIds, onPlay, onLike }} />
      ) : null}

      {picks.length > 0 ? (
        <Shelf
          id="home-picks"
          title={picksReason ?? 'Made for you'}
          eyebrow={<><Sparkles size={13} aria-hidden="true" /> {picksProvider ? `Picked for you, by ${picksProvider}` : 'Picked for you'}</>}
          songs={picks.slice(0, 14)}
          {...{ reduced, currentSongId, isPlaying, likedIds, onPlay, onLike }}
        />
      ) : null}

      <PlaylistsShelf playlists={playlists} songs={playlistSongs} loading={loading} reduced={reduced} onCreate={onCreatePlaylist} />

      {likedSongs.length > 0 ? (
        <Shelf id="home-liked" title="Songs you love" hint={`${likedSongs.length} liked`} href={paths.liked} songs={likedSongs.slice(0, 14)} {...{ reduced, currentSongId, isPlaying, likedIds, onPlay, onLike }} />
      ) : null}

      <Section id="home-moods" title="Browse by mood" hint="Opens in Discover" reduced={reduced}>
        <div className="mood-grid">
          {MOODS.map((mood) => (
            <button
              key={mood.label}
              type="button"
              className="mood-card"
              style={{ '--mood-tint': mood.tint } as CSSProperties}
              onClick={() => onExplore(mood.query)}
            >
              <span className="mood-card-label">{mood.label}</span>
              <span className="mood-card-note">{mood.note}</span>
              <span className="mood-card-chip" aria-hidden="true" />
            </button>
          ))}
        </div>
      </Section>

      {chart.length > 0 ? (
        <Section id="home-chart" title="Top 10 today" hint="See all" href={paths.discover} reduced={reduced}>
          <ol className="chart-grid">
            {chart.map((song, index) => {
              const current = song.id === currentSongId;
              const plays = formatPlays(song.playCount);
              return (
                <li key={song.id} className={`chart-row ${current ? 'is-current' : ''}`}>
                  <button
                    type="button"
                    className="chart-row-main"
                    onClick={() => (current ? onToggle() : onPlay(song, [...chart]))}
                    aria-label={`${current && isPlaying ? 'Pause' : 'Play'} ${song.title}`}
                  >
                    <span className="chart-rank" aria-hidden="true">{index + 1}</span>
                    <span className="chart-art">
                      <Artwork song={song} size="small" />
                      <span className="chart-play">
                        {current && isPlaying
                          ? <Pause size={14} fill="currentColor" aria-hidden="true" />
                          : <Play size={14} fill="currentColor" aria-hidden="true" />}
                      </span>
                    </span>
                    <span className="chart-copy">
                      <strong title={song.title}>{song.title}</strong>
                      <small title={song.artist}>{song.artist}{plays ? ` · ${plays}` : ''}</small>
                    </span>
                  </button>
                  <IconButton
                    icon={Heart}
                    className="chart-like"
                    label={likedIds.has(song.id) ? 'Remove from likes' : 'Add to likes'}
                    active={likedIds.has(song.id)}
                    onClick={() => onLike(song)}
                  />
                </li>
              );
            })}
          </ol>
        </Section>
      ) : null}

      {madeForYou.length > 0 ? (
        <Shelf id="home-loved" title="Loved right now" hint="What everyone has on" songs={madeForYou.slice(0, 14)} {...{ reduced, currentSongId, isPlaying, likedIds, onPlay, onLike }} />
      ) : null}

      {recommended.length > 0 ? (
        <Shelf id="home-fresh" title="Somewhere new to wander" hint="See all" href={paths.discover} songs={recommended.slice(0, 14)} {...{ reduced, currentSongId, isPlaying, likedIds, onPlay, onLike }} />
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- sections */

interface SectionProps {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly href?: string;
  readonly eyebrow?: ReactNode;
  readonly reduced: boolean | null;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}

/**
 * Every band on the page arrives the same way: it rises into place the first time it is
 * scrolled to. Reduced motion gets the content with no entrance at all.
 */
function Section({ id, title, hint, href, eyebrow, reduced, actions, children }: SectionProps) {
  const reveal = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 18 },
        whileInView: { opacity: 1, y: 0 },
        viewport: { once: true, amount: 0.12 },
        transition: { duration: motionTokens.duration.slow, ease: motionTokens.ease.decelerate }
      };
  return (
    <motion.section className="home-section" aria-labelledby={id} {...reveal}>
      <div className="section-heading">
        <div>
          {eyebrow ? <span className="eyebrow eyebrow-accent">{eyebrow}</span> : null}
          <h2 id={id}>{title}</h2>
        </div>
        <div className="section-heading-end">
          {actions}
          {href ? <Link className="shelf-link" href={href}>{hint ?? 'See all'}</Link> : hint ? <span className="result-count">{hint}</span> : null}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

interface ShelfScroll {
  readonly ref: RefObject<HTMLDivElement | null>;
  readonly atStart: boolean;
  readonly atEnd: boolean;
  readonly nudge: (direction: -1 | 1) => void;
}

/**
 * Arrow paging for a horizontal shelf. The arrows sit on top of the native scroll rather than
 * replacing it, and only show where there is a pointer — touch already has the gesture.
 */
function useShelfScroll(itemCount: number, reduced: boolean | null): ShelfScroll {
  const ref = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft >= max - 4);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // Tiles are images: the shelf only reaches its real width once they have laid out.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure, itemCount]);

  const nudge = useCallback((direction: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const step = Math.max(240, el.clientWidth * 0.8);
    el.scrollBy({ left: direction * step, behavior: reduced ? 'auto' : 'smooth' });
  }, [reduced]);

  return { ref, atStart, atEnd, nudge };
}

function ShelfArrows({ scroll, label }: { readonly scroll: ShelfScroll; readonly label: string }) {
  if (scroll.atStart && scroll.atEnd) return null;
  return (
    <div className="shelf-arrows">
      <button type="button" className="shelf-arrow" onClick={() => scroll.nudge(-1)} disabled={scroll.atStart} aria-label={`Scroll ${label} back`}>
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <button type="button" className="shelf-arrow" onClick={() => scroll.nudge(1)} disabled={scroll.atEnd} aria-label={`Scroll ${label} forward`}>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
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
  readonly reduced: boolean | null;
  readonly currentSongId: string | null;
  readonly isPlaying: boolean;
  readonly likedIds: ReadonlySet<string>;
  readonly onPlay: (song: UnifiedSong, queue: UnifiedSong[]) => void;
  readonly onLike: (song: UnifiedSong) => void;
}

function Shelf({ id, title, hint, href, eyebrow, songs, reduced, currentSongId, isPlaying, likedIds, onPlay, onLike }: ShelfProps) {
  const queue = useMemo(() => [...songs], [songs]);
  const scroll = useShelfScroll(songs.length, reduced);
  const sectionProps = {
    id,
    title,
    reduced,
    ...(hint ? { hint } : {}),
    ...(href ? { href } : {}),
    ...(eyebrow ? { eyebrow } : {})
  };
  return (
    <Section {...sectionProps} actions={<ShelfArrows scroll={scroll} label={title} />}>
      <div className="shelf" ref={scroll.ref}>
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
    </Section>
  );
}

interface PlaylistsShelfProps {
  readonly playlists: readonly LibraryRecord[];
  readonly songs: ReadonlyMap<string, UnifiedSong>;
  readonly loading: boolean;
  readonly reduced: boolean | null;
  readonly onCreate: (name: string) => Promise<unknown>;
}

function PlaylistsShelf({ playlists, songs, loading, reduced, onCreate }: PlaylistsShelfProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const scroll = useShelfScroll(playlists.length, reduced);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim()) return;
    await onCreate(name);
    setName('');
    setCreating(false);
  };

  return (
    <Section
      id="home-playlists"
      title="Your playlists"
      hint="All playlists"
      href={paths.library}
      reduced={reduced}
      actions={<ShelfArrows scroll={scroll} label="Your playlists" />}
    >
      <div className="shelf shelf--playlists" ref={scroll.ref}>
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
    </Section>
  );
}
