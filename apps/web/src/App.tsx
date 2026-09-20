import { ArrowLeft, ChevronRight, House, Heart as HeartIcon, Moon, Sun, Disc3, Pause, Play, SkipBack, SkipForward, Sparkles, Waves, Clock, Compass, Library as LibraryIcon, ListMusic, PanelLeftClose, PanelLeftOpen, Repeat, Repeat1, Shuffle, Volume2, VolumeX } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';

import type { ArtistProfile, HomePayload, LyricLine, SharedPlaylist, UnifiedSong } from '@shared/types';

import { AlbumPage } from './components/AlbumPage';
import { ArtistPage } from './components/ArtistPage';
import { CollectionPage } from './components/CollectionPage';
import { ArtistPreviewCard } from './components/ArtistPreviewCard';
import type { RelatedArtist } from './components/ArtistPage';
import { LyricsPanel } from './components/LyricsPanel';
import { LibraryPage } from './components/LibraryPage';
import { DynamicAura } from './components/DynamicAura';
import { AuthDialog } from './components/AuthDialog';
import type { AuthMode } from './components/AuthDialog';
import { CommandPalette } from './components/CommandPalette';
import { HomePage } from './components/HomePage';
import { PlayerPanel } from './components/PlayerPanel';
import { MusicFlowShader } from './components/shader/MusicFlowShader';
import type { ImmersivePlayerMode } from './components/PlayerPanel';
import { SongCard } from './components/SongCard';
import { WordsPage } from './components/WordsPage';
import { Artwork, EmptyState, IconButton, OfflineToast, SkeletonCard, TactileButton } from './components/ui';
import { useAudioAnalyser } from './hooks/useAudioAnalyser';
import { useAccount, useListenTracker } from './hooks/useAccount';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { PlaylistsContext, usePlaylists } from './hooks/usePlaylists';
import { collectAlbumTracks } from './lib/album';
import { tapHaptic } from './lib/haptics';
import { DEFAULT_PALETTE, extractPalette, shadePalette } from './lib/palette';
import type { Palette } from './lib/palette';
import { ApiError, ensureSession, fetchArtist, fetchArtistFaces, fallbackLyrics, fetchAiRecommendations, fetchHome, fetchLikedSongs, fetchLyrics, fetchRecentlyPlayed, fetchSharedPlaylist, fetchSuggestions, recordRecentlyPlayed, saveSharedPlaylist, searchSongs, setLikedSong, translateLyrics } from './lib/api';
import { formatTime, titleAccent } from './lib/utils';
import { itemVariants, motionTokens, pageVariants, spring } from './motion';

const DEFAULT_QUERY = 'top songs';
type AppView = 'home' | 'discover' | 'library' | 'words' | 'album' | 'artist' | 'playlist' | 'liked' | 'shared';
type PlayerMode = 'mini' | ImmersivePlayerMode;
const MOOD_PROMPTS = ['late night', 'soft focus', 'Hindi essentials', 'golden hour'];

/** Every credited name on a song ("A, B & C feat. D"), in order. */
function creditedNames(song: UnifiedSong): string[] {
  return song.artist.split(/,|&| feat\.? /i).map((part) => part.trim()).filter(Boolean);
}

/** One entry per artist, each with a song to borrow artwork from. */
function uniqueArtists(songs: readonly UnifiedSong[], limit: number, exclude: string | null = null, allCredits = false): { name: string; song: UnifiedSong }[] {
  const seen = new Set<string>(exclude ? [exclude.toLocaleLowerCase()] : []);
  const list: { name: string; song: UnifiedSong }[] = [];
  for (const song of songs) {
    const names = allCredits ? creditedNames(song) : creditedNames(song).slice(0, 1);
    for (const name of names) {
      const key = name.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ name, song });
      if (list.length >= limit) return list;
    }
  }
  return list;
}

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
  const [paletteOpen, setPaletteOpen] = useState(false);
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
  const [translatedLyrics, setTranslatedLyrics] = useState<LyricLine[] | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [translateProvider, setTranslateProvider] = useState<string | null>(null);
  const [playerMode, setPlayerMode] = useState<PlayerMode>('mini');
  const [albumSeed, setAlbumSeed] = useState<UnifiedSong | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [likedSongs, setLikedSongs] = useState<UnifiedSong[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<UnifiedSong[]>([]);
  const [personalLoading, setPersonalLoading] = useState(true);
  const [personalError, setPersonalError] = useState<string | null>(null);
  const [personalActionError, setPersonalActionError] = useState<string | null>(null);
  const [aiPicks, setAiPicks] = useState<UnifiedSong[]>([]);
  const [aiPicksReasoning, setAiPicksReasoning] = useState<string | null>(null);
  const [aiPicksProvider, setAiPicksProvider] = useState<string | null>(null);
  const [view, setView] = useState<AppView>(() => viewFromHash(window.location.hash));
  const [artistName, setArtistName] = useState<string | null>(() => artistFromHash(window.location.hash));
  const [playlistId, setPlaylistId] = useState<string | null>(() => playlistFromHash(window.location.hash));
  const [sharedCode, setSharedCode] = useState<string | null>(() => sharedFromHash(window.location.hash));
  const [shared, setShared] = useState<SharedPlaylist | null>(null);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signUp');
  const [artistSongs, setArtistSongs] = useState<UnifiedSong[]>([]);
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  // Artist photos by lower-cased name. An empty string means "looked up, no photo", so we never ask twice.
  const [faces, setFaces] = useState<Record<string, string>>({});
  const [artistError, setArtistError] = useState<string | null>(null);
  const [artistReload, setArtistReload] = useState(0);
  const [suggestions, setSuggestions] = useState<UnifiedSong[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  const [ambientColor, setAmbientColor] = useState('#2d7fe4');
  const [motionPaused, setMotionPaused] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try { return window.localStorage.getItem('allegra-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  const toggleTheme = (): void => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem('allegra-theme', next); } catch { /* storage unavailable: the choice just won't persist */ }
      return next;
    });
  };
  const [navCollapsed, setNavCollapsed] = useState(() => {
    try { return window.localStorage.getItem('allegra-nav-collapsed') === 'true'; } catch { return false; }
  });
  const toggleNavigation = (): void => {
    setNavCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem('allegra-nav-collapsed', String(next)); } catch { /* storage unavailable: the choice just won't persist */ }
      return next;
    });
  };
  const [queueOpen, setQueueOpen] = useState(false);
  useEffect(() => {
    if (!queueOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setQueueOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [queueOpen]);
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
  const collapsePlayer = useCallback(() => {
    setPlayerMode('mini');
  }, []);

  const openAlbum = useCallback((song: UnifiedSong) => {
    setAlbumSeed(song);
    window.location.hash = '#album';
  }, []);

  const openLibrarySection = useCallback((event: MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    event.preventDefault();
    const alreadyThere = window.location.hash === '#library';
    if (!alreadyThere) window.location.hash = '#library';
    // The library renders after the route changes; wait a beat before scrolling to the section.
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), alreadyThere ? 0 : 400);
  }, []);

  // Steps taken inside the app. Back only walks browser history when there is in-app history to walk,
  // so a page opened straight from a link falls back to a sensible parent instead of leaving the site.
  const navDepthRef = useRef(0);
  const goBack = useCallback((fallback: string) => {
    if (navDepthRef.current > 0) {
      navDepthRef.current -= 2;
      window.history.back();
    } else {
      window.location.hash = fallback;
    }
  }, []);

  const openArtist = useCallback((name: string) => {
    window.location.hash = `#artist/${encodeURIComponent(name)}`;
  }, []);

  /** Albums from the artist page: open the album when one of its songs is loaded, otherwise search for it. */
  const openAlbumByName = useCallback((albumName: string, seed: UnifiedSong | null) => {
    if (seed) {
      openAlbum(seed);
      return;
    }
    window.location.hash = '#discover';
    setQuery(`${albumName} ${artistName ?? ''}`.trim());
  }, [openAlbum, artistName]);

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
      await ensureSession();
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

  // Who is listening (guest or account) and what we have learned about their taste. Signing in or out reloads everything personal.
  const account = useAccount(() => {
    void loadPersonalSpace();
  });
  useListenTracker(audio.currentSong ?? null, audio.currentTime, account.refresh);

  // A shared playlist opened by link: public, so it works before anyone has signed in.
  useEffect(() => {
    if (!sharedCode) {
      setShared(null);
      setSharedError(null);
      return undefined;
    }
    const controller = new AbortController();
    setSharedLoading(true);
    setSharedError(null);
    fetchSharedPlaylist(sharedCode, controller.signal)
      .then((payload) => setShared(payload))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setShared(null);
        setSharedError(error instanceof Error ? error.message : 'That playlist could not be opened.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setSharedLoading(false);
      });
    return () => controller.abort();
  }, [sharedCode]);

  useEffect(() => {
    const syncView = (): void => {
      setView(viewFromHash(window.location.hash));
      setArtistName(artistFromHash(window.location.hash));
      setPlaylistId(playlistFromHash(window.location.hash));
      setSharedCode(sharedFromHash(window.location.hash));
    };
    const onHashChange = (): void => {
      navDepthRef.current += 1;
      syncView();
    };
    window.addEventListener('hashchange', onHashChange);
    syncView();
    return () => window.removeEventListener('hashchange', onHashChange);
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
        setPaletteOpen((open) => !open);
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
    setTranslatedLyrics(null);
    setShowTranslated(false);
    setTranslateError(null);
    setTranslateProvider(null);
  }, [audio.currentSong?.id]);

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

  // The recommender needs something to reason from. With a brand-new guest — no
  // likes, no history, no taste, nothing playing — it can only answer "not enough
  // listening history", so asking at all would just be a guaranteed 404 on every
  // first load. Wait until there is a signal worth sending.
  const hasTasteSignal =
    likedSongs.length > 0 ||
    recentlyPlayed.length > 0 ||
    (account.taste?.topArtists?.length ?? 0) > 0 ||
    Boolean(audio.currentSong?.id);

  useEffect(() => {
    if (personalLoading || !hasTasteSignal) return undefined;
    const controller = new AbortController();
    fetchAiRecommendations(audio.currentSong?.id, controller.signal)
      .then((response) => {
        setAiPicks(response.songs);
        setAiPicksReasoning(response.reasoning);
        setAiPicksProvider(response.provider);
      })
      .catch(() => {
        // Optional enhancement — quietly stay empty if unavailable (no key configured, no history yet, etc).
        setAiPicks([]);
      });
    return () => controller.abort();
  }, [audio.currentSong?.id, personalLoading, hasTasteSignal]);

  const displaySongs = query.trim() ? songs : curatedSongs(featured);
  const activeSong = audio.currentSong ?? displaySongs[0] ?? null;
  const displayLyrics = showTranslated && translatedLyrics ? translatedLyrics : lyrics;
  const queueSongs = audio.queue.length > 0 ? audio.queue : displaySongs;
  const nextSongs = queueSongs.filter((song) => song.id !== activeSong?.id).slice(0, 3);
  const lightSong = nextSongs[0] ?? activeSong ?? home?.madeForYou[0] ?? home?.recommended[0] ?? null;
  const queueDuration = useMemo(() => queueSongs.reduce((total, song) => total + song.duration, 0), [queueSongs]);
  // Popular artists: one avatar per lead artist, taken from what is already on screen.
  const knownSongs = useMemo(
    () => [...displaySongs, ...(home?.trending ?? []), ...(home?.madeForYou ?? []), ...(home?.recommended ?? []), ...likedSongs, ...recentlyPlayed],
    [displaySongs, home, likedSongs, recentlyPlayed]
  );
  const artists = useMemo(() => uniqueArtists(knownSongs, 6), [knownSongs]);

  // Artist page: the provider's profile (photo, followers, top songs, albums); plain search if it is unavailable.
  useEffect(() => {
    if (!artistName) return undefined;
    const controller = new AbortController();
    setArtistLoading(true);
    setArtistError(null);
    setArtistSongs([]);
    setArtistProfile(null);
    const searchFallback = async (): Promise<UnifiedSong[]> => {
      const [first, second] = await Promise.all([
        searchSongs(artistName, controller.signal, 0),
        searchSongs(artistName, controller.signal, 1).catch(() => ({ results: [] as UnifiedSong[] }))
      ]);
      return [...first.results, ...second.results];
    };
    fetchArtist(artistName, controller.signal)
      .then((profile) => {
        if (controller.signal.aborted) return;
        setArtistProfile(profile);
        setArtistSongs(profile.songs);
      })
      .catch(async () => {
        if (controller.signal.aborted) return;
        try {
          const found = await searchFallback();
          if (!controller.signal.aborted) setArtistSongs(found);
        } catch (error: unknown) {
          if (!controller.signal.aborted) setArtistError(error instanceof Error ? error.message : 'We could not load this artist right now.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setArtistLoading(false);
      });
    return () => controller.abort();
  }, [artistName, artistReload]);

  const artistTracks = useMemo(() => {
    if (!artistName) return [];
    const seen = new Set<string>();
    const dedupe = (list: readonly UnifiedSong[]): UnifiedSong[] => list.filter((song) => {
      const base = song.title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
      if (seen.has(`id:${song.id}`) || seen.has(base)) return false;
      seen.add(`id:${song.id}`);
      seen.add(base);
      return true;
    });
    // The provider already ranks its own top songs by popularity; keep that order.
    if (artistProfile) return dedupe(artistSongs);
    const key = artistName.toLocaleLowerCase();
    const mine = (list: readonly UnifiedSong[]): UnifiedSong[] => list.filter((song) => song.artist.toLocaleLowerCase().includes(key));
    const fromSearch = mine(artistSongs);
    // If the search only returned loosely related songs, still show them rather than an empty page.
    return dedupe([...(fromSearch.length > 0 ? fromSearch : artistSongs), ...mine(knownSongs)]).sort((left, right) => right.playCount - left.playCount);
  }, [artistName, artistProfile, artistSongs, knownSongs]);

  const collaborators = useMemo(
    () => (artistName ? uniqueArtists([...artistTracks, ...knownSongs], 8, artistName, true) : []),
    [artistName, artistTracks, knownSongs]
  );
  const relatedArtists = useMemo<RelatedArtist[]>(() => {
    if (!artistName) return [];
    if (artistProfile && artistProfile.similar.length > 0) {
      return artistProfile.similar.map((artist) => ({ name: artist.name, image: artist.image ?? (faces[artist.name.toLocaleLowerCase()] || null) }));
    }
    return collaborators.map((artist) => ({ name: artist.name, song: artist.song, image: faces[artist.name.toLocaleLowerCase()] || null }));
  }, [artistName, artistProfile, collaborators, faces]);

  // The room follows the surface the listener is looking at. An artist page gets
  // first dibs on its profile photo (then its lead cover); everywhere else the
  // currently playing song owns the palette. This prevents an old song colour
  // from lingering after navigating into an artist, and restores the song colour
  // as soon as the listener leaves that route.
  const atmosphereArtwork = useMemo(() => {
    if (view === 'artist' && artistName) return artistProfile?.image ?? artistTracks[0]?.artwork ?? activeSong?.artwork ?? null;
    return activeSong?.artwork ?? null;
  }, [activeSong?.artwork, artistName, artistProfile?.image, artistTracks, view]);

  const tasteArtistKey = (account.taste?.topArtists ?? []).slice(0, 10).map((artist) => artist.name).join('|');
  const tasteArtistNames = useMemo(() => (tasteArtistKey ? tasteArtistKey.split('|') : []), [tasteArtistKey]);

  // Real artist photos for the avatars on screen (Popular artists, related artists and the listener's own).
  useEffect(() => {
    const wanted = [...new Set([...artists, ...collaborators].map((artist) => artist.name).concat(tasteArtistNames))]
      .filter((name) => !(name.toLocaleLowerCase() in faces))
      .slice(0, 12);
    if (wanted.length === 0) return undefined;
    const controller = new AbortController();
    void fetchArtistFaces(wanted, controller.signal)
      .then((found) => {
        if (controller.signal.aborted) return;
        setFaces((current) => {
          const next = { ...current };
          for (const name of wanted) next[name.toLocaleLowerCase()] = '';
          for (const face of found) if (face.image) next[face.name.toLocaleLowerCase()] = face.image;
          return next;
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [artists, collaborators, faces, tasteArtistNames]);

  const activePlaylist = useMemo(() => (playlistId ? playlists.playlists.find((playlist) => playlist.id === playlistId) ?? null : null), [playlistId, playlists.playlists]);
  const activePlaylistSongs = useMemo(
    () => (activePlaylist ? activePlaylist.songIds.map((id) => playlists.songs.get(id)).filter((song): song is UnifiedSong => song !== undefined) : []),
    [activePlaylist, playlists.songs]
  );
  // The page owns the background colour. On an artist / playlist / liked page it is that page's own
  // artwork (even while another song plays); everywhere else it follows the song that is playing.
  const backdropSource = view === 'artist'
    ? (artistProfile?.image ?? artistTracks[0]?.artwork ?? null)
    : view === 'playlist'
      ? (activePlaylistSongs[0]?.artwork ?? null)
      : view === 'liked'
        ? (likedSongs[0]?.artwork ?? null)
        : view === 'album'
          ? (albumSeed?.artwork ?? null)
          : view === 'shared'
            ? (shared?.songs[0]?.artwork ?? null)
            : null;
  const [backdropPalette, setBackdropPalette] = useState<{ source: string; palette: Palette } | null>(null);
  useEffect(() => {
    if (!backdropSource) return undefined;
    const controller = new AbortController();
    void extractPalette(backdropSource, controller.signal).then((next) => {
      if (!controller.signal.aborted) setBackdropPalette({ source: backdropSource, palette: next });
    });
    return () => controller.abort();
  }, [backdropSource]);
  // Until the page's palette is ready keep the last colours, so the field never flashes another song's tint.
  const shaderPalette = backdropSource && backdropPalette?.source === backdropSource ? backdropPalette.palette : palette;

  // The banner glows in a dark shade of the cover colour over black.
  const bannerPalette = useMemo(() => shadePalette(palette, 0.6), [palette]);
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
    const fallbackColor = titleAccent(artistName ?? activeSong?.title ?? 'Allegra');
    if (!atmosphereArtwork) {
      setPalette(DEFAULT_PALETTE);
      setAmbientColor(fallbackColor);
      return undefined;
    }
    setAmbientColor(fallbackColor);
    const controller = new AbortController();
    void extractPalette(atmosphereArtwork, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setPalette(next);
      setAmbientColor(next.primary);
    });
    return () => controller.abort();
  }, [activeSong?.title, artistName, atmosphereArtwork]);

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
    // Stay on the current surface — the persistent mini player appears in-place.
    setPlayerMode('mini');
    setRecentlyPlayed((current) => [song, ...current.filter((item) => item.id !== song.id)].slice(0, 50));
    void recordRecentlyPlayed(song.id, 0).catch(() => undefined);
    tapHaptic();
  };

  const playAlbumTracks = (tracks: UnifiedSong[], shuffle = false): void => {
    if (tracks.length === 0) return;
    const ordered = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
    const first = ordered[0];
    if (!first) return;
    playSong(first, ordered);
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

  const toggleTranslate = (): void => {
    const song = audio.currentSong;
    if (!song || lyrics.length === 0) return;
    if (translatedLyrics) {
      setShowTranslated((current) => !current);
      return;
    }
    setTranslating(true);
    setTranslateError(null);
    void translateLyrics(song, lyrics)
      .then((response) => {
        setTranslatedLyrics(response.lines);
        setTranslateProvider(response.provider);
        setShowTranslated(true);
      })
      .catch((error: unknown) => {
        setTranslateError(error instanceof Error ? error.message : 'Could not translate this song right now.');
      })
      .finally(() => setTranslating(false));
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
  const albumTracks = useMemo(() => {
    if (!albumSeed) return [];
    return collectAlbumTracks(albumSeed, [
      displaySongs,
      featured,
      songs,
      likedSongs,
      recentlyPlayed,
      audio.queue,
      suggestions,
      aiPicks
    ]);
  }, [albumSeed, displaySongs, featured, songs, likedSongs, recentlyPlayed, audio.queue, suggestions, aiPicks]);

  // Album needs a song to be about; without one the route shows Browse, so it must not wear the detail chrome.
  // Artists get the full-bleed cinematic hero. Playlists, Liked Songs and albums sit directly on the shader.
  const isDetailView = view === 'artist';
  const isCollectionView = view === 'playlist' || view === 'liked' || view === 'shared' || (view === 'album' && albumSeed !== null);
  const playerEnergy = audio.isPlaying ? 0.42 : 0.08;
  const immersiveOpen = playerMode === 'immersive' || playerMode === 'workspace';

  useEffect(() => {
    if (!immersiveOpen && view !== 'words') return undefined;
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverscroll = root.style.overscrollBehavior;
    const previousBodyOverscroll = body.style.overscrollBehavior;
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    return () => {
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
      root.style.overscrollBehavior = previousRootOverscroll;
      body.style.overscrollBehavior = previousBodyOverscroll;
    };
  }, [immersiveOpen, view]);

  useEffect(() => {
    if (view === 'words' && audio.currentSong) setPlayerMode('workspace');
  }, [view, audio.currentSong?.id]);

  useEffect(() => {
    if (view !== 'album' || albumSeed) return;
    // An album is about a song: use the playing one, or fall back to Browse rather than an empty route.
    if (audio.currentSong) setAlbumSeed(audio.currentSong);
    else window.location.replace('#discover');
  }, [view, albumSeed, audio.currentSong]);

  const shellStyle = {
    '--ambient-accent': ambientColor,
    '--hero-art': activeSong?.artwork ? `url(${JSON.stringify(activeSong.artwork)})` : 'none',
    '--art-primary': palette.primary,
    '--art-secondary': palette.secondary,
    '--art-tertiary': palette.tertiary
  } as CSSProperties;

  return (
    <PlaylistsContext.Provider value={playlists}>
    <div ref={shellRef} className={`app-shell ${motionPaused ? 'is-motion-paused' : ''} ${navCollapsed ? 'is-nav-collapsed' : ''}`} data-theme={theme} data-motion-paused={motionPaused ? 'true' : undefined} style={shellStyle}>
      <DynamicAura paused={motionPaused} energy={audio.isPlaying ? 0.82 : 0.38} mood={audio.isPlaying ? 'energy' : 'chill'} palette={shaderPalette} />
      <a className="skip-link" href="#main-content">Skip to content</a>
      <AuthDialog open={authOpen} mode={authMode} account={account} onModeChange={setAuthMode} onClose={() => setAuthOpen(false)} />
      {view !== 'words' && (
        <header className="site-header">
          <div className="site-header-top"><a className="brand" href="#home" aria-label="Allegra home"><span className="brand-word">Allegra<i>.</i></span><span className="brand-mono" aria-hidden="true">A<i>.</i></span></a><button className="icon-button nav-collapse-toggle" type="button" aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={toggleNavigation}>{navCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}</button></div>
          <nav className="desktop-nav" aria-label="Primary navigation">
            <a className={`nav-link ${view === 'home' || view === 'shared' ? 'is-active' : ''}`} aria-current={view === 'home' ? 'page' : undefined} href="#home" title="Home"><House size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Home</span></a>
            <a className={`nav-link ${view === 'discover' || view === 'album' || view === 'artist' ? 'is-active' : ''}`} aria-current={view === 'discover' ? 'page' : undefined} href="#discover" title="Browse"><Compass size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Browse</span></a>
            <a className={`nav-link ${view === 'library' || view === 'playlist' ? 'is-active' : ''}`} aria-current={view === 'library' ? 'page' : undefined} href="#library" title="Your library"><LibraryIcon size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Your library</span></a>
            <span className="nav-divider" role="separator" />
            <a className="nav-link" href="#library" title="Recently played" onClick={(event) => openLibrarySection(event, 'library-played-lately')}><Clock size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Recently played</span></a>
            <a className={`nav-link ${view === 'liked' ? 'is-active' : ''}`} aria-current={view === 'liked' ? 'page' : undefined} href="#liked" title="Favorite songs"><HeartIcon size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Favorite songs</span></a>
            <a className="nav-link" href="#library" title="Playlists" onClick={(event) => openLibrarySection(event, 'library-playlists')}><ListMusic size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Playlists</span></a>
          </nav>
          <div className="header-actions">
            <button type="button" className="session-chip" onClick={() => { setAuthMode('signUp'); setAuthOpen(true); }} aria-label={account.profile && !account.profile.isGuest ? 'Open your account' : 'Sign in or create an account'}>
              <span className="session-avatar" aria-hidden="true">{account.profile && !account.profile.isGuest ? (account.profile.displayName ?? account.profile.email ?? 'A').slice(0, 1).toUpperCase() : 'G'}</span>
              <span className="session-copy">
                <strong>{account.profile && !account.profile.isGuest ? (account.profile.displayName ?? 'Your account') : 'Guest'}</strong>
                <small>{account.profile && !account.profile.isGuest ? <><i aria-hidden="true" /> Signed in</> : 'Sign in to keep your music'}</small>
              </span>
            </button>
            <div className="header-buttons"><button className="icon-button theme-toggle" type="button" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}</button><button className="motion-toggle icon-button" type="button" aria-label={motionPaused ? 'Resume background motion' : 'Pause background motion'} title={motionPaused ? 'Resume background motion' : 'Pause background motion'} onClick={() => setMotionPaused((value) => !value)}>{motionPaused ? <Play size={15} fill="currentColor" aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}</button></div>
          </div>
        </header>
      )}

      <main id="main-content" ref={mainRef} tabIndex={-1} aria-label={view === 'home' ? 'Home' : view === 'library' ? 'Your listening library' : view === 'words' ? 'Song words' : view === 'album' ? 'Album' : 'Discover music'} className={view === 'words' ? 'ytm-stage-main' : `content-wrap ${view !== 'discover' ? 'inner-page-wrap' : ''} ${isDetailView ? 'is-detail' : ''} ${isCollectionView ? 'is-collection' : ''}`}>
        {view !== 'words' ? (
          <div className="panel-topbar">
            {isDetailView || isCollectionView ? <button type="button" className="topbar-back" onClick={() => goBack(view === 'liked' || view === 'playlist' ? '#library' : view === 'shared' ? '#home' : '#discover')} aria-label="Back"><ArrowLeft size={17} aria-hidden="true" /><span>Back</span></button> : null}
            <nav className="crumbs" aria-label="Breadcrumb"><span>{view === 'home' || view === 'shared' ? 'Home' : view === 'library' || view === 'liked' || view === 'playlist' ? 'Library' : 'Browse'}</span><ChevronRight size={14} aria-hidden="true" /><strong>{view === 'home' ? 'For you' : view === 'shared' ? 'Shared playlist' : view === 'library' ? 'Your music' : view === 'album' ? 'Album' : view === 'artist' ? 'Artist' : view === 'liked' ? 'Liked Songs' : view === 'playlist' ? 'Playlist' : query.trim() ? 'Search' : 'Made for you'}</strong></nav>
            <div className="mood-pills" role="group" aria-label="Quick picks">{MOOD_PROMPTS.map((prompt) => <button key={prompt} type="button" className="mood-pill" aria-pressed={query === prompt} onClick={() => { if (view !== 'discover') window.location.hash = '#discover'; setQuery(query === prompt ? '' : prompt); }}>{query === prompt ? <motion.span layoutId="mood-pill-bg" className="mood-pill-bg" transition={spring.tactile} /> : null}<span>{prompt}</span></button>)}</div>
            <CommandPalette
              open={paletteOpen}
              onOpen={() => setPaletteOpen(true)}
              onClose={() => setPaletteOpen(false)}
              activeQuery={query.trim()}
              recent={recentlyPlayed}
              theme={theme}
              onPlaySong={(song, queue) => playSong(song, queue)}
              onOpenArtist={openArtist}
              onNavigate={(hash) => { window.location.hash = hash; }}
              onSearchAll={(value) => { if (view !== 'discover') window.location.hash = '#discover'; setQuery(value); }}
              onToggleTheme={toggleTheme}
              onClearSearch={() => setQuery('')}
            />
          </div>
        ) : null}
        {view === 'home' ? (
          <HomePage
            profile={account.profile}
            taste={account.taste}
            recentlyPlayed={recentlyPlayed}
            likedSongs={likedSongs}
            playlists={playlists.playlists}
            playlistSongs={playlists.songs}
            picks={aiPicks}
            picksReason={aiPicksReasoning}
            picksProvider={aiPicksProvider}
            trending={home?.trending ?? []}
            faces={faces}
            currentSongId={audio.currentSong?.id ?? null}
            isPlaying={audio.isPlaying}
            likedIds={likedIds}
            loading={personalLoading || playlists.loading}
            onPlay={(song, queue) => playSong(song, queue)}
            onToggle={audio.togglePlayback}
            onLike={toggleLike}
            onOpenArtist={openArtist}
            onCreatePlaylist={(name) => playlists.create(name)}
            onSeedTaste={(artistNames, languageNames) => account.seed(artistNames, languageNames)}
            onOpenAuth={() => { setAuthMode('signUp'); setAuthOpen(true); }}
          />
        ) : view === 'shared' ? (
          sharedError ? (
            <EmptyState title="This link is not working" copy={sharedError} action={<TactileButton variant="primary" onClick={() => { window.location.hash = '#home'; }}>Go to Home</TactileButton>} />
          ) : (
            <CollectionPage
              kind="shared"
              title={shared?.name ?? 'Shared playlist'}
              songs={shared?.songs ?? []}
              loading={sharedLoading}
              ownerName={shared?.ownerName ?? 'a listener'}
              currentSongId={audio.currentSong?.id ?? null}
              isPlaying={audio.isPlaying}
              likedIds={likedIds}
              onToggle={audio.togglePlayback}
              onPlayTrack={(song, queue) => playSong(song, queue)}
              onPlayAll={(shuffle) => playAlbumTracks(shared?.songs ?? [], shuffle)}
              onLike={toggleLike}
              onOpenAlbum={openAlbum}
              onDiscover={() => { window.location.hash = '#discover'; }}
              onSaveCopy={async () => {
                if (!sharedCode) return;
                const copy = await saveSharedPlaylist(sharedCode);
                await playlists.reload();
                window.location.hash = `#playlist/${encodeURIComponent(copy.id)}`;
              }}
            />
          )
        ) : view === 'library' ? <LibraryPage likedSongs={likedSongs} recentlyPlayed={recentlyPlayed} likedIds={likedIds} loading={personalLoading} error={personalError} actionError={personalActionError} currentSongId={audio.currentSong?.id} isPlaying={audio.isPlaying} onPlay={playSong} onLike={toggleLike} onRetry={() => void loadPersonalSpace()} onDiscover={() => { window.location.hash = '#discover'; window.setTimeout(() => setPaletteOpen(true), 0); }} /> : view === 'liked' ? <CollectionPage kind="liked" title="Liked Songs" songs={likedSongs} loading={personalLoading} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} likedIds={likedIds} onToggle={audio.togglePlayback} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={(shuffle) => playAlbumTracks(likedSongs, shuffle)} onLike={toggleLike} onOpenAlbum={openAlbum} onDiscover={() => { window.location.hash = '#discover'; window.setTimeout(() => setPaletteOpen(true), 0); }} /> : view === 'playlist' ? <CollectionPage kind="playlist" title={activePlaylist?.name ?? (playlists.loading ? 'Playlist' : 'Playlist not found')} songs={activePlaylistSongs} loading={playlists.loading || (activePlaylist !== null && activePlaylistSongs.length < activePlaylist.songIds.length)} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} likedIds={likedIds} onToggle={audio.togglePlayback} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={(shuffle) => playAlbumTracks(activePlaylistSongs, shuffle)} onLike={toggleLike} onOpenAlbum={openAlbum} onDiscover={() => { window.location.hash = '#discover'; window.setTimeout(() => setPaletteOpen(true), 0); }} {...(activePlaylist ? { onDelete: () => { void playlists.remove(activePlaylist.id); window.location.hash = '#library'; }, share: { libraryId: activePlaylist.id, isPublic: activePlaylist.isPublic, onChanged: () => { void playlists.reload(); } } } : {})} /> : view === 'artist' && artistName ? <ArtistPage name={artistName} profile={artistProfile} songs={artistTracks} related={relatedArtists} loading={artistLoading && artistTracks.length === 0} error={artistTracks.length === 0 ? artistError : null} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} likedIds={likedIds} onBack={() => goBack('#discover')} onRetry={() => setArtistReload((count) => count + 1)} onToggle={audio.togglePlayback} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={(shuffle) => playAlbumTracks(artistTracks, shuffle)} onLike={toggleLike} onOpenAlbum={openAlbumByName} onOpenArtist={openArtist} /> : view === 'album' && albumSeed ? <AlbumPage seed={albumSeed} tracks={albumTracks} palette={palette} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} likedIds={likedIds} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={() => playAlbumTracks(albumTracks, false)} onShuffle={() => playAlbumTracks(albumTracks, true)} onLike={toggleLike} onLikeAlbum={() => toggleLike(albumSeed)} albumLiked={likedIds.has(albumSeed.id)} /> : view === 'words' ? <WordsPage song={audio.currentSong} palette={palette} energy={audio.isPlaying ? 0.8 : 0.4} queue={audio.queue} lines={displayLyrics} currentTime={audio.currentTime} lyricsLoading={lyricsLoading} lyricsError={lyricsError} suggestions={suggestions} suggestionsLoading={suggestionsLoading} suggestionsError={suggestionsError} likedIds={likedIds} isPlaying={audio.isPlaying} onRetryLyrics={retryLyrics} onRetrySuggestions={retrySuggestions} onSeek={(time) => void audio.seek(time)} onPlay={playSong} onLike={toggleLike} onDiscover={() => { window.location.hash = '#discover'; window.setTimeout(() => setPaletteOpen(true), 0); }} translating={translating} translated={showTranslated} translateError={translateError} translateProvider={translateProvider} onToggleTranslate={toggleTranslate} /> : <>
        <div className="browse-grid">
          <div className="browse-main">
            <motion.section className="hero-banner" variants={pageVariants} initial="hidden" animate="visible" transition={pageTransition} aria-label="Featured track" data-live={audio.isPlaying ? 'true' : undefined}>
                <div className="hero-banner-shader" aria-hidden="true"><MusicFlowShader energy={audio.isPlaying ? 0.7 : 0.4} palette={bannerPalette} /></div>
              <motion.div className="hero-banner-copy" variants={itemVariants}>
                <span className="hero-banner-eyebrow">{isCurrent ? 'Now playing' : 'Curated playlist'}</span>
                <h1>{activeSong ? activeSong.title.replace(/\s*\([^)]*\)\s*/g, ' ').trim() : 'Good music, ready when you are'}</h1>
                <p>{activeSong ? `${activeSong.artist}${activeSong.album ? ` · ${activeSong.album}` : ''}` : 'Search a song, an artist, or a mood and press play.'}</p>
                <div className="hero-banner-actions">
                  <TactileButton variant="primary" icon={isCurrent && audio.isPlaying ? Pause : Play} onClick={() => { if (!activeSong) setPaletteOpen(true); else if (isCurrent) audio.togglePlayback(); else playSong(activeSong); }}>{isCurrent && audio.isPlaying ? 'Pause' : activeSong ? 'Play' : 'Start searching'}</TactileButton>
                  <span className="hero-banner-meta">{displaySongs.length} tracks · {formatTime(queueDuration)}</span>
                </div>
              </motion.div>
              {activeSong ? <motion.div className="hero-banner-art" variants={itemVariants}><Artwork song={activeSong} size="large" /></motion.div> : null}
            </motion.section>

            {artists.length > 0 ? <section className="artist-section" aria-labelledby="artists-heading"><div className="section-heading"><h2 id="artists-heading">Popular artists</h2></div><div className="artist-list">{artists.map((artist) => <ArtistPreviewCard key={artist.name} name={artist.name} image={faces[artist.name.toLocaleLowerCase()] || null} fallbackSong={artist.song} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} onPlayTrack={(song, queue) => playSong(song, queue)} onOpenArtist={openArtist} />)}</div></section> : null}

        {aiPicks.length > 0 ? <section className="library-section ai-picks-section" aria-labelledby="ai-picks-heading"><div className="library-section-heading"><div><span className="eyebrow eyebrow-accent"><Sparkles size={13} aria-hidden="true" /> {aiPicksProvider ? `AI picks, by ${aiPicksProvider}` : 'AI picks'}</span><h2 id="ai-picks-heading">{aiPicksReasoning ?? 'Picked for your taste'}</h2></div></div><div className="library-track-list">{aiPicks.map((song, index) => <SongCard key={song.id} song={song} index={index} isCurrent={song.id === audio.currentSong?.id} isPlaying={song.id === audio.currentSong?.id && audio.isPlaying} onPlay={() => playSong(song)} onLike={() => toggleLike(song)} liked={likedIds.has(song.id)} onOpenAlbum={openAlbum} />)}</div></section> : null}

            <section className="catalog-section" aria-labelledby="catalog-heading" aria-busy={searching}><div className="section-heading"><h2 id="catalog-heading">{sectionLabel}</h2><span className="result-count" aria-live="polite">{searching ? 'Listening…' : `${displaySongs.length} tracks · ${formatTime(queueDuration)}`}</span></div>{searching && displaySongs.length === 0 ? <div className="track-list" aria-label="Loading songs"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div> : searchError && displaySongs.length === 0 ? <EmptyState title="That search did not come back" copy={searchError} action={<TactileButton variant="primary" onClick={retryCurrentSearch}>Try the search again</TactileButton>} /> : displaySongs.length === 0 ? <EmptyState title="Nothing came back" copy="Try an artist, a lyric, or a mood. Start with “Arijit Singh” or “late night.”" action={<TactileButton variant="accent" onClick={() => setQuery('Arijit Singh')}>Try a suggestion</TactileButton>} /> : <><div className="track-head" aria-hidden="true"><span>Track</span><span>Album</span><span>Length</span></div><motion.div className="track-list" variants={pageVariants} initial="hidden" animate="visible">{displaySongs.map((song, index) => <SongCard key={song.id} song={song} index={index} isCurrent={song.id === audio.currentSong?.id} isPlaying={song.id === audio.currentSong?.id && audio.isPlaying} onPlay={() => playSong(song)} onLike={() => toggleLike(song)} liked={likedIds.has(song.id)} onOpenAlbum={openAlbum} />)}</motion.div></>}</section>

            <section id="daylight" className="light-scene" aria-labelledby="light-scene-heading">
          {lightSong ? <div className="light-scene-grid"><div className="light-scene-art"><button onClick={() => playSong(lightSong)} aria-label={`Play ${lightSong.title}`}><Artwork song={lightSong} size="large" /></button><div className="light-scene-track"><strong>{lightSong.title}</strong><span>{lightSong.artist}</span></div></div><div className="light-scene-copy"><h2 id="light-scene-heading">Keep listening</h2><p>One more track from your queue, ready when you are.</p><TactileButton variant="primary" icon={Play} aria-label={`Play ${lightSong.title}`} onClick={() => playSong(lightSong)}>Play next</TactileButton></div></div> : <div className="light-scene-empty"><Disc3 size={22} aria-hidden="true" /><p>Play something and your next pick shows up here.</p></div>}
        </section>

            <section id="words" className="lyrics-teaser"><div className="teaser-intro"><div><h2>Lyrics <em>in time</em></h2><p>Follow along with the song you are playing.</p></div><TactileButton variant="secondary" icon={Waves} onClick={() => { if (audio.currentSong) setPlayerMode('workspace'); }}>Open lyrics</TactileButton></div><LyricsPanel lines={displayLyrics} currentTime={audio.currentTime} loading={lyricsLoading} error={lyricsError} onRetry={retryLyrics} onSeek={(time) => void audio.seek(time)} artworkUrl={activeSong?.artwork} translating={translating} translated={showTranslated} translateError={translateError} translateProvider={translateProvider} onToggleTranslate={toggleTranslate} softFocus /></section>
          </div>

          <aside id="queue" ref={nowPlayingRef} className="now-panel" aria-label="Now playing">
            <div className="now-panel-head"><h2>Now Playing</h2><span className="now-panel-state" data-live={audio.isPlaying && isCurrent ? 'true' : undefined}>{featureState}</span></div>
            {activeSong ? <>
              <button type="button" className="now-panel-art" onClick={() => { if (isCurrent) audio.togglePlayback(); else playSong(activeSong); }} aria-label={`${isCurrent && audio.isPlaying ? 'Pause' : 'Play'} ${activeSong.title}`}>
                <Artwork song={activeSong} size="large" layoutId={`art-${activeSong.id}`} />
                <span className="now-panel-play">{audio.isBuffering && isCurrent ? <Disc3 size={20} className="spin" aria-hidden="true" /> : isCurrent && audio.isPlaying ? <Pause size={20} fill="currentColor" aria-hidden="true" /> : <Play size={20} fill="currentColor" aria-hidden="true" />}</span>
              </button>
              <div className="now-panel-info"><div><h3>{activeSong.title}</h3><p>{activeSong.artist}</p></div><IconButton icon={HeartIcon} label={likedIds.has(activeSong.id) ? 'Remove from likes' : 'Add to likes'} active={likedIds.has(activeSong.id)} onClick={() => toggleLike(activeSong)} /></div>
              <div className="feature-progress" aria-hidden="true"><span style={{ transform: `scaleX(${audio.duration && isCurrent ? audio.currentTime / audio.duration : 0})` }} /></div>
              <div className="now-panel-foot"><span>{formatTime(featureRemaining)} {isCurrent && audio.duration > 0 ? 'left' : 'total'}</span><button type="button" className="feature-open" onClick={() => { if (audio.currentSong) setPlayerMode('immersive'); else playSong(activeSong); }}>View player</button></div>
            </> : <div className="feature-loading"><Disc3 size={24} className="spin" aria-hidden="true" /><span>Loading your first song</span></div>}
            <div className="now-panel-queue">
              <div className="queue-heading"><h3>Up next</h3><span>{queueSongs.length} tracks · {formatTime(queueDuration)}</span></div>
              <div className="queue-items">{queueSongs.filter((song) => song.id !== activeSong?.id).slice(0, 4).map((song) => <button className="queue-item" key={song.id} onClick={() => playSong(song)}><Artwork song={song} size="small" /><span className="queue-item-copy"><strong>{song.title}</strong><small>{song.artist}</small></span><span className="queue-item-time">{formatTime(song.duration)}</span></button>)}{nextSongs.length === 0 ? <div className="queue-empty"><Disc3 size={19} /><span>Choose a song to build your queue.</span></div> : null}</div>
            </div>
          </aside>
        </div>
        </>}
      </main>

      {audio.currentSong && !immersiveOpen ? (
        <div className="mini-player" role="region" aria-label="Player bar">
          <div className="am-transport">
            <button type="button" className={`am-btn ${audio.shuffle ? 'is-on' : ''}`} aria-pressed={audio.shuffle} aria-label={audio.shuffle ? 'Shuffle on' : 'Shuffle off'} title="Shuffle" onClick={audio.toggleShuffle}><Shuffle size={16} aria-hidden="true" /></button>
            <button type="button" className="am-btn am-btn--skip" aria-label="Previous track" title="Previous" onClick={audio.skipPrevious}><SkipBack size={20} fill="currentColor" aria-hidden="true" /></button>
            <button type="button" className="am-play" onClick={audio.togglePlayback} aria-label={audio.isPlaying ? 'Pause' : 'Play'}>
              {audio.isBuffering ? <Disc3 size={20} className="spin" aria-hidden="true" /> : audio.isPlaying ? <Pause size={22} fill="currentColor" aria-hidden="true" /> : <Play size={22} fill="currentColor" aria-hidden="true" />}
            </button>
            <button type="button" className="am-btn am-btn--skip" aria-label="Next track" title="Next" onClick={audio.skipNext}><SkipForward size={20} fill="currentColor" aria-hidden="true" /></button>
            <button type="button" className={`am-btn ${audio.repeat !== 'off' ? 'is-on' : ''}`} aria-pressed={audio.repeat !== 'off'} aria-label={`Repeat ${audio.repeat}`} title={audio.repeat === 'one' ? 'Repeat this song' : audio.repeat === 'all' ? 'Repeat all' : 'Repeat off'} onClick={audio.cycleRepeat}>{audio.repeat === 'one' ? <Repeat1 size={16} aria-hidden="true" /> : <Repeat size={16} aria-hidden="true" />}</button>
          </div>

          <div className="am-now">
            <button type="button" className="am-art" onClick={() => setPlayerMode('immersive')} aria-label="Expand player"><Artwork song={audio.currentSong} size="small" /></button>
            <div className="am-now-body">
              <button type="button" className="am-meta" onClick={() => setPlayerMode('immersive')}>
                <strong>{audio.currentSong.title}</strong>
                <span>{[audio.currentSong.artist, audio.currentSong.album].filter(Boolean).join(' \u2014 ')}</span>
              </button>
              <div className="am-scrub">
                <time>{formatTime(audio.currentTime)}</time>
                <input
                  type="range"
                  className="am-range"
                  aria-label="Track position"
                  min={0}
                  max={Math.max(audio.duration, 1)}
                  step={0.1}
                  value={Math.min(audio.currentTime, Math.max(audio.duration, 1))}
                  style={{ '--fill': `${audio.duration > 0 ? (audio.currentTime / audio.duration) * 100 : 0}%` } as CSSProperties}
                  onChange={(event) => void audio.seek(Number(event.target.value))}
                />
                <time>-{formatTime(Math.max(0, audio.duration - audio.currentTime))}</time>
              </div>
            </div>
            <IconButton icon={HeartIcon} label={likedIds.has(audio.currentSong.id) ? 'Remove from likes' : 'Add to likes'} active={likedIds.has(audio.currentSong.id)} onClick={() => toggleLike(audio.currentSong!)} />
          </div>

          <div className="am-right">
            <button type="button" className="am-btn" aria-label={audio.isMuted ? 'Unmute' : 'Mute'} title={audio.isMuted ? 'Unmute' : 'Mute'} onClick={audio.toggleMute}>{audio.isMuted || audio.volume === 0 ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}</button>
            <input
              type="range"
              className="am-range am-volume"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={audio.isMuted ? 0 : audio.volume}
              style={{ '--fill': `${(audio.isMuted ? 0 : audio.volume) * 100}%` } as CSSProperties}
              onChange={(event) => audio.setVolume(Number(event.target.value))}
            />
            <button type="button" className="am-btn" aria-label="Lyrics" title="Lyrics" onClick={() => setPlayerMode('workspace')}><Waves size={17} aria-hidden="true" /></button>
            <button type="button" className={`am-btn ${queueOpen ? 'is-on' : ''}`} aria-pressed={queueOpen} aria-label="Playing next" title="Playing next" onClick={() => setQueueOpen((open) => !open)}><ListMusic size={17} aria-hidden="true" /></button>
          </div>

          {queueOpen ? (
            <div className="am-queue" role="dialog" aria-label="Playing next">
              <div className="am-queue-head"><strong>Playing Next</strong><span>{audio.queue.length} songs</span></div>
              <div className="queue-items">
                {audio.queue.length < 2 ? <div className="queue-empty"><ListMusic size={18} aria-hidden="true" /><span>Nothing queued after this song.</span></div> : null}
                {audio.queue.slice(Math.max(0, audio.queue.findIndex((song) => song.id === audio.currentSong?.id)) + 1).slice(0, 12).map((song) => (
                  <button className="queue-item" key={song.id} onClick={() => playSong(song, audio.queue)}>
                    <Artwork song={song} size="small" />
                    <span className="queue-item-copy"><strong>{song.title}</strong><small>{song.artist}</small></span>
                    <span className="queue-item-time">{formatTime(song.duration)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">{audio.currentSong ? `${audio.isPlaying ? 'Playing' : 'Paused'} ${audio.currentSong.title} by ${audio.currentSong.artist}` : ''}</p>
      <audio ref={audio.audioRef} className="audio-element" crossOrigin="anonymous" preload="metadata" aria-hidden="true" />
      <PlayerPanel
        mode={playerMode === 'workspace' ? 'workspace' : 'immersive'}
        song={immersiveOpen ? audio.currentSong : null}
        queue={audio.queue}
        currentTime={audio.currentTime}
        duration={audio.duration}
        isPlaying={audio.isPlaying}
        playbackError={audio.error}
        liked={audio.currentSong ? likedIds.has(audio.currentSong.id) : false}
        lyrics={{
          lines: displayLyrics,
          currentTime: audio.currentTime,
          loading: lyricsLoading,
          error: lyricsError,
          onRetry: retryLyrics,
          onSeek: (time) => void audio.seek(time),
          artworkUrl: audio.currentSong?.artwork,
          translating,
          translated: showTranslated,
          translateError,
          translateProvider,
          onToggleTranslate: toggleTranslate
        }}
        palette={palette}
        energy={playerEnergy}
        suggestions={suggestions.length > 0 ? suggestions : aiPicks}
        muted={audio.isMuted}
        onMute={audio.toggleMute}
        onCollapse={collapsePlayer}
        onOpenWorkspace={() => setPlayerMode('workspace')}
        onOpenImmersive={() => setPlayerMode('immersive')}
        onToggle={audio.togglePlayback}
        onNext={audio.skipNext}
        onPrevious={audio.skipPrevious}
        onSeek={(time) => void audio.seek(time)}
        onLike={() => { if (audio.currentSong) toggleLike(audio.currentSong); }}
        onPlayQueueSong={(song) => playSong(song, audio.queue.length > 0 ? audio.queue : displaySongs)}
      />
      <OfflineToast visible={offline} />
    </div>
    </PlaylistsContext.Provider>
  );
}

function viewFromHash(hash: string): AppView {
  if (hash.startsWith('#artist/')) return 'artist';
  if (hash.startsWith('#playlist/')) return 'playlist';
  if (hash === '#liked') return 'liked';
  if (hash.startsWith('#shared/')) return 'shared';
  if (hash === '#discover') return 'discover';
  if (hash === '#library') return 'library';
  if (hash === '#words') return 'words';
  if (hash === '#album') return 'album';
  return 'home';
}

function artistFromHash(hash: string): string | null {
  if (!hash.startsWith('#artist/')) return null;
  try {
    const name = decodeURIComponent(hash.slice('#artist/'.length)).trim();
    return name || null;
  } catch {
    return null;
  }
}

function sharedFromHash(hash: string): string | null {
  if (!hash.startsWith('#shared/')) return null;
  const code = hash.slice('#shared/'.length).split(/[/?]/)[0]?.trim().toLowerCase();
  return code || null;
}

function playlistFromHash(hash: string): string | null {
  if (!hash.startsWith('#playlist/')) return null;
  try {
    return decodeURIComponent(hash.slice('#playlist/'.length)).trim() || null;
  } catch {
    return null;
  }
}
