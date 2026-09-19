import { ArrowUpRight, Compass, Disc3, Headphones, Pause, Play, Search, Sparkles, Waves } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { LyricLine, UnifiedSong } from '@shared/types';

import { LyricsPanel } from './components/LyricsPanel';
import { PlayerPanel } from './components/PlayerPanel';
import { SongCard } from './components/SongCard';
import { Artwork, EmptyState, IconButton, OfflineToast, SkeletonCard, TactileButton } from './components/ui';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { ApiError, createAnonymousSession, fallbackLyrics, fetchLyrics, searchSongs } from './lib/api';
import { formatTime, titleAccent } from './lib/utils';
import { itemVariants, motionTokens, pageVariants } from './motion';

const DEFAULT_QUERY = 'top songs';
const MOOD_PROMPTS = ['late night', 'soft focus', 'Hindi essentials', 'golden hour'];

export default function App() {
  const reduced = useReducedMotion();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<UnifiedSong[]>([]);
  const [featured, setFeatured] = useState<UnifiedSong[]>([]);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [ambientColor, setAmbientColor] = useState('#a35f4a');
  const lyricsGeneration = useRef(0);
  const audio = useAudioPlayer();

  const loadSearch = useCallback(async (value: string, signal?: AbortSignal): Promise<void> => {
    setSearching(true);
    setSearchError(null);
    try {
      const response = await searchSongs(value, signal);
      if (value === DEFAULT_QUERY) setFeatured(response.results);
      else setSongs(response.results);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setSearchError(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadSearch(DEFAULT_QUERY, controller.signal);
    return () => controller.abort();
  }, [loadSearch]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSongs([]);
      setSearchError(null);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadSearch(trimmed, controller.signal), 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadSearch, query]);

  useEffect(() => {
    const onOffline = (): void => setOffline(true);
    const onOnline = (): void => setOffline(false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    const token = window.localStorage.getItem('allegra-session-token');
    if (token) return;
    void createAnonymousSession()
      .then(({ token: nextToken }) => window.localStorage.setItem('allegra-session-token', nextToken))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  useEffect(() => {
    const song = audio.currentSong;
    if (!song) {
      setLyrics([]);
      setLyricsError(null);
      return undefined;
    }
    const generation = ++lyricsGeneration.current;
    const controller = new AbortController();
    setLyricsLoading(true);
    setLyricsError(null);
    void fetchLyrics(song, controller.signal)
      .then((response) => {
        if (generation === lyricsGeneration.current) setLyrics(response.lines);
      })
      .catch((error: unknown) => {
        if (generation !== lyricsGeneration.current || (error instanceof DOMException && error.name === 'AbortError')) return;
        if (error instanceof ApiError && error.status === 404) {
          setLyrics(fallbackLyrics(song.duration));
          setLyricsError(null);
        } else {
          setLyrics([]);
          setLyricsError(error instanceof Error ? error.message : 'Lyrics could not be loaded.');
        }
      })
      .finally(() => {
        if (generation === lyricsGeneration.current) setLyricsLoading(false);
      });
    return () => controller.abort();
  }, [audio.currentSong]);

  const displaySongs = query.trim() ? songs : featured;
  const activeSong = audio.currentSong ?? displaySongs[0] ?? null;
  const queueSongs = audio.queue.length > 0 ? audio.queue : displaySongs;
  const nextSongs = queueSongs.filter((song) => song.id !== activeSong?.id).slice(0, 3);
  const lightSong = nextSongs[0] ?? activeSong;
  const queueDuration = useMemo(() => queueSongs.reduce((total, song) => total + song.duration, 0), [queueSongs]);
  const sectionLabel = query.trim() ? `Results for “${query.trim()}”` : 'A queue, not a feed.';

  useEffect(() => {
    if (!activeSong) return;
    setAmbientColor(titleAccent(activeSong.title));
    let disposed = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = activeSong.artwork;
    void image.decode()
      .then(() => {
        if (disposed) return;
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, 1, 1);
        const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
        setAmbientColor(`rgb(${red} ${green} ${blue})`);
      })
      .catch(() => undefined);
    return () => { disposed = true; };
  }, [activeSong]);

  const playSong = (song: UnifiedSong): void => {
    audio.selectSong(song, displaySongs);
    setPanelOpen(true);
  };

  const toggleLike = (song: UnifiedSong): void => {
    setLikedIds((current) => {
      const next = new Set(current);
      if (next.has(song.id)) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
  };

  const retryCurrentSearch = (): void => void loadSearch(query.trim() || DEFAULT_QUERY);
  const retryLyrics = (): void => {
    const song = audio.currentSong;
    if (!song) return;
    setLyricsLoading(true);
    setLyricsError(null);
    void fetchLyrics(song)
      .then((response) => setLyrics(response.lines))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) setLyrics(fallbackLyrics(song.duration));
        else setLyricsError(error instanceof Error ? error.message : 'Lyrics could not be loaded.');
      })
      .finally(() => setLyricsLoading(false));
  };

  const pageTransition = reduced ? { duration: motionTokens.duration.instant } : undefined;
  const shellStyle = { '--ambient-accent': ambientColor } as CSSProperties;

  return (
    <div className="app-shell" style={shellStyle}>
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <header className="site-header">
        <a className="brand" href="#discover" aria-label="Allegra home"><span className="brand-orbit" aria-hidden="true"><span /></span><span>allegra</span></a>
        <nav className="desktop-nav" aria-label="Primary navigation"><a className="nav-link is-active" href="#discover"><Compass size={15} aria-hidden="true" /> Discover</a><a className="nav-link" href="#words"><Waves size={15} aria-hidden="true" /> Words</a></nav>
        <div className="header-actions"><span className="session-label"><i /> Guest session</span><span className="header-rule" aria-hidden="true" /><span className="header-date">SEP / 26</span></div>
      </header>

      <main id="discover" className="content-wrap">
        <motion.section className="hero-section" variants={pageVariants} initial="hidden" animate="visible" transition={pageTransition}>
          <motion.div className="hero-copy" variants={itemVariants}>
            <span className="eyebrow eyebrow-accent"><Sparkles size={13} aria-hidden="true" /> A live listening room</span>
            <h1>Find the song<br /><em>that stays.</em></h1>
            <p>Allegra turns a search into a small, cinematic place to land — real music, real words, no rush.</p>
            <div className="hero-actions"><TactileButton variant="primary" icon={Search} onClick={() => searchRef.current?.focus()}>Start searching</TactileButton><button className="text-action" onClick={() => setQuery('late night')}>Surprise me <ArrowUpRight size={15} aria-hidden="true" /></button></div>
            <div className="search-anchor"><form className="search-box" onSubmit={(event) => event.preventDefault()} role="search"><Search size={19} aria-hidden="true" /><label className="sr-only" htmlFor="song-search">Search music</label><input ref={searchRef} id="song-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a song, artist, or feeling" autoComplete="off" />{query ? <button className="search-clear" type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button> : <kbd>⌘ K</kbd>}</form></div>
            <div className="hero-footnote"><span>01</span><p>Search → choose → stay with it.</p></div>
          </motion.div>

          <motion.article className="hero-feature" variants={itemVariants} aria-label="Featured track">
            {activeSong ? <><div className="feature-topline"><span>Now in rotation</span><span>01 / {String(displaySongs.length).padStart(2, '0')}</span></div><button className="feature-art-button" onClick={() => playSong(activeSong)} aria-label={`Play ${activeSong.title}`}><Artwork song={activeSong} size="large" /><span className="feature-play"><Play size={17} fill="currentColor" aria-hidden="true" /></span></button><div className="feature-info"><div><span className="eyebrow">Featured today</span><h2>{activeSong.title}</h2><p>{activeSong.artist}</p></div><span className="feature-duration">{formatTime(activeSong.duration)}</span></div><div className="feature-progress"><span style={{ transform: `scaleX(${audio.duration ? audio.currentTime / audio.duration : 0})` }} /></div><div className="feature-foot"><span>{audio.isPlaying ? 'Playing now' : 'Ready when you are'}</span><span>{activeSong.language ?? 'Mixed'}</span></div></> : <div className="feature-loading"><Disc3 size={25} /><span>Finding your first song…</span></div>}
          </motion.article>
        </motion.section>

        <section className="curiosity-strip" aria-labelledby="thread-heading"><div><span className="eyebrow">Follow a thread</span><h2 id="thread-heading">What are you in the mood for?</h2></div><div className="mood-pills">{MOOD_PROMPTS.map((prompt) => <button key={prompt} className="mood-pill" onClick={() => { setQuery(prompt); searchRef.current?.focus(); }}>{prompt}</button>)}</div></section>

        <div className="workspace-grid">
          <section className="catalog-section" aria-labelledby="catalog-heading"><div className="section-heading"><div><span className="eyebrow">{query.trim() ? 'The searchlight' : 'A handpicked start'}</span><h2 id="catalog-heading">{sectionLabel}</h2></div><span className="result-count">{searching ? 'Listening…' : `${displaySongs.length} tracks · ${formatTime(queueDuration)}`}</span></div>{searching && displaySongs.length === 0 ? <div className="track-list" aria-label="Loading songs"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div> : searchError && displaySongs.length === 0 ? <EmptyState title="The signal wandered" copy={searchError} action={<TactileButton variant="primary" onClick={retryCurrentSearch}>Try the search again</TactileButton>} /> : displaySongs.length === 0 ? <EmptyState title="Nothing came back" copy="Try an artist, a lyric, or a mood. Start with “Arijit Singh” or “late night.”" action={<TactileButton variant="accent" onClick={() => setQuery('Arijit Singh')}>Try a suggestion</TactileButton>} /> : <><div className="track-head" aria-hidden="true"><span>Track</span><span>Album</span><span>Length</span></div><motion.div className="track-list" variants={pageVariants} initial="hidden" animate="visible">{displaySongs.map((song, index) => <SongCard key={song.id} song={song} index={index} isCurrent={song.id === audio.currentSong?.id} isPlaying={song.id === audio.currentSong?.id && audio.isPlaying} onPlay={() => playSong(song)} onLike={() => toggleLike(song)} liked={likedIds.has(song.id)} />)}</motion.div></>}</section>

          <aside className="queue-column" aria-label="Listening queue"><div className="queue-card"><div className="queue-heading"><div><span className="eyebrow">A little ahead</span><h2>Next up</h2></div><span className="queue-mark"><Headphones size={14} aria-hidden="true" /></span></div><p className="queue-intro">Keep the room moving, one song at a time.</p><div className="queue-items">{nextSongs.length > 0 ? nextSongs.map((song, index) => <button className="queue-item" key={song.id} onClick={() => playSong(song)}><span className="queue-item-number">{String(index + 1).padStart(2, '0')}</span><Artwork song={song} size="small" /><span className="queue-item-copy"><strong>{song.title}</strong><small>{song.artist}</small></span><span className="queue-item-time">{formatTime(song.duration)}</span></button>) : <div className="queue-empty"><Disc3 size={19} /><span>Choose a song to build your queue.</span></div>}</div><div className="queue-footer"><span>{queueSongs.length} tracks</span><span>{formatTime(queueDuration)} of atmosphere</span></div></div><div className="quote-card"><span className="quote-mark">“</span><p>The right song doesn’t fill the silence. It gives it a shape.</p><span className="quote-caption">— the Allegra principle</span></div></aside>
        </div>

        <section className="light-scene" aria-labelledby="light-scene-heading">
          <div className="light-scene-topline"><span>SCENE / 02 — DAYLIGHT MIX</span><span>TURN THE ROOM OVER</span></div>
          {lightSong ? <div className="light-scene-grid"><div className="light-scene-copy"><span className="eyebrow">A different light</span><h2 id="light-scene-heading">Some songs arrive<br /><em>like daylight.</em></h2><p>Leave the dark room for a minute. Keep the thread — just let it open up.</p><TactileButton variant="primary" icon={Play} onClick={() => playSong(lightSong)}>Play {lightSong.title}</TactileButton></div><div className="light-scene-art"><div className="light-scene-art-label"><span>UP NEXT</span><span>{lightSong.language ?? 'MIXED'}</span></div><button onClick={() => playSong(lightSong)} aria-label={`Play ${lightSong.title}`}><Artwork song={lightSong} size="large" /></button><div className="light-scene-track"><strong>{lightSong.title}</strong><span>{lightSong.artist}</span></div></div></div> : <div className="light-scene-empty"><Disc3 size={24} /><p>Choose a track and the room will find its daylight.</p></div>}
          <div className="light-scene-footer"><span>ALLEGRA / 02</span><span>THE SAME QUEUE, A NEW TEMPERATURE</span></div>
        </section>

        <section id="words" className="lyrics-teaser"><div className="teaser-intro"><span className="eyebrow">Words in the air</span><h2>Let the song<br /><em>say it for you.</em></h2><p>Time-synced when we can find it. Gently interpolated when we cannot.</p><TactileButton variant="secondary" icon={Waves} onClick={() => activeSong && setPanelOpen(true)}>Open lyrics</TactileButton></div><LyricsPanel lines={lyrics} currentTime={audio.currentTime} loading={lyricsLoading} error={lyricsError} onRetry={retryLyrics} onSeek={(time) => void audio.seek(time)} /></section>
      </main>

      {audio.currentSong ? <div className="mobile-now-bar"><Artwork song={audio.currentSong} size="small" /><button className="mobile-track-button" onClick={() => setPanelOpen(true)}><strong>{audio.currentSong.title}</strong><span>{audio.currentSong.artist}</span></button><IconButton icon={audio.isPlaying ? Pause : Play} label={audio.isPlaying ? 'Pause' : 'Play'} onClick={audio.togglePlayback} /></div> : null}
      <audio ref={audio.audioRef} className="audio-element" crossOrigin="anonymous" preload="metadata" aria-hidden="true" />
      <PlayerPanel song={panelOpen ? audio.currentSong : null} queue={audio.queue} currentTime={audio.currentTime} duration={audio.duration} isPlaying={audio.isPlaying} playbackError={audio.error} liked={audio.currentSong ? likedIds.has(audio.currentSong.id) : false} lyrics={{ lines: lyrics, currentTime: audio.currentTime, loading: lyricsLoading, error: lyricsError, onRetry: retryLyrics, onSeek: (time) => void audio.seek(time) }} accentColor={ambientColor} muted={audio.isMuted} onMute={audio.toggleMute} onClose={() => setPanelOpen(false)} onToggle={audio.togglePlayback} onNext={audio.skipNext} onPrevious={audio.skipPrevious} onSeek={(time) => void audio.seek(time)} onLike={() => { if (audio.currentSong) toggleLike(audio.currentSong); }} />
      <OfflineToast visible={offline} />
      <span className="build-label">ALLEGRA / LISTENING ROOM 01</span>
    </div>
  );
}
