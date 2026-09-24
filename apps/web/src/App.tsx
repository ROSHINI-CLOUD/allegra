'use client';

import { ArrowLeft, ChevronRight, House, Heart as HeartIcon, Moon, Sun, Disc3, Pause, Play, SkipBack, SkipForward, Sparkles, Waves, Clock, Compass, Library as LibraryIcon, ListMusic, PanelLeftClose, PanelLeftOpen, Repeat, Repeat1, Search as SearchIcon, Shuffle, Volume2, VolumeX, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';

import type { ArtistProfile, HomePayload, LyricLine, SharedPlaylist, UnifiedSong } from '@shared/types';
import { deriveMoodPrompts } from '@shared/moodPrompts';

import { AlbumPage } from './components/AlbumPage';
import { ArtistPage } from './components/ArtistPage';
import { CollectionPage } from './components/CollectionPage';
import { ArtistPreviewCard } from './components/ArtistPreviewCard';
import type { RelatedArtist } from './components/ArtistPage';
import { LyricsPanel } from './components/LyricsPanel';
import { LibraryPage } from './components/LibraryPage';
import { DynamicAura } from './components/DynamicAura';
import { AuthDialog } from './components/AuthDialog';
import { useSignIn } from './auth/SignInContext';
import { CommandPalette } from './components/CommandPalette';
import { HomePage } from './components/HomePage';
import { PlayerPanel } from './components/PlayerPanel';
import { MusicFlowShader } from './components/shader/MusicFlowShader';
import type { ImmersivePlayerMode } from './components/PlayerPanel';
import { SearchResults, artistsFromSongs } from './components/SearchResults';
import { SongCard } from './components/SongCard';
import { Artwork, EmptyState, IconButton, OfflineToast, SkeletonCard, TactileButton } from './components/ui';
import { useAccount, useListenTracker } from './hooks/useAccount';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useLiveKaraoke } from './hooks/useLiveKaraoke';
import { useMediaSession } from './hooks/useMediaSession';
import { useNarrowViewport } from './hooks/useNarrowViewport';
import { PlaylistsContext, usePlaylists } from './hooks/usePlaylists';
import { collectAlbumTracks } from './lib/album';
import { tapHaptic } from './lib/haptics';
import { DEFAULT_PALETTE, extractPalette, shadePalette } from './lib/palette';
import type { Palette } from './lib/palette';
import { ApiError, ensureSession, fetchArtist, fetchArtistFaces, fallbackLyrics, fetchAiRecommendations, fetchHome, fetchLikedSongs, fetchLyrics, fetchRecentlyPlayed, fetchSharedPlaylist, fetchSuggestions, recordRecentlyPlayed, saveSharedPlaylist, searchSongs, setLikedSong, translateLyrics } from './lib/api';
import { shouldStartRadio, uniqueByIdentity } from './lib/songIdentity';
import { legacyHashToPath, parseRoute, paths } from './lib/routes';
import { pickTopResult } from './lib/topResult';
import { formatTime, titleAccent } from './lib/utils';
import { itemVariants, motionTokens, pageVariants, spring } from './motion';

const DEFAULT_QUERY = 'top songs';
type PlayerMode = 'mini' | ImmersivePlayerMode;

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
  return uniqueByIdentity(songs).slice(0, 6);
}

export default function App() {
  const reduced = useReducedMotion();
  // Gates swipe-up-to-expand on the mini player: no equivalent gesture affordance
  // on desktop, so the drag only engages on the phone layout (see app.css's
  // matching `@media (max-width: 900px)` breakpoint).
  const isNarrowViewport = useNarrowViewport();
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
  const router = useRouter();
  const pathname = usePathname();
  const { view, artistName, playlistId, sharedCode } = useMemo(() => parseRoute(pathname), [pathname]);
  const [shared, setShared] = useState<SharedPlaylist | null>(null);
  const [sharedLoading, setSharedLoading] = useState(false);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [artistSongs, setArtistSongs] = useState<UnifiedSong[]>([]);
  const [artistProfile, setArtistProfile] = useState<ArtistProfile | null>(null);
  const [artistLoading, setArtistLoading] = useState(false);
  // Artist photos by lower-cased name. An empty string means "looked up, no photo", so we never ask twice.
  const [faces, setFaces] = useState<Record<string, string>>({});
  /** Face lookups already in flight, so a re-render does not re-request them. */
  const requestedFacesRef = useRef<Set<string>>(new Set());
  const [artistError, setArtistError] = useState<string | null>(null);
  const [artistReload, setArtistReload] = useState(0);
  const [suggestions, setSuggestions] = useState<UnifiedSong[]>([]);
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
  const queuePanelRef = useRef<HTMLDivElement | null>(null);
  const queueToggleRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!queueOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setQueueOpen(false);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (queuePanelRef.current?.contains(target)) return;
      if (queueToggleRef.current?.contains(target)) return;
      setQueueOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [queueOpen]);
  useEffect(() => {
    if (!queueOpen) return undefined;
    const frame = window.requestAnimationFrame(() => {
      queuePanelRef.current?.querySelector<HTMLElement>('button, [href], input')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [queueOpen]);
  const nowPlayingRef = useRef<HTMLElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const lyricsGeneration = useRef(0);
  const audio = useAudioPlayer();
  const liveKaraoke = useLiveKaraoke(audio.currentSong, {
    audioRef: audio.audioRef,
    swapAudioSource: audio.swapAudioSource
  });
  const hasSongLoaded = audio.currentSong !== null;
  const playlists = usePlaylists();
  const transportRef = useRef(audio);
  transportRef.current = audio;
  /** When true, Next keeps pulling similar-vibe tracks instead of remastered search hits. */
  const radioActiveRef = useRef(false);
  const radioForSongRef = useRef<string | null>(null);
  const aiPicksRef = useRef<UnifiedSong[]>([]);
  const reloadPlaylists = playlists.reload;
  // Lock screen, media keys, headset buttons and car head units, all through the same funnel.
  const fillRadioQueue = useCallback(async (songId: string, signal?: AbortSignal): Promise<number> => {
    try {
      const related = await fetchSuggestions(songId, signal, 20);
      if (signal?.aborted) return 0;
      setSuggestions(related);
      let added = transportRef.current.appendQueue(related);
      if (added === 0 && aiPicksRef.current.length > 0) {
        added = transportRef.current.appendQueue(aiPicksRef.current);
      }
      return added;
    } catch {
      if (signal?.aborted) return 0;
      if (aiPicksRef.current.length > 0) return transportRef.current.appendQueue(aiPicksRef.current);
      return 0;
    }
  }, []);

  const skipNextSmart = useCallback((): void => {
    const player = transportRef.current;
    const song = player.currentSong;
    if (!song) return;
    const next = player.skipNext();
    if (!next && radioActiveRef.current) {
      void fillRadioQueue(song.id).then((added) => {
        if (added > 0) player.skipNext();
      });
      return;
    }
    if (!next || !radioActiveRef.current) return;
    const live = player.queue;
    const index = live.findIndex((item) => item.id === next.id);
    const remaining = index >= 0 ? live.length - index - 1 : 0;
    if (remaining < 3) void fillRadioQueue(next.id);
  }, [fillRadioQueue]);

  useMediaSession({
    song: audio.currentSong,
    isPlaying: audio.isPlaying,
    currentTime: audio.currentTime,
    duration: audio.duration,
    requestPlayback: audio.requestPlayback,
    seek: audio.seek,
    skipNext: skipNextSmart,
    skipPrevious: audio.skipPrevious,
    stop: audio.stop
  });
  const collapsePlayer = useCallback(() => {
    setPlayerMode('mini');
  }, []);

  /**
   * YouTube Music pattern: route the page under the lyrics sheet first, then
   * slide the sheet down so the artist/album is already waiting underneath.
   */
  const revealFromListeningWorld = useCallback((go: () => void) => {
    go();
    window.requestAnimationFrame(() => {
      setPlayerMode('mini');
    });
  }, []);

  const openAlbum = useCallback((song: UnifiedSong) => {
    setAlbumSeed(song);
    router.push(paths.album);
  }, [router]);

  const openAlbumFromPlayer = useCallback((song: UnifiedSong) => {
    revealFromListeningWorld(() => openAlbum(song));
  }, [openAlbum, revealFromListeningWorld]);

  const openArtistFromPlayer = useCallback((name: string) => {
    revealFromListeningWorld(() => {
      router.push(paths.artist(name));
    });
  }, [revealFromListeningWorld, router]);

  const openLibrarySection = useCallback((event: MouseEvent<HTMLAnchorElement>, sectionId: string) => {
    event.preventDefault();
    const alreadyThere = pathname === paths.library;
    if (!alreadyThere) router.push(paths.library);
    // The library renders after the route changes; wait a beat before scrolling to the section.
    window.setTimeout(() => document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), alreadyThere ? 0 : 400);
  }, [pathname, router]);

  // Steps taken inside the app. Back only walks browser history when there is in-app history to walk,
  // so a page opened straight from a link falls back to a sensible parent instead of leaving the site.
  const navDepthRef = useRef(0);
  const goBack = useCallback((fallback: string) => {
    if (navDepthRef.current > 0) {
      navDepthRef.current -= 2;
      window.history.back();
    } else {
      router.push(fallback);
    }
  }, [router]);

  const openArtist = useCallback((name: string) => {
    router.push(paths.artist(name));
  }, [router]);

  /** Albums from the artist page: open the album when one of its songs is loaded, otherwise search for it. */
  const openAlbumByName = useCallback((albumName: string, seed: UnifiedSong | null) => {
    if (seed) {
      openAlbum(seed);
      return;
    }
    router.push(paths.discover);
    setQuery(`${albumName} ${artistName ?? ''}`.trim());
  }, [openAlbum, artistName, router]);

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
  const signIn = useSignIn();
  const account = useAccount(signIn.signedIn, () => {
    void loadPersonalSpace();
  });
  useListenTracker(audio.currentSong ?? null, audio.currentTime, account.refresh);

  /** Home/search mood chips: server-built prompts when taste is ready, else calm guest defaults. */
  const moodPrompts = useMemo(() => {
    if (account.taste?.prompts?.length) return [...account.taste.prompts];
    return deriveMoodPrompts(account.taste);
  }, [account.taste]);

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

  // Links from before real URLs (`/#shared/abc`) still open the right view.
  useEffect(() => {
    const target = legacyHashToPath(window.location.hash);
    if (target) router.replace(target);
  }, [router]);

  // Count in-app steps so Back only walks history when there is some to walk.
  const seenPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (seenPathRef.current !== null && seenPathRef.current !== pathname) navDepthRef.current += 1;
    seenPathRef.current = pathname;
  }, [pathname]);

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

  // Related tracks for the player sheet. A failure just leaves the AI picks in place,
  // so there is no error surface to drive here.
  useEffect(() => {
    const song = audio.currentSong;
    if (playerMode === 'mini' || !song) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    void fetchSuggestions(song.id, controller.signal)
      .then(setSuggestions)
      .catch(() => undefined);
    return () => controller.abort();
  }, [audio.currentSong, playerMode]);

  // The recommender needs something to reason from. With a brand-new guest — no
  // likes, no history, no taste, nothing playing — it can only answer "not enough
  // listening history", so asking at all would just be a guaranteed 404 on every
  // first load. Wait until there is a signal worth sending.
  const hasTasteSignal =
    likedSongs.length > 0 ||
    recentlyPlayed.length > 0 ||
    (account.taste?.topArtists?.length ?? 0) > 0 ||
    Boolean(audio.currentSong?.id);

  // Taste fingerprint, not now-playing id: skipping tracks must not re-bill Bedrock.
  const tasteFingerprint = useMemo(() => {
    const liked = likedSongs.map((song) => song.id).slice(0, 30).join(',');
    const recent = recentlyPlayed.map((song) => song.id).slice(0, 20).join(',');
    const artists = (account.taste?.topArtists ?? []).slice(0, 12).join(',');
    return `${liked}|${recent}|${artists}`;
  }, [likedSongs, recentlyPlayed, account.taste?.topArtists]);
  const currentSongIdRef = useRef(audio.currentSong?.id);
  currentSongIdRef.current = audio.currentSong?.id;

  useEffect(() => {
    if (personalLoading || !hasTasteSignal) return undefined;
    const controller = new AbortController();
    // Snapshot now-playing for prompt colouring on a cache miss; deps stay taste-stable.
    fetchAiRecommendations(currentSongIdRef.current, controller.signal)
      .then((response) => {
        aiPicksRef.current = response.songs;
        setAiPicks(response.songs);
        setAiPicksReasoning(response.reasoning);
        setAiPicksProvider(response.provider);
      })
      .catch(() => {
        // Optional enhancement — quietly stay empty if unavailable (no key configured, no history yet, etc).
        aiPicksRef.current = [];
        setAiPicks([]);
      });
    return () => controller.abort();
  }, [tasteFingerprint, personalLoading, hasTasteSignal]);

  const displaySongs = query.trim() ? uniqueByIdentity(songs) : curatedSongs(featured);
  // With nothing playing, the hero previews the results. During a search that means
  // the elected release rather than whatever the provider listed first, which was
  // regularly a compilation the song merely appears on.
  const activeSong = audio.currentSong ?? pickTopResult(displaySongs, query) ?? null;
  const displayLyrics = showTranslated && translatedLyrics ? translatedLyrics : lyrics;
  const queueSongs = audio.queue.length > 0 ? audio.queue : displaySongs;
  const nextSongs = queueSongs.filter((song) => song.id !== activeSong?.id).slice(0, 3);
  const lightSong = nextSongs[0] ?? activeSong ?? home?.madeForYou[0] ?? home?.recommended[0] ?? null;
  const queueDuration = useMemo(() => queueSongs.reduce((total, song) => total + song.duration, 0), [queueSongs]);
  const playingNext = useMemo(() => {
    const live = audio.queue;
    if (live.length === 0) return [] as UnifiedSong[];
    const currentIndex = live.findIndex((song) => song.id === audio.currentSong?.id);
    const start = currentIndex >= 0 ? currentIndex + 1 : 0;
    return live.slice(start);
  }, [audio.queue, audio.currentSong?.id]);
  const playingNextDuration = useMemo(
    () => playingNext.reduce((total, song) => total + song.duration, 0),
    [playingNext]
  );
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
    // One quiet retry: the provider is occasionally slow, and the fallback below has no artist photo.
    fetchArtist(artistName, controller.signal)
      .catch(async (first: unknown) => {
        if (controller.signal.aborted) throw first;
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        return fetchArtist(artistName, controller.signal);
      })
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

  /** Artists the search panel will render — they need faces too, or every card there
   *  stays an initial forever. */
  const searchArtistNames = useMemo(
    () => (query.trim() ? artistsFromSongs(displaySongs, 18).map((artist) => artist.name) : []),
    [displaySongs, query]
  );

  // Real artist photos for the avatars on screen (Popular artists, search results,
  // related artists and the listener's own). Fetched in batches: each batch resolves
  // more names, which re-runs this and picks up the next batch.
  //
  // Deliberately no AbortController. The effect depends on `faces`, so aborting on
  // cleanup cancelled the batch that was about to populate `faces` — the names never
  // got marked, the same request went out again, and cards sat on a placeholder
  // forever. A ref records what is already in flight so re-runs skip it instead.
  useEffect(() => {
    const wanted = [...new Set([...artists, ...collaborators].map((artist) => artist.name).concat(searchArtistNames, tasteArtistNames, artistName ? [artistName] : []))]
      .filter((name) => {
        const key = name.toLocaleLowerCase();
        return key.length > 0 && !(key in faces) && !requestedFacesRef.current.has(key);
      })
      .slice(0, 12);
    if (wanted.length === 0) return;
    for (const name of wanted) requestedFacesRef.current.add(name.toLocaleLowerCase());
    void fetchArtistFaces(wanted)
      .then((found) => {
        setFaces((current) => {
          const next = { ...current };
          // Mark every name we asked about, so a provider with no photo for someone
          // resolves to "looked, nothing there" rather than pending forever.
          for (const name of wanted) next[name.toLocaleLowerCase()] = '';
          for (const face of found) if (face.image) next[face.name.toLocaleLowerCase()] = face.image;
          return next;
        });
      })
      .catch(() => {
        // Release them so a later render can try again.
        for (const name of wanted) requestedFacesRef.current.delete(name.toLocaleLowerCase());
      });
  }, [artistName, artists, collaborators, faces, searchArtistNames, tasteArtistNames]);

  const activePlaylist = useMemo(() => (playlistId ? playlists.playlists.find((playlist) => playlist.id === playlistId) ?? null : null), [playlistId, playlists.playlists]);
  const activePlaylistSongs = useMemo(
    () => (activePlaylist ? activePlaylist.songIds.map((id) => playlists.songs.get(id)).filter((song): song is UnifiedSong => song !== undefined) : []),
    [activePlaylist, playlists.songs]
  );
  // Collection pages follow the now-playing cover so the aura shifts with every
  // pick inside a playlist / likes / shared room. Artist & album keep their hero art.
  const collectionSongArt = audio.currentSong?.artwork ?? null;
  const backdropSource = view === 'artist'
    ? (artistProfile?.image ?? artistTracks[0]?.artwork ?? null)
    : view === 'playlist'
      ? (collectionSongArt ?? activePlaylist?.coverUrl ?? activePlaylistSongs[0]?.artwork ?? null)
      : view === 'liked'
        ? (collectionSongArt ?? likedSongs[0]?.artwork ?? null)
        : view === 'album'
          ? (albumSeed?.artwork ?? null)
          : view === 'shared'
            ? (collectionSongArt ?? shared?.coverUrl ?? shared?.songs[0]?.artwork ?? null)
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
  const sectionLabel = 'Made for you';
  /** A live query swaps Browse over to the tabbed result surface. */
  const isSearching = query.trim().length > 0;

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

  // Backgrounds drift on a timer — never pulse with the beat.
  useEffect(() => {
    shellRef.current?.style.setProperty('--audio-level', '0');
  }, []);

  // Tap a lyric line → jump there and play from it. One funnel (invariant 1):
  // seek() then requestPlayback(true), never audio.play() beside a state setter.
  // Always requests play, so tapping a line on a paused track starts it.
  const activateLyricLine = (time: number): void => {
    void (async () => {
      await audio.seek(time);
      await audio.requestPlayback(true);
    })();
  };

  const playSong = (song: UnifiedSong, queue: UnifiedSong[] = displaySongs): void => {
    // Active search → always radio. Title hits are remasters/remixes of the same
    // song; Next should pull similar-vibe tracks, not the next cover variant.
    const fromSearch = Boolean(query.trim()) && queue === displaySongs;
    const radio = fromSearch || shouldStartRadio(song, queue);
    radioActiveRef.current = radio;
    radioForSongRef.current = radio ? song.id : null;
    audio.selectSong(song, radio ? [song] : uniqueByIdentity(queue));
    // Stay on the current surface — the persistent mini player appears in-place.
    setPlayerMode('mini');
    setRecentlyPlayed((current) => [song, ...current.filter((item) => item.id !== song.id)].slice(0, 50));
    void recordRecentlyPlayed(song.id, 0).catch(() => undefined);
    tapHaptic();
    if (radio) void fillRadioQueue(song.id);
  };

  // Keep radio topped up so end-of-track advance always has a distinct next.
  useEffect(() => {
    const song = audio.currentSong;
    if (!song || !radioActiveRef.current) return undefined;
    const index = audio.queue.findIndex((item) => item.id === song.id);
    const remaining = index >= 0 ? audio.queue.length - index - 1 : 0;
    if (remaining >= 3) return undefined;
    const controller = new AbortController();
    void fillRadioQueue(song.id, controller.signal);
    return () => controller.abort();
  }, [audio.currentSong?.id, audio.queue.length, fillRadioQueue]);

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
  // Keep shader energy stable across play/pause — flipping it made the field surge.
  const playerEnergy = 0.42;
  const immersiveOpen = playerMode === 'immersive' || playerMode === 'workspace';

  useEffect(() => {
    if (immersiveOpen && queueOpen) setQueueOpen(false);
  }, [immersiveOpen, queueOpen]);

  useEffect(() => {
    if (!immersiveOpen) return undefined;
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
  }, [immersiveOpen]);

  useEffect(() => {
    if (view !== 'album' || albumSeed) return;
    // An album is about a song: use the playing one, or fall back to Browse rather than an empty route.
    if (audio.currentSong) setAlbumSeed(audio.currentSong);
    else window.location.replace('#discover');
  }, [view, albumSeed, audio.currentSong]);

  const shellPalette = shaderPalette;
  const shellStyle = {
    '--ambient-accent': shellPalette.primary || ambientColor,
    '--hero-art': activeSong?.artwork ? `url(${JSON.stringify(activeSong.artwork)})` : 'none',
    '--art-primary': shellPalette.primary,
    '--art-secondary': shellPalette.secondary,
    '--art-tertiary': shellPalette.tertiary
  } as CSSProperties;

  return (
    <PlaylistsContext.Provider value={playlists}>
    <div ref={shellRef} className={`app-shell ${motionPaused ? 'is-motion-paused' : ''} ${navCollapsed ? 'is-nav-collapsed' : ''}`} data-theme={theme} data-motion-paused={motionPaused ? 'true' : undefined} style={shellStyle}>
      {immersiveOpen ? null : (
        <DynamicAura paused={motionPaused} energy={0.55} mood="energy" palette={shaderPalette} light={theme === 'light'} />
      )}
      <a className="skip-link" href="#main-content">Skip to content</a>
      <AuthDialog open={authOpen} account={account} onClose={() => setAuthOpen(false)} />
      <header className="site-header">
          <div className="site-header-top"><Link className="brand" href={paths.home} aria-label="Allegra home"><img className="brand-mark" src="/allegra-logo.png" alt="" /><span className="brand-word">Allegra<i>.</i></span><span className="brand-mono" aria-hidden="true">A<i>.</i></span></Link><button className="icon-button nav-collapse-toggle" type="button" aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} title={navCollapsed ? 'Expand navigation' : 'Collapse navigation'} onClick={toggleNavigation}>{navCollapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}</button></div>
          <nav className="desktop-nav" aria-label="Primary navigation">
            <Link className={`nav-link ${view === 'home' || view === 'shared' ? 'is-active' : ''}`} aria-current={view === 'home' ? 'page' : undefined} href={paths.home} title="Home"><House size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Home</span></Link>
            <Link className={`nav-link ${view === 'discover' || view === 'album' || view === 'artist' ? 'is-active' : ''}`} aria-current={view === 'discover' ? 'page' : undefined} href={paths.discover} title="Browse"><Compass size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Browse</span></Link>
            <Link className={`nav-link ${view === 'library' || view === 'playlist' ? 'is-active' : ''}`} aria-current={view === 'library' ? 'page' : undefined} href={paths.library} title="Your library"><LibraryIcon size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Your library</span></Link>
            <span className="nav-divider" role="separator" />
            <Link className="nav-link" href={paths.library} title="Recently played" onClick={(event) => openLibrarySection(event, 'library-played-lately')}><Clock size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Recently played</span></Link>
            <Link className={`nav-link ${view === 'liked' ? 'is-active' : ''}`} aria-current={view === 'liked' ? 'page' : undefined} href={paths.liked} title="Favorite songs"><HeartIcon size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Favorite songs</span></Link>
            <Link className="nav-link" href={paths.library} title="Playlists" onClick={(event) => openLibrarySection(event, 'library-playlists')}><ListMusic size={22} strokeWidth={1.5} aria-hidden="true" /><span className="nav-label">Playlists</span></Link>
          </nav>
          <div className="header-actions">
            <button type="button" className="session-chip" onClick={() => setAuthOpen(true)} aria-label={account.profile && !account.profile.isGuest ? 'Open your account' : 'Sign in or create an account'}>
              <span className="session-avatar" aria-hidden="true">{account.profile && !account.profile.isGuest ? (account.profile.displayName ?? account.profile.email ?? 'A').slice(0, 1).toUpperCase() : 'G'}</span>
              <span className="session-copy">
                <strong>{account.profile && !account.profile.isGuest ? (account.profile.displayName ?? 'Your account') : 'Guest'}</strong>
                <small>{account.profile && !account.profile.isGuest ? <><i aria-hidden="true" /> Signed in</> : 'Sign in to keep your music'}</small>
              </span>
            </button>
            <div className="header-buttons"><button className="icon-button theme-toggle" type="button" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>{theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}</button><button className="motion-toggle icon-button" type="button" aria-label={motionPaused ? 'Resume background motion' : 'Pause background motion'} title={motionPaused ? 'Resume background motion' : 'Pause background motion'} onClick={() => setMotionPaused((value) => !value)}>{motionPaused ? <Play size={15} fill="currentColor" aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}</button></div>
          </div>
      </header>

      <main id="main-content" ref={mainRef} tabIndex={-1} aria-label={view === 'home' ? 'Home' : view === 'library' ? 'Your listening library' : view === 'album' ? 'Album' : 'Discover music'} className={`content-wrap ${view !== 'discover' ? 'inner-page-wrap' : ''} ${isDetailView ? 'is-detail' : ''} ${isCollectionView ? 'is-collection' : ''}`}>
        <div className="panel-topbar">
            {isDetailView || isCollectionView ? <button type="button" className="topbar-back" onClick={() => goBack(view === 'liked' || view === 'playlist' ? '#library' : view === 'shared' ? '#home' : '#discover')} aria-label="Back"><ArrowLeft size={17} aria-hidden="true" /><span>Back</span></button> : null}
            <nav className="crumbs" aria-label="Breadcrumb"><span>{view === 'home' || view === 'shared' ? 'Home' : view === 'library' || view === 'liked' || view === 'playlist' ? 'Library' : 'Browse'}</span><ChevronRight size={14} aria-hidden="true" /><strong>{view === 'home' ? 'For you' : view === 'shared' ? 'Shared playlist' : view === 'library' ? 'Your music' : view === 'album' ? 'Album' : view === 'artist' ? 'Artist' : view === 'liked' ? 'Liked Songs' : view === 'playlist' ? 'Playlist' : query.trim() ? 'Search' : 'Made for you'}</strong></nav>
            <div className="mood-pills" role="group" aria-label="Quick picks"><span className="mood-pills-label" aria-hidden="true">Quick picks</span>{moodPrompts.map((prompt) => <button key={prompt} type="button" className="mood-pill" aria-pressed={query === prompt} onClick={() => { if (view !== 'discover') router.push(paths.discover); setQuery(query === prompt ? '' : prompt); }}><span>{prompt}</span></button>)}</div>
            <CommandPalette
              open={paletteOpen}
              onOpen={() => setPaletteOpen(true)}
              onClose={() => setPaletteOpen(false)}
              activeQuery={query.trim()}
              recent={recentlyPlayed}
              theme={theme}
              onPlaySong={(song, queue) => playSong(song, queue)}
              onOpenArtist={openArtist}
              onNavigate={(path) => { router.push(path); }}
              onSearchAll={(value) => { if (view !== 'discover') router.push(paths.discover); setQuery(value); }}
              onToggleTheme={toggleTheme}
              onClearSearch={() => setQuery('')}
            />
        </div>
        {view === 'home' ? (
          <HomePage
            profile={account.profile}
            taste={account.taste}
            recentlyPlayed={recentlyPlayed}
            likedSongs={likedSongs}
            picks={aiPicks}
            picksReason={aiPicksReasoning}
            picksProvider={aiPicksProvider}
            trending={home?.trending ?? []}
            madeForYou={home?.madeForYou ?? []}
            recommended={home?.recommended ?? []}
            faces={faces}
            currentSongId={audio.currentSong?.id ?? null}
            isPlaying={audio.isPlaying}
            likedIds={likedIds}
            loading={personalLoading || playlists.loading}
            onPlay={(song, queue) => playSong(song, queue)}
            onToggle={audio.togglePlayback}
            onLike={toggleLike}
            onOpenArtist={openArtist}
            onSeedTaste={(artistNames, languageNames) => account.seed(artistNames, languageNames)}
            onOpenAuth={() => setAuthOpen(true)}
            onExplore={(value) => { router.push(paths.discover); setQuery(value); }}
          />
        ) : view === 'shared' ? (
          sharedError ? (
            <EmptyState title="This link is not working" copy={sharedError} action={<TactileButton variant="primary" onClick={() => { router.push(paths.home); }}>Go to Home</TactileButton>} />
          ) : (
            <CollectionPage
              kind="shared"
              title={shared?.name ?? 'Shared playlist'}
              songs={shared?.songs ?? []}
              loading={sharedLoading}
              ownerName={shared?.ownerName ?? 'a listener'}
              {...(shared?.coverUrl ? { coverUrl: shared.coverUrl } : {})}
              currentSongId={audio.currentSong?.id ?? null}
              isPlaying={audio.isPlaying}
              likedIds={likedIds}
              onToggle={audio.togglePlayback}
              onPlayTrack={(song, queue) => playSong(song, queue)}
              onPlayAll={(shuffle) => playAlbumTracks(shared?.songs ?? [], shuffle)}
              onLike={toggleLike}
              onOpenAlbum={openAlbum}
              onDiscover={() => { router.push(paths.discover); }}
              onSaveCopy={async () => {
                if (!sharedCode) return;
                const copy = await saveSharedPlaylist(sharedCode);
                await playlists.reload();
                router.push(paths.playlist(copy.id));
              }}
            />
          )
        ) : view === 'library' ? <LibraryPage likedSongs={likedSongs} recentlyPlayed={recentlyPlayed} likedIds={likedIds} loading={personalLoading} error={personalError} actionError={personalActionError} currentSongId={audio.currentSong?.id} isPlaying={audio.isPlaying} onPlay={playSong} onLike={toggleLike} onRetry={() => void loadPersonalSpace()} onDiscover={() => { router.push(paths.discover); window.setTimeout(() => setPaletteOpen(true), 0); }} /> : view === 'liked' ? <CollectionPage kind="liked" title="Liked Songs" songs={likedSongs} loading={personalLoading} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} likedIds={likedIds} onToggle={audio.togglePlayback} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={(shuffle) => playAlbumTracks(likedSongs, shuffle)} onLike={toggleLike} onOpenAlbum={openAlbum} onDiscover={() => { router.push(paths.discover); window.setTimeout(() => setPaletteOpen(true), 0); }} /> : view === 'playlist' ? <CollectionPage kind="playlist" title={activePlaylist?.name ?? (playlists.loading ? 'Playlist' : 'Playlist not found')} songs={activePlaylistSongs} loading={playlists.loading || (activePlaylist !== null && activePlaylistSongs.length < activePlaylist.songIds.length)} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} likedIds={likedIds} onToggle={audio.togglePlayback} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={(shuffle) => playAlbumTracks(activePlaylistSongs, shuffle)} onLike={toggleLike} onOpenAlbum={openAlbum} onDiscover={() => { router.push(paths.discover); window.setTimeout(() => setPaletteOpen(true), 0); }} {...(activePlaylist ? { onDelete: () => { void playlists.remove(activePlaylist.id); router.push(paths.library); }, share: { libraryId: activePlaylist.id, isPublic: activePlaylist.isPublic, onChanged: () => { void playlists.reload(); } }, cover: { libraryId: activePlaylist.id, ...(activePlaylist.coverUrl ? { coverUrl: activePlaylist.coverUrl } : {}), onUpload: playlists.setCover } } : {})} /> : view === 'artist' && artistName ? <ArtistPage name={artistName} profile={artistProfile} photoFallback={faces[artistName.toLocaleLowerCase()] || null} songs={artistTracks} related={relatedArtists} loading={artistLoading && artistTracks.length === 0} error={artistTracks.length === 0 ? artistError : null} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} likedIds={likedIds} onBack={() => goBack(paths.discover)} onRetry={() => setArtistReload((count) => count + 1)} onToggle={audio.togglePlayback} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={(shuffle) => playAlbumTracks(artistTracks, shuffle)} onLike={toggleLike} onOpenAlbum={openAlbumByName} onOpenArtist={openArtist} /> : view === 'album' && albumSeed ? <AlbumPage seed={albumSeed} tracks={albumTracks} palette={palette} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} likedIds={likedIds} onPlayTrack={(song, queue) => playSong(song, queue)} onPlayAll={() => playAlbumTracks(albumTracks, false)} onShuffle={() => playAlbumTracks(albumTracks, true)} onLike={toggleLike} onLikeAlbum={() => toggleLike(albumSeed)} albumLiked={likedIds.has(albumSeed.id)} /> : <>
        <div className="browse-grid">
          <div className="browse-main">
            <motion.section className="hero-banner" variants={pageVariants} initial="hidden" animate="visible" transition={pageTransition} aria-label="Featured track" data-live={audio.isPlaying ? 'true' : undefined} data-searching={isSearching ? 'true' : undefined}>
                 <div className="hero-banner-shader" aria-hidden="true"><MusicFlowShader energy={0.55} palette={bannerPalette} light={theme === 'light'} /></div>
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

            {!isSearching && artists.length > 0 ? <section className="artist-section" aria-labelledby="artists-heading"><div className="section-heading"><h2 id="artists-heading">Popular artists</h2></div><div className="artist-list">{artists.map((artist) => <ArtistPreviewCard key={artist.name} name={artist.name} image={faces[artist.name.toLocaleLowerCase()] || null} photoPending={!(artist.name.toLocaleLowerCase() in faces)} currentSongId={audio.currentSong?.id ?? null} isPlaying={audio.isPlaying} onPlayTrack={(song, queue) => playSong(song, queue)} onOpenArtist={openArtist} />)}</div></section> : null}

        {!isSearching && aiPicks.length > 0 ? <section className="library-section ai-picks-section" aria-labelledby="ai-picks-heading"><div className="library-section-heading"><div><span className="eyebrow eyebrow-accent"><Sparkles size={13} aria-hidden="true" /> {aiPicksProvider ? `AI picks, by ${aiPicksProvider}` : 'AI picks'}</span><h2 id="ai-picks-heading">{aiPicksReasoning ?? 'Picked for your taste'}</h2></div></div><div className="library-track-list">{aiPicks.map((song, index) => <SongCard key={song.id} song={song} index={index} isCurrent={song.id === audio.currentSong?.id} isPlaying={song.id === audio.currentSong?.id && audio.isPlaying} onPlay={(pick) => playSong(pick)} onLike={() => toggleLike(song)} liked={likedIds.has(song.id)} onOpenAlbum={openAlbum} />)}</div></section> : null}

            {isSearching ? (
              <SearchResults
                query={query.trim()}
                songs={displaySongs}
                playlists={playlists.playlists}
                faces={faces}
                searching={searching}
                error={searchError}
                currentSongId={audio.currentSong?.id ?? null}
                isPlaying={audio.isPlaying}
                likedIds={likedIds}
                onPlayTrack={(song, queue) => playSong(song, queue)}
                onLike={toggleLike}
                onOpenAlbum={openAlbum}
                onOpenArtist={openArtist}
                onOpenPlaylist={(id) => { router.push(paths.playlist(id)); }}
                onRetry={retryCurrentSearch}
              />
            ) : (
            <section className="catalog-section" aria-labelledby="catalog-heading" aria-busy={searching}><div className="section-heading"><h2 id="catalog-heading">{sectionLabel}</h2><span className="result-count" aria-live="polite">{searching ? 'Listening…' : `${displaySongs.length} tracks · ${formatTime(queueDuration)}`}</span></div>{searching && displaySongs.length === 0 ? <div className="track-list" aria-label="Loading songs"><SkeletonCard /><SkeletonCard /><SkeletonCard /></div> : searchError && displaySongs.length === 0 ? <EmptyState title="That search did not come back" copy={searchError} action={<TactileButton variant="primary" onClick={retryCurrentSearch}>Try the search again</TactileButton>} /> : displaySongs.length === 0 ? <EmptyState title="Nothing came back" copy="Try an artist, a lyric, or a mood. Start with “Arijit Singh” or “late night.”" action={<TactileButton variant="accent" onClick={() => setQuery('Arijit Singh')}>Try a suggestion</TactileButton>} /> : <><div className="track-head" aria-hidden="true"><span>Track</span><span>Album</span><span>Length</span></div><motion.div className="track-list" variants={pageVariants} initial="hidden" animate="visible">{displaySongs.map((song, index) => <SongCard key={song.id} song={song} index={index} isCurrent={song.id === audio.currentSong?.id} isPlaying={song.id === audio.currentSong?.id && audio.isPlaying} onPlay={(pick) => playSong(pick)} onLike={() => toggleLike(song)} liked={likedIds.has(song.id)} onOpenAlbum={openAlbum} />)}</motion.div></>}</section>
            )}

            <section id="daylight" className="light-scene" aria-labelledby="light-scene-heading">
          {lightSong ? <div className="light-scene-grid"><div className="light-scene-art"><button onClick={() => playSong(lightSong)} aria-label={`Play ${lightSong.title}`}><Artwork song={lightSong} size="large" /></button><div className="light-scene-track"><strong>{lightSong.title}</strong><span>{lightSong.artist}</span></div></div><div className="light-scene-copy"><h2 id="light-scene-heading">Keep listening</h2><p>One more track from your queue, ready when you are.</p><TactileButton variant="primary" icon={Play} aria-label={`Play ${lightSong.title}`} onClick={() => playSong(lightSong)}>Play next</TactileButton></div></div> : <div className="light-scene-empty"><Disc3 size={22} aria-hidden="true" /><p>Play something and your next pick shows up here.</p></div>}
        </section>

            <section id="words" className="lyrics-teaser"><div className="teaser-intro"><div><h2>Lyrics <em>in time</em></h2><p>Follow along with the song you are playing.</p></div><TactileButton variant="secondary" icon={Waves} onClick={() => { if (audio.currentSong) setPlayerMode('workspace'); }}>Open lyrics</TactileButton></div><LyricsPanel lines={displayLyrics} currentTime={audio.currentTime} loading={lyricsLoading} error={lyricsError} onRetry={retryLyrics} onSeek={(time) => void audio.seek(time)} onActivateLine={activateLyricLine} artworkUrl={activeSong?.artwork} translating={translating} translated={showTranslated} translateError={translateError} translateProvider={translateProvider} onToggleTranslate={toggleTranslate} softFocus /></section>
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

      <AnimatePresence>
        {queueOpen && audio.currentSong && !immersiveOpen ? (
          <motion.button
            key="am-queue-scrim"
            type="button"
            className="am-queue-scrim"
            aria-label="Close playing next"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? motionTokens.duration.instant : motionTokens.duration.fast, ease: motionTokens.ease.standard }}
            onClick={() => setQueueOpen(false)}
          />
        ) : null}
      </AnimatePresence>

      {/* Phone tab bar (Apple HIG / Material navigation-bar pattern): four labelled destinations,
          navigation only. CSS shows it under 900px, where the mini player docks on top of it as a
          shelf and the desktop rail's links give way to it. */}
      <nav className="bottom-nav" aria-label="Primary">
        <Link className={`bottom-nav__item${view === 'home' || view === 'shared' ? ' is-active' : ''}`} href={paths.home} aria-current={view === 'home' ? 'page' : undefined}>
          <House size={22} strokeWidth={1.7} aria-hidden="true" /><span>Home</span>
        </Link>
        <Link className={`bottom-nav__item${view === 'discover' || view === 'album' || view === 'artist' ? ' is-active' : ''}`} href={paths.discover} aria-current={view === 'discover' ? 'page' : undefined}>
          <Compass size={22} strokeWidth={1.7} aria-hidden="true" /><span>Browse</span>
        </Link>
        <Link className={`bottom-nav__item${view === 'library' || view === 'playlist' || view === 'liked' ? ' is-active' : ''}`} href={paths.library} aria-current={view === 'library' ? 'page' : undefined}>
          <LibraryIcon size={22} strokeWidth={1.7} aria-hidden="true" /><span>Library</span>
        </Link>
        <button type="button" className={`bottom-nav__item${paletteOpen ? ' is-active' : ''}`} aria-haspopup="dialog" onClick={() => setPaletteOpen(true)}>
          <SearchIcon size={22} strokeWidth={1.7} aria-hidden="true" /><span>Search</span>
        </button>
      </nav>

      {audio.currentSong && !immersiveOpen ? (
        <motion.div
          className={`mini-player${queueOpen ? ' is-queue-open' : ''}`}
          role="region"
          aria-label="Player bar"
          // Centred with translateX(-50%). Motion writes its own inline transform once a drag
          // starts (any tap on play/pause), which would drop the CSS one and shove the bar right;
          // handing it the offset keeps both in the one transform it writes.
          style={{ x: '-50%' }}
          drag={isNarrowViewport && !reduced ? 'y' : false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.3, bottom: 0 }}
          onDragEnd={(_event, info) => {
            if (info.offset.y < -80 || info.velocity.y < -500) setPlayerMode('immersive');
          }}
        >
          <div className="am-transport">
            <button type="button" className={`am-btn ${audio.shuffle ? 'is-on' : ''}`} aria-pressed={audio.shuffle} aria-label={audio.shuffle ? 'Shuffle on' : 'Shuffle off'} title="Shuffle" onClick={audio.toggleShuffle}><Shuffle size={16} aria-hidden="true" /></button>
            <button type="button" className="am-btn am-btn--skip" aria-label="Previous track" title="Previous" onClick={audio.skipPrevious}><SkipBack size={20} fill="currentColor" aria-hidden="true" /></button>
            <button type="button" className="am-play" onClick={audio.togglePlayback} aria-label={audio.isPlaying ? 'Pause' : 'Play'}>
              {audio.isBuffering ? <Disc3 size={20} className="spin" aria-hidden="true" /> : audio.isPlaying ? <Pause size={22} fill="currentColor" aria-hidden="true" /> : <Play size={22} fill="currentColor" aria-hidden="true" />}
            </button>
            <button type="button" className="am-btn am-btn--skip" aria-label="Next track" title="Next" onClick={skipNextSmart}><SkipForward size={20} fill="currentColor" aria-hidden="true" /></button>
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
            <button type="button" className="am-btn am-btn--mute" aria-label={audio.isMuted ? 'Unmute' : 'Mute'} title={audio.isMuted ? 'Unmute' : 'Mute'} onClick={audio.toggleMute}>{audio.isMuted || audio.volume === 0 ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}</button>
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
            <button type="button" className="am-btn am-btn--lyrics" aria-label="Lyrics" title="Lyrics" onClick={() => setPlayerMode('workspace')}><Waves size={17} aria-hidden="true" /></button>
            <button
              ref={queueToggleRef}
              type="button"
              className={`am-btn am-btn--queue ${queueOpen ? 'is-on' : ''}`}
              aria-pressed={queueOpen}
              aria-expanded={queueOpen}
              aria-controls="am-playing-next"
              aria-label="Playing next"
              title="Playing next"
              onClick={() => setQueueOpen((open) => !open)}
            >
              <ListMusic size={17} aria-hidden="true" />
              {playingNext.length > 0 ? <span className="am-queue-badge" aria-hidden="true">{Math.min(playingNext.length, 99)}</span> : null}
            </button>
          </div>

          <AnimatePresence>
            {queueOpen ? (
              <motion.div
                key="am-queue"
                ref={queuePanelRef}
                id="am-playing-next"
                className="am-queue"
                role="dialog"
                aria-modal="true"
                aria-label="Playing next"
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
                transition={reduced ? { duration: motionTokens.duration.instant } : spring.sheet}
              >
                <div className="am-queue-head">
                  <div className="am-queue-title">
                    <strong>Playing Next</strong>
                    <span>
                      {playingNext.length === 0
                        ? 'Queue empty'
                        : `${playingNext.length} ${playingNext.length === 1 ? 'song' : 'songs'} · ${formatTime(playingNextDuration)}`}
                    </span>
                  </div>
                  <button type="button" className="am-btn am-queue-close" aria-label="Close playing next" onClick={() => setQueueOpen(false)}>
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>

                {audio.currentSong ? (
                  <div className="am-queue-now" aria-label="Now playing">
                    <span className="am-queue-eyebrow">Now playing</span>
                    <div className="am-queue-row is-current">
                      <Artwork song={audio.currentSong} size="small" />
                      <span className="am-queue-copy">
                        <strong>{audio.currentSong.title}</strong>
                        <small>{audio.currentSong.artist}</small>
                      </span>
                      <span className="am-queue-meta">{audio.isPlaying ? 'Playing' : 'Paused'}</span>
                    </div>
                  </div>
                ) : null}

                <div className="am-queue-section">
                  <span className="am-queue-eyebrow">Up next</span>
                  <div className="am-queue-list">
                    {playingNext.length === 0 ? (
                      <div className="am-queue-empty">
                        <ListMusic size={18} aria-hidden="true" />
                        <span>Nothing queued after this song. Play an album or search to build a queue.</span>
                      </div>
                    ) : (
                      playingNext.slice(0, 16).map((song, index) => (
                        <button
                          key={`${song.id}-${index}`}
                          type="button"
                          className="am-queue-row"
                          aria-label={`Play ${song.title} by ${song.artist}`}
                          onClick={() => {
                            playSong(song, audio.queue);
                            setQueueOpen(false);
                          }}
                        >
                          <span className="am-queue-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                          <Artwork song={song} size="small" />
                          <span className="am-queue-copy">
                            <strong>{song.title}</strong>
                            <small>{song.artist}</small>
                          </span>
                          <span className="am-queue-time">{formatTime(song.duration)}</span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
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
        isBuffering={audio.isBuffering}
        playbackError={audio.error}
        liked={audio.currentSong ? likedIds.has(audio.currentSong.id) : false}
        lyrics={{
          lines: displayLyrics,
          currentTime: audio.currentTime,
          loading: lyricsLoading,
          error: lyricsError,
          onRetry: retryLyrics,
          onSeek: (time) => void audio.seek(time),
          onActivateLine: activateLyricLine,
          artworkUrl: audio.currentSong?.artwork,
          translating,
          translated: showTranslated,
          translateError,
          translateProvider,
          onToggleTranslate: toggleTranslate
        }}
        palette={palette}
        light={theme === 'light'}
        energy={playerEnergy}
        suggestions={suggestions.length > 0 ? suggestions : aiPicks}
        muted={audio.isMuted}
        onMute={audio.toggleMute}
        liveKaraoke={liveKaraoke}
        onCollapse={collapsePlayer}
        onOpenWorkspace={() => setPlayerMode('workspace')}
        onOpenImmersive={() => setPlayerMode('immersive')}
        onToggle={audio.togglePlayback}
        onNext={skipNextSmart}
        onPrevious={audio.skipPrevious}
        onSeek={(time) => void audio.seek(time)}
        onLike={() => { if (audio.currentSong) toggleLike(audio.currentSong); }}
        onPlayQueueSong={(song) => playSong(song, audio.queue.length > 0 ? audio.queue : displaySongs)}
        onOpenAlbum={openAlbumFromPlayer}
        onOpenArtist={openArtistFromPlayer}
      />
      <OfflineToast visible={offline} />
    </div>
    </PlaylistsContext.Provider>
  );
}
