import { ArrowUpRight, Compass, Disc3, Headphones, Heart as HeartIcon, PanelLeftClose, PanelLeftOpen, Pause, Play, Search, Waves } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { HomePayload, LyricLine, UnifiedSong } from '@shared/types';

import { LyricsPanel } from './components/LyricsPanel';
import { LibraryPage } from './components/LibraryPage';
import { DynamicAura } from './components/DynamicAura';
import { PlayerPanel } from './components/PlayerPanel';
import { SongCard } from './components/SongCard';
import { Turntable } from './components/Turntable';
import { WordsPage } from './components/WordsPage';
import { Visualizer } from './components/Visualizer';
import { Artwork, EmptyState, IconButton, OfflineToast, SkeletonCard, TactileButton } from './components/ui';
import { useAudioAnalyser } from './hooks/useAudioAnalyser';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { PlaylistsContext, usePlaylists } from './hooks/usePlaylists';
import { tapHaptic } from './lib/haptics';
import { DEFAULT_PALETTE, extractPalette } from './lib/palette';
import type { Palette } from './lib/palette';
import { ApiError, createAnonymousSession, fallbackLyrics, fetchHome, fetchLikedSongs, fetchLyrics, fetchRecentlyPlayed, fetchSuggestions, recordRecentlyPlayed, searchSongs, setLikedSong } from './lib/api';
import { formatTime, titleAccent } from './lib/utils';
import { itemVariants, motionTokens, pageVariants } from './motion';

const DEFAULT_QUERY = 'top songs';
type AppView = 'discover' | 'library' | 'words';
const MOOD_PROMPTS = ['late night', 'soft focus', 'Hindi essentials', 'golden hour'];

function curatedSongs(songs: UnifiedSong[]): UnifiedSong[] {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const baseTitle = song.title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const key = `${baseTitle}|${song.artist.replace(/\s+/g, ' ').trim().toLocaleLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 6);
}

export default function App() {
  const reduced = useReducedMotion();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [songs, setSongs] = useState<UnifiedSong[]>([]);
  const [featured, setFeatured] = useState<UnifiedSong[]>([]);
  const [home, setHome] = useState<HomePayload | null>(null);
  const [searching, setSearching] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likedSongs, setLikedSongs] = useState<UnifiedSong[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<UnifiedSong[]>([]);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [personalActionError, setPersonalActionError] = useState<string | null>(null);
  const [view, setView] = useState<AppView>(() => viewFromHash(window.location.hash));
  const [suggestions, setSuggestions] = useState<UnifiedSong[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const [ambientColor, setAmbientColor] = useState('#2d7fe4');
  const [motionPaused, setMotionPaused] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(() => window.localStorage.getItem('allegra-nav-collapsed') === 'true');
  const nowPlayingRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const lyricsGeneration = useRef(0);
  const audio = useAudioPlayer();
  const hasSongLoaded = audio.currentSong !== null;
  const playlists = usePlaylists();
  const transportRef = useRef(audio);
  transportRef.current = audio;
  const reloadPlaylists = playlists.reload;
  // The analyser only attaches once a song exists, so a reader who never presses
  // play never gets an AudioContext created on their behalf.
  const analyser = useAudioAnalyser(audio.audioRef, audio.currentSong !== null);
  const closePlayer = useCallback(() => {
    audio.stop();
    setPanelOpen(false);
  }, [audio.stop]);

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

  const loadHome = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setSearching(true);
    setSearchError(null);
    try {
      const payload = await fetchHome(signal);
      setHome(payload);
      setFeatured(payload.trending);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      try {
        const response = await searchSongs(DEFAULT_QUERY, signal);
        setHome(null);
        setFeatured(response.results);
        setSearchError(null);
      } catch (fallbackError) {
        if (fallbackError instanceof DOMException && fallbackError.name === 'AbortError') return;
        setSearchError(fallbackError instanceof Error ? fallbackError.message : error instanceof Error ? error.message : 'Something went wrong. Try again.');
      }
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadHome(controller.signal);
    return () => controller.abort();
  }, [loadHome]);

  const loadPersonalSpace = useCallback(async (): Promise<void> => {
    setPersonalLoading(true);
    setPersonalError(null);
    try {
      let token = window.localStorage.getItem('allegra-session-token');
      if (!token) {
        const session = await createAnonymousSession();
        token = session.token;
        window.localStorage.setItem('allegra-session-token', token);
      }
      const [liked, recent] = await Promise.all([fetchLikedSongs(), fetchRecentlyPlayed(), reloadPlaylists()]).then(([likedSongs, recentSongs]) => [likedSongs, recentSongs] as const);
      setLikedSongs(liked);
      setLikedIds(new Set(liked.map((song) => song.id)));
      setRecentlyPlayed(recent);
    } catch (error) {
      setPersonalError(error instanceof Error ? error.message : 'Your listening room could not be loaded.');
    } finally {
      setPersonalLoading(false);
    }
  }, [reloadPlaylists]);

  useEffect(() => {
    void loadPersonalSpace();
  }, [loadPersonalSpace]);

  useEffect(() => {
    const syncView = (): void => setView(viewFromHash(window.location.hash));
    window.addEventListener('hashchange', syncView);
    syncView();
    return () => window.removeEventListener('hashchange', syncView);
  }, []);

  useEffect(() => {
    if (view !== 'discover') window.scrollTo({ top: 0, behavior: 'auto' });
    window.requestAnimationFrame(() => mainRef.current?.focus({ preventScroll: true }));
  }, [view]);

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
    if (!hasSongLoaded) return undefined;
    // Space toggles playback and the arrows seek 5 s, unless a control that
    // already owns the key (a field, button, link or the scrubber) has focus.
    const onTransportKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest('input, textarea, select, button, a, [role="slider"], [role="checkbox"], [contenteditable="true"]')) return;
      if (event.key === ' ') {
        event.preventDefault();
        transportRef.current.togglePlayback();
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        void transportRef.current.seek(transportRef.current.currentTime + (event.key === 'ArrowRight' ? 5 : -5));
      }
    };
    window.addEventListener('keydown', onTransportKey);
    return () => window.removeEventListener('keydown', onTransportKey);
  }, [hasSongLoaded]);

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

  useEffect(() => {
    const song = audio.currentSong;
    if (view !== 'words' || !song) {
      setSuggestions([]);
      setSuggestionsError(null);
      setSuggestionsLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    void fetchSuggestions(song.id, controller.signal)
      .then(setSuggestions)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setSuggestionsError(error instanceof Error ? error.message : 'Suggestions could not be loaded.');
      })
      .finally(() => setSuggestionsLoading(false));
    return () => controller.abort();
  }, [audio.currentSong, view]);

  const displaySongs = query.trim() ? songs : curatedSongs(featured);
  const activeSong = audio.currentSong ?? displaySongs[0] ?? null;
  const queueSongs = audio.queue.length > 0 ? audio.queue : displaySongs;
  const nextSongs = queueSongs.filter((song) => song.id !== activeSong?.id).slice(0, 3);
  const lightSong = nextSongs[0] ?? activeSong ?? home?.madeForYou[0] ?? home?.recommended[0] ?? null;
  const queueDuration = useMemo(() => queueSongs.reduce((total, song) => total + song.duration, 0), [queueSongs]);
  const isCurrent = activeSong !== null && audio.currentSong?.id === activeSong.id;
  const featureRemaining = isCurrent && audio.duration > 0
    ? Math.max(0, audio.duration - audio.currentTime)
    : activeSong?.duration ?? 0;
  const featureState = !isCurrent
    ? 'Ready'
    : audio.isBuffering
      ? 'Buffering'
      : audio.isPlaying
        ? 'Live'
        : 'Paused';
  const sectionLabel = query.trim() ? `Results for “${query.trim()}”` : 'Made for you';

  useEffect(() => {
    if (!activeSong) return undefined;
    setAmbientColor(titleAccent(activeSong.title));
    const controller = new AbortController();
    void extractPalette(activeSong.artwork, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setPalette(next);
      setAmbientColor(next.primary);
    });
    return () => controller.abort();
  }, [activeSong]);

  const hasSong = audio.currentSong !== null;

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    // Reduced motion and ambient pause both hold the light at its resting size.
    if (!hasSong || reduced || motionPaused) {
      shell.style.setProperty('--audio-level', '0');
      return undefined;
    }
    let frame = 0;
    const tick = (): void => {
      shell.style.setProperty('--audio-level', analyser.readLevel().toFixed(3));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      shell.style.setProperty('--audio-level', '0');
    };
    /*
     * Deliberately keyed on "a song is loaded", not on isPlaying. Keying it on
     * play state tore the loop down and wrote the resting value on every pause,
     * including the momentary pauses a seek performs, which made the light snap.
     * readLevel already decays to zero on its own when the element is not
     * producing sound, so pausing looks the same without the churn.
     */
  }, [analyser, hasSong, motionPaused, reduced]);

  const playSong = (song: UnifiedSong, queue: UnifiedSong[] = displaySongs): void => {
    audio.selectSong(song, queue);
    setRecentlyPlayed((current) => [song, ...current.filter((item) => item.id !== song.id)].slice(0, 50));
    void recordRecentlyPlayed(song.id, 0).catch(() => undefined);
    tapHaptic();

  };

  const toggleLike = (song: UnifiedSong): void => {
    const wasLiked = likedIds.has(song.id);
    const nextLiked = !wasLiked;
    setPersonalActionError(null);
    setLikedIds((current) => {
      const next = new Set(current);
      if (next.has(song.id)) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
    setLikedSongs((current) => nextLiked ? [song, ...current.filter((item) => item.id !== song.id)] : current.filter((item) => item.id !== song.id));
    void setLikedSong(song.id, nextLiked).catch((error: unknown) => {
      setLikedIds((current) => {
        const rollback = new Set(current);
        if (wasLiked) rollback.add(song.id);
        else rollback.delete(song.id);
        return rollback;
      });
      setLikedSongs((current) => wasLiked ? [song, ...current.filter((item) => item.id !== song.id)] : current.filter((item) => item.id !== song.id));
      setPersonalActionError(error instanceof Error ? error.message : 'That change could not be saved.');
    });
  };

  const toggleNavigation = (): void => {
    setNavCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem('allegra-nav-collapsed', String(next));
      return next;
    });
  };

  const retryCurrentSearch = (): void => query.trim() ? void loadSearch(query.trim()) : void loadHome();
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

  const retrySuggestions = (): void => {
    const song = audio.currentSong;
    if (!song) return;
    setSuggestionsLoading(true);
    setSuggestionsError(null);
    void fetchSuggestions(song.id)
      .then(setSuggestions)
      .catch((error: unknown) => setSuggestionsError(error instanceof Error ? error.message : 'Suggestions could not be loaded.'))
      .finally(() => setSuggestionsLoading(false));
  };

  const pageTransition = reduced ? { duration: motionTokens.duration.instant } : undefined;
  // Memoised: the Visualizer keeps this in an effect dependency array, and a
  // fresh array each render would restart its canvas loop on every timeupdate.
  const visualizerColors = useMemo(
    (): readonly [string, string, string] => [palette.primary, palette.secondary, palette.tertiary],
    [palette.primary, palette.secondary, palette.tertiary]
  );

  const shellStyle = {
    '--ambient-accent': ambientColor,
    '--hero-art': activeSong?.artwork ? `url(${JSON.stringify(activeSong.artwork)})` : 'none',
    '--art-primary': palette.primary,
    '--art-secondary': palette.secondary,
    '--art-tertiary': palette.tertiary
  } as CSSProperties;

  return (
    <PlaylistsContext.Provider value={playlists}>
    <div ref={shellRef} className={`app-shell ${motionPaused ? 'is-motion-paused' : ''} ${navCollapsed ? 'is-nav-collapsed' : ''}`} data-motion-paused={motionPaused ? 'true' : undefined} data-nav-collapsed={navCollapsed ? 'true' : undefined} style={shellStyle}>
      <DynamicAura paused={motionPaused} />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <div className="site-header-top"><a className="brand" href="#discover" aria-label="Allegra home"><span className="brand-orbit" aria-hidden="true"><span /></span><span className="brand-label">allegra</span></a><button className="nav-collapse-toggle" type="button" aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={toggleNavigation}>{navCollapsed ? <PanelLeftOpen size={17} aria-hidden="true" /> : <PanelLeftClose size={17} aria-hidden="true" />}</button></div>
        <nav className="desktop-nav" aria-label="Primary navigation"><a className={`nav-link ${view === 'discover' ? 'is-active' : ''}`} aria-current={view === 'discover' ? 'page' : undefined} href="#discover"><Compass size={15} aria-hidden="true" /><span className="nav-label">Discover</span></a><a className={`nav-link ${view === 'library' ? 'is-active' : ''}`} aria-current={view === 'library' ? 'page' : undefined} href="#library"><HeartIcon size={15} aria-hidden="true" /><span className="nav-label">Library</span></a><a className={`nav-link ${view === 'words' ? 'is-active' : ''}`} aria-current={view === 'words' ? 'page' : undefined} href="#words"><Waves size={15} aria-hidden="true" /><span className="nav-label">Words</span></a></nav>
        <div className="header-actions"><span className="session-label"><i aria-hidden="true" /> Guest session</span><button className="motion-toggle icon-button" type="button" aria-label={motionPaused ? 'Resume background motion' : 'Pause background motion'} title={motionPaused ? 'Resume background motion' : 'Pause background motion'} onClick={() => setMotionPaused((value) => !value)}>{motionPaused ? <Play size={15} fill="currentColor" aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}</button></div>
      </header>

      <main id="main-content" ref={mainRef} tabIndex={-1} aria-label={view === 'library' ? 'Your listening library' : view === 'words' ? 'Song words' : 'Discover music'} className={`content-wrap ${view !== 'discover' ? 'inner-page-wrap' : ''}`}>
        {view === 'library' ? <LibraryPage likedSongs={likedSongs} recentlyPlayed={recentlyPlayed} likedIds={likedIds} loading={personalLoading} error={personalError} actionError={personalActionError} currentSongId={audio.currentSong?.id} isPlaying={audio.isPlaying} onPlay={playSong} onLike={toggleLike} onRetry={() => void loadPersonalSpace()} onDiscover={() => { window.location.hash = '#discover'; window.setTimeout(() => searchRef.current?.focus(), 0); }} /> : view === 'words' ? <WordsPage song={audio.currentSong} lines={lyrics} currentTime={audio.currentTime} lyricsLoading={lyricsLoading} lyricsError={lyricsError} suggestions={suggestions} suggestionsLoading={suggestionsLoading} suggestionsError={suggestionsError} likedIds={likedIds} isPlaying={audio.isPlaying} onRetryLyrics={retryLyrics} onRetrySuggestions={retrySuggestions} onSeek={(time) => void audio.seek(time)} onPlay={playSong} onLike={toggleLike} onDiscover={() => { window.location.hash = '#discover'; window.setTimeout(() => searchRef.current?.focus(), 0); }} /> : <>
        <motion.section className="hero-section" variants={pageVariants} initial="hidden" animate="visible" transition={pageTransition}>
          <motion.div className="hero-copy" variants={itemVariants}>
            <h1>Good music.<br /><em>Ready when you are.</em></h1>
            <p>Search a song, an artist, or a mood. Press play and let Allegra take care of what comes next.</p>
            <div className="hero-actions"><TactileButton variant="primary" icon={Play} onClick={() => activeSong ? playSong(activeSong) : searchRef.current?.focus()}>{activeSong ? 'Play something' : 'Start searching'}</TactileButton><button className="text-action" type="button" onClick={() => document.getElementById('queue')?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })}>Browse your queue <ArrowUpRight size={15} aria-hidden="true" /></button></div>
            <div className="search-anchor"><form className="search-box" onSubmit={(event) => event.preventDefault()} role="search"><Search size={19} aria-hidden="true" /><label className="sr-only" htmlFor="song-search">Search music</label><input ref={searchRef} id="song-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="What do you want to listen to?" autoComplete="off" />{query ? <button className="search-clear" type="button" onClick={() => setQuery('')} aria-label="Clear search">×</button> : <kbd>⌘ K</kbd>}</form></div>
          </motion.div>

          <motion.article ref={nowPlayingRef} className="hero-feature" variants={itemVariants} aria-label="Featured track" data-live={audio.isPlaying ? 'true' : undefined}>
            {activeSong ? <><div className="feature-topline"><span>{isCurrent ? 'Now playing' : 'Made for you'}</span><span>{featureState}</span></div><div className="feature-scene"><div className="feature-readout"><strong>{formatTime(featureRemaining)}</strong><span>{isCurrent && audio.duration > 0 ? 'left' : 'total'}</span><i aria-hidden="true" /></div><button className="feature-art-button" onClick={() => playSong(activeSong)} aria-label={`Play ${activeSong.title}`}><Turntable song={activeSong} playing={isCurrent && audio.isPlaying} layoutId={`art-${activeSong.id}`} /><span className="feature-play">{audio.isBuffering && isCurrent ? <Disc3 size={19} className="spin" aria-hidden="true" /> : isCurrent && audio.isPlaying ? <Pause size={19} fill="currentColor" aria-hidden="true" /> : <Play size={19} fill="currentColor" aria-hidden="true" />}</span></button></div><div className="feature-info"><div><h2>{activeSong.title}</h2><p>{activeSong.artist}</p></div><span className="feature-duration">{formatTime(activeSong.duration)}</span></div><Visualizer readSpectrum={analyser.readSpectrum} binCount={analyser.binCount} active={isCurrent && audio.isPlaying} paused={motionPaused} colors={visualizerColors} label={isCurrent && audio.isPlaying ? `Audio levels for ${activeSong.title}` : 'Audio levels, idle'} /><div className="feature-progress"><span style={{ transform: `scaleX(${audio.duration && isCurrent ? audio.currentTime / audio.duration : 0})` }} /></div><div className="feature-foot"><button type="button" className="feature-open" onClick={() => setPanelOpen(true)}>View player</button><span>{activeSong.language ?? 'Mixed'}</span></div></> : <div className="feature-loading"><Disc3 size={24} className="spin" aria-hidden="true" /><span>Loading your first song</span></div>}
          </motion.article>
        </motion.section>

        <section className="curiosity-strip" aria-labelledby="thread-heading"><h2 id="thread-heading">Quick picks</h2><div className="mood-pills">{MOOD_PROMPTS.map((prompt) => <button key={prompt} className="mood-pill" onClick={() => { setQuery(prompt); searchRef.current?.focus(); }}>{prompt}</button>)}</div></section>

        <div className="workspace-grid">
          <section className="catalog-section" aria-labelledby="catalog-heading" aria-busy={searching}><div className="section-heading"><h2 id="catalog-heading">{sectionLabel}</h2><span className="result-count" aria-live="polite">{searching ? 'Listening…' : `${displaySongs.length} tracks · ${formatTime(queueDuration)}`}</span></div>{searching && displaySongs.length === 0 ? <div className="track-list" aria-label="Loading songs"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div> : searchError && displaySongs.length === 0 ? <EmptyState title="That search did not come back" copy={searchError} action={<TactileButton variant="primary" onClick={retryCurrentSearch}>Try the search again</TactileButton>} /> : displaySongs.length === 0 ? <EmptyState title="Nothing came back" copy="Try an artist, a lyric, or a mood. Start with “Arijit Singh” or “late night.”" action={<TactileButton variant="accent" onClick={() => setQuery('Arijit Singh')}>Try a suggestion</TactileButton>} /> : <><div className="track-head" aria-hidden="true"><span>Track</span><span>Album</span><span>Length</span></div><motion.div className="track-list" variants={pageVariants} initial="hidden" animate="visible">{displaySongs.map((song, index) => <SongCard key={song.id} song={song} index={index} isCurrent={song.id === audio.currentSong?.id} isPlaying={song.id === audio.currentSong?.id && audio.isPlaying} onPlay={() => playSong(song)} onLike={() => toggleLike(song)} liked={likedIds.has(song.id)} />)}</motion.div></>}</section>

          <aside id="queue" className="queue-column" aria-label="Listening queue"><div className="queue-card"><div className="queue-heading"><h2>Up next</h2><span className="queue-mark"><Headphones size={15} aria-hidden="true" /></span></div><p className="queue-intro">Your next three picks.</p><div className="queue-items">{nextSongs.length > 0 ? nextSongs.map((song, index) => <button className="queue-item" key={song.id} onClick={() => playSong(song)}><span className="queue-item-number">{String(index + 1).padStart(2, '0')}</span><Artwork song={song} size="small" /><span className="queue-item-copy"><strong>{song.title}</strong><small>{song.artist}</small></span><span className="queue-item-time">{formatTime(song.duration)}</span></button>) : <div className="queue-empty"><Disc3 size={19} /><span>Choose a song to build your queue.</span></div>}</div><div className="queue-footer"><span>{queueSongs.length} tracks</span><span>{formatTime(queueDuration)}</span></div></div></aside>
        </div>

        <section id="daylight" className="light-scene" aria-labelledby="light-scene-heading">
          {lightSong ? <div className="light-scene-grid"><div className="light-scene-art"><button onClick={() => playSong(lightSong)} aria-label={`Play ${lightSong.title}`}><Artwork song={lightSong} size="large" /></button><div className="light-scene-track"><strong>{lightSong.title}</strong><span>{lightSong.artist}</span></div></div><div className="light-scene-copy"><h2 id="light-scene-heading">Keep listening</h2><p>One more track from your queue, ready when you are.</p><TactileButton variant="primary" icon={Play} aria-label={`Play ${lightSong.title}`} onClick={() => playSong(lightSong)}>Play next</TactileButton></div></div> : <div className="light-scene-empty"><Disc3 size={22} aria-hidden="true" /><p>Play something and your next pick shows up here.</p></div>}
        </section>

        <section id="words" className="lyrics-teaser"><div className="teaser-intro"><div><h2>Lyrics <em>in time</em></h2><p>Follow along with the song you are playing.</p></div><TactileButton variant="secondary" icon={Waves} onClick={() => activeSong && setPanelOpen(true)}>Open lyrics</TactileButton></div><LyricsPanel lines={lyrics} currentTime={audio.currentTime} loading={lyricsLoading} error={lyricsError} onRetry={retryLyrics} onSeek={(time) => void audio.seek(time)} /></section>
        </>}
      </main>

      {audio.currentSong ? <div className="now-playing-bar" role="region" aria-label="Mini player"><Artwork song={audio.currentSong} size="small" /><button className="mobile-track-button" onClick={() => setPanelOpen(true)}><strong>{audio.currentSong.title}</strong><span>{audio.currentSong.artist}</span></button><span className="mini-player-state">{audio.isBuffering ? 'Buffering' : audio.isPlaying ? 'Playing' : 'Paused'}</span><IconButton icon={audio.isPlaying ? Pause : Play} label={audio.isPlaying ? 'Pause' : 'Play'} onClick={audio.togglePlayback} /></div> : null}
      <p className="sr-only" aria-live="polite">{audio.currentSong ? `${audio.isPlaying ? 'Playing' : 'Paused'} ${audio.currentSong.title} by ${audio.currentSong.artist}` : ''}</p>
      <audio ref={audio.audioRef} className="audio-element" crossOrigin="anonymous" preload="metadata" aria-hidden="true" />
      <PlayerPanel song={panelOpen ? audio.currentSong : null} queue={audio.queue} currentTime={audio.currentTime} duration={audio.duration} isPlaying={audio.isPlaying} playbackError={audio.error} liked={audio.currentSong ? likedIds.has(audio.currentSong.id) : false} lyrics={{ lines: lyrics, currentTime: audio.currentTime, loading: lyricsLoading, error: lyricsError, onRetry: retryLyrics, onSeek: (time) => void audio.seek(time) }} accentColor={ambientColor} muted={audio.isMuted} onMute={audio.toggleMute} onClose={closePlayer} onToggle={audio.togglePlayback} onNext={audio.skipNext} onPrevious={audio.skipPrevious} onSeek={(time) => void audio.seek(time)} onLike={() => { if (audio.currentSong) toggleLike(audio.currentSong); }} />
      <OfflineToast visible={offline} />
    </div>
    </PlaylistsContext.Provider>
  );
}

function viewFromHash(hash: string): AppView {
  if (hash === '#library') return 'library';
  if (hash === '#words') return 'words';
  return 'discover';
}
