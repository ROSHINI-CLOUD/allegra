import { SearchCategories } from '../components/search/SearchCategories';
import { SearchCategoryResults } from '../components/search/SearchCategoryResults';
import { useSearchSessionStore } from '../store/searchSessionStore';
import { AppScreen } from '../components/AppScreen';
import { TypeScale } from '../constants/allegraTheme';
/**
 * Search — one field for everything: what is on this phone (downloaded songs
 * and your playlists) and what is online (the streaming catalog).
 *
 *   All            best of both: phone matches first (they play instantly,
 *                  offline), then the catalog
 *   On this phone  every local song and playlist that matches
 *   Online         the catalog, streamable, with ↓ to save
 *
 * Phone results answer as you type (native index, ~120ms debounce). The
 * catalog waits for a pause (350ms) and a sequence number drops any answer
 * that arrives after a newer query. Empty field: recent searches and moods.
 *
 * Same room as Stream: Allegra's live shader tinted by the playing cover, a
 * frosted field, sentence-case shelves, the shared SongRow.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import type { PerformanceAttempt } from '@shared/performanceTrace';
import { PrefixCache, TYPEAHEAD_DEBOUNCE_MS } from '@shared/typeahead';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Artwork from '../components/allegra/Artwork';
import { SectionHeading } from '../components/allegra/home';
import { InfoTitleRow, InfoTour } from '../components/allegra/InfoTour';
import { SEARCH_TOUR, searchScene } from '../components/allegra/infoTours';
import { RiseIn, Tactile, TactileRow } from '../components/allegra/motion';
import { GUTTER, MoodChips, SongRow, TrackItem } from '../components/stream/StreamHome';
import { useStreamSongActions } from '../components/stream/useStreamSongActions';
import { Toast } from '../components/Toast';
import { Glass, Radius, Signal, Space, Surface } from '../constants/allegraTheme';
import { useVoiceField } from '../components/search/VoiceField';
import { playVoicePick } from '../services/voicePlay';
import { useVoiceSearchStore } from '../store/voiceSearchStore';
import { Button, IconButton, Sheet, SheetOption, SongRow as SharedSongRow } from '../ui';
import { navigationRef } from '../utils/navigationService';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { openPlayerSheet } from '../navigation/playerSheet';
import { androidPerformance } from '../services/performanceTrace';
import { searchOfficial } from '../services/stream/officialSearch';
import { StreamService } from '../services/stream/StreamService';
import { streamIdFor } from '../services/stream/streamSong';
import type { YTPageItem } from '../services/ytmusic/browse';
import { YTMusicClient } from '../services/ytmusic/YTMusicClient';
import { useDownloadQueueStore } from '../store/downloadQueueStore';
import { usePlayerStore } from '../store/playerStore';
import { usePlaylistStore } from '../store/playlistStore';
import { useSearchHistoryStore } from '../store/searchHistoryStore';
import { useSettingsStore } from '../store/settingsStore';
import { useSongsStore } from '../store/songsStore';
import { TabScreenProps } from '../types/navigation';
import { Playlist, Song, UnifiedSong } from '../types/song';
import * as Haptics from '../utils/haptics';
import { ProfileButton } from '../components/nav/ProfileButton';

type YTArtistResult = YTPageItem<'artist'>;

type Props = TabScreenProps<'Search'>;
type Scope = 'All' | 'On this phone' | 'Online';
const SCOPES: Scope[] = ['All', 'On this phone', 'Online'];

const LOCAL_DEBOUNCE_MS = 120;
/** Catalog answers for the session, so typing on (or backspacing) shows something at once. */
const onlineAnswers = new PrefixCache<UnifiedSong>();
const songText = (song: UnifiedSong): string => `${song.title} ${song.artist}`;
/** In "All", each side shows this many before "See all". */
const PREVIEW = 4;

const MOODS = [
  { label: 'Chill', query: 'chill lofi', icon: 'cafe-outline' },
  { label: 'Energy', query: 'workout hits', icon: 'flash-outline' },
  { label: 'Romance', query: 'romantic hits', icon: 'heart-outline' },
  { label: 'Focus', query: 'instrumental focus', icon: 'leaf-outline' },
  { label: 'Party', query: 'party hits', icon: 'musical-notes-outline' },
  { label: 'Heartbreak', query: 'sad songs', icon: 'rainy-outline' },
] as const;

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();

const SearchScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const bottomClearance = useBottomClearance();

  const inputRef = useRef<TextInput>(null);

  const searchSongs = useSongsStore(s => s.searchSongs);
  const librarySongs = useSongsStore(s => s.songs);
  const playlists = usePlaylistStore(s => s.playlists);
  const currentSongId = usePlayerStore(s => s.currentSongId);

  const playInMiniPlayerOnly = useSettingsStore(s => s.playInMiniPlayerOnly);
  const recent = useSearchHistoryStore(s => s.recent);
  const remember = useSearchHistoryStore(s => s.remember);
  const forget = useSearchHistoryStore(s => s.forget);
  const clearRecent = useSearchHistoryStore(s => s.clear);
  const addToDownloads = useDownloadQueueStore(s => s.addToQueue);

  const query = useSearchSessionStore(s => s.sessions.search.query);
  const scope = useSearchSessionStore(s => s.sessions.search.scope);
  const category = useSearchSessionStore(s => s.sessions.search.category);
  const patchSearch = useSearchSessionStore(s => s.patch);
  const setQuery = useCallback((text: string) => patchSearch('search', { query: text }), [patchSearch]);
  const setScope = useCallback((nextScope: Scope) => patchSearch('search', { scope: nextScope }), [patchSearch]);
  const scrollRef = useRef<ScrollView>(null);
  const initialOffset = useRef(useSearchSessionStore.getState().sessions.search.offset);
  const restoredScroll = useRef(false);
  const leaveSearch = useCallback(() => {
    Keyboard.dismiss();
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Stream');
  }, [navigation]);
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { leaveSearch(); return true; });
    return () => sub.remove();
  }, [leaveSearch]));
  const [local, setLocal] = useState<Song[]>([]);
  const [online, setOnline] = useState<UnifiedSong[] | null>(null);
  const [artists, setArtists] = useState<YTArtistResult[]>([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const localSeq = useRef(0);
  const onlineSeq = useRef(0);
  const localGeneration = useRef(0);
  const onlineGeneration = useRef(0);
  const measuredQuery = useRef('');
  const measuredScope = useRef<Scope>('All');
  const localAttempt = useRef<PerformanceAttempt | null>(null);
  const onlineAttempt = useRef<PerformanceAttempt | null>(null);
  const localResultsAttempt = useRef<PerformanceAttempt | null>(null);
  const onlineResultsAttempt = useRef<PerformanceAttempt | null>(null);
  const localCommittedAttempt = useRef<PerformanceAttempt | null>(null);
  const onlineCommittedAttempt = useRef<PerformanceAttempt | null>(null);
  const onlineSearchFailed = useRef(false);


  const q = query.trim();

  const startSearch = useCallback((nextQuery: string, nextScope: Scope = scope) => {
    setQuery(nextQuery);
    setScope(nextScope);
    if (!androidPerformance.trace.enabled) return;

    const nextText = nextQuery.trim();
    const queryChanged = nextText !== measuredQuery.current;
    const scopeChanged = nextScope !== measuredScope.current;
    measuredQuery.current = nextText;
    measuredScope.current = nextScope;
    if (!queryChanged && !scopeChanged) return;

    if (queryChanged) localResultsAttempt.current = null;
    onlineResultsAttempt.current = null;
    if (queryChanged && nextText) {
      const attempt = androidPerformance.beginSearchAttempt('local', ++localGeneration.current);
      localAttempt.current = attempt;
      androidPerformance.record(attempt, 'query.changed');
    } else if (queryChanged) {
      androidPerformance.finish(localAttempt.current, 'aborted');
      localAttempt.current = null;
    }

    if (nextText && nextScope !== 'On this phone') {
      const attempt = androidPerformance.beginSearchAttempt('online', ++onlineGeneration.current);
      onlineAttempt.current = attempt;
      onlineSearchFailed.current = false;
      if (queryChanged) androidPerformance.record(attempt, 'query.changed');
    } else {
      androidPerformance.finish(onlineAttempt.current, 'aborted');
      onlineAttempt.current = null;
    }
  }, [scope, setQuery, setScope]);

  const changeScope = useCallback((nextScope: Scope) => {
    startSearch(query, nextScope);
  }, [query, startSearch]);

  // Opening Search from the ••• menu means "I want to type": focus the field.
  useFocusEffect(useCallback(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []));

  // ── Phone: native index, answers while typing ──────────────────────────
  useEffect(() => {
    const seq = ++localSeq.current;
    if (!q) { setLocal([]); return; }
    const attempt = localAttempt.current;
    const t = setTimeout(async () => {
      androidPerformance.record(attempt, 'search.dispatched');
      const startedAt = androidPerformance.trace.enabled ? performance.now() : 0;
      let failed = false;
      const found = await searchSongs(q).catch(() => {
        failed = true;
        return [] as Song[];
      });
      if (attempt) {
        androidPerformance.record(attempt, 'catalog.completed', {
          resultCount: found.length,
          ...(androidPerformance.trace.enabled ? { durationMs: Math.max(0, performance.now() - startedAt) } : {}),
        });
      }
      if (seq === localSeq.current) {
        if (failed) {
          androidPerformance.finish(attempt, 'search-failure');
          localResultsAttempt.current = null;
        } else {
          localResultsAttempt.current = attempt;
        }
        setLocal(found);
      }
    }, LOCAL_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, searchSongs]);

  useEffect(() => {
    const attempt = localResultsAttempt.current;
    if (!androidPerformance.trace.enabled || !q || !attempt || localCommittedAttempt.current === attempt) return;
    if (!androidPerformance.record(attempt, 'results.committed', { resultCount: local.length })) return;
    localCommittedAttempt.current = attempt;
    const frame = requestAnimationFrame(() => {
      if (!androidPerformance.record(attempt, 'results.presented', { resultCount: local.length })) return;
      if (local.length === 0) androidPerformance.finish(attempt, 'empty', { resultCount: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [local, q]);

  // ── Online: the catalog, on every keystroke ────────────────────────────
  // The longest prefix already answered shows at once, narrowed; the live answer replaces it.
  // Songs paint as soon as they land; artists fill in on their own.
  useEffect(() => {
    const seq = ++onlineSeq.current;
    setOnlineBusy(false);
    if (!q) { setOnline(null); setArtists([]); return; }
    // Scoped to the phone: keep the last catalog answer, don't fetch.
    if (scope === 'On this phone') return;
    const attempt = onlineAttempt.current;
    const known = onlineAnswers.instant(q, songText);
    if (known) setOnline([...known.items]);
    if (known?.exact) {
      if (attempt && androidPerformance.record(attempt, 'catalog.completed', { durationMs: 0, resultCount: known.items.length, cache: 'warm' })) {
        onlineResultsAttempt.current = attempt;
      }
      return;
    }
    setOnlineBusy(true);
    const controller = new AbortController();
    const t = setTimeout(() => {
      androidPerformance.record(attempt, 'search.dispatched');
      const startedAt = androidPerformance.trace.enabled ? performance.now() : 0;
      const elapsed = () => (androidPerformance.trace.enabled ? { durationMs: Math.max(0, performance.now() - startedAt) } : {});
      let failed = false;
      searchOfficial(q, 20, undefined, controller.signal).catch(() => {
        failed = true;
        return [] as UnifiedSong[];
      }).then(found => {
        androidPerformance.record(attempt, 'catalog.completed', { resultCount: found.length, ...elapsed() });
        if (seq !== onlineSeq.current) return; // a newer query won
        if (found.length > 0) onlineAnswers.set(q, found);
        onlineSearchFailed.current = failed;
        onlineResultsAttempt.current = attempt;
        setOnline(found);
        setOnlineBusy(false);
      });
      YTMusicClient.searchArtists(q).catch(() => [] as YTArtistResult[]).then(people => {
        androidPerformance.record(attempt, 'artists.completed', { resultCount: people.length, ...elapsed() });
        if (seq === onlineSeq.current) setArtists(people.slice(0, 8));
      });
    }, TYPEAHEAD_DEBOUNCE_MS);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [q, scope]);

  const matchingPlaylists = useMemo(() => {
    if (!q) return [];
    const needle = norm(q);
    return playlists.filter(p => norm(p.name).includes(needle)).slice(0, 8);
  }, [q, playlists]);

  // Online results that are already downloaded are shown once, under the phone.
  const onlineFresh = useMemo(() => {
    if (!online) return [];
    const have = new Set(local.map(s => `${norm(s.title)}|${norm(s.artist ?? '')}`));
    return online.filter(s => !have.has(`${norm(s.title)}|${norm(s.artist)}`));
  }, [online, local]);

  useEffect(() => {
    const attempt = onlineResultsAttempt.current;
    if (!androidPerformance.trace.enabled || !q || !online || !attempt || onlineCommittedAttempt.current === attempt) return;
    if (!androidPerformance.record(attempt, 'results.committed', { resultCount: onlineFresh.length })) return;
    onlineCommittedAttempt.current = attempt;
    const frame = requestAnimationFrame(() => {
      if (!androidPerformance.record(attempt, 'results.presented', { resultCount: onlineFresh.length })) return;
      if (onlineFresh.length === 0) {
        androidPerformance.finish(attempt, onlineSearchFailed.current ? 'search-failure' : 'empty', { resultCount: 0 });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [online, onlineFresh, q]);

  // ── Actions ────────────────────────────────────────────────────────────
  const commit = useCallback(() => { if (q) remember(q); }, [q, remember]);

  const playLocal = useCallback((list: Song[], index: number) => {
    Haptics.selectionAsync().catch(() => {});
    commit();
    Keyboard.dismiss();
    const song = list[index];
    const player = usePlayerStore.getState();
    const alreadyOn = player.currentSongId === song.id;
    if (!alreadyOn) {
      const attempt = localResultsAttempt.current;
      const observingPlayback = androidPerformance.selectPlayback('local', attempt, song.id);
      if (observingPlayback) androidPerformance.playbackCommanded(attempt);
      // The whole library is the queue, so next/auto-next keep going.
      const libIndex = librarySongs.findIndex(s => s.id === song.id);
      if (libIndex !== -1) player.setPlaylistQueue('library', librarySongs, libIndex);
      else player.setPlaylistQueue('search', list, index);
      if (observingPlayback) {
        const currentId = usePlayerStore.getState().currentSongId;
        if (currentId === player.currentSongId) androidPerformance.finish(attempt, 'remote-routed');
        else if (currentId !== song.id) androidPerformance.finish(attempt, 'aborted');
      }
      // Online, what follows becomes this song's radio; offline the library carries on.
      if (useSettingsStore.getState().autoQueueRefill ?? true) StreamService.startRadio(song).catch(() => {});
    }
    if (!playInMiniPlayerOnly || alreadyOn) openPlayerSheet(song.id);
  }, [commit, librarySongs, playInMiniPlayerOnly]);

  const playOnline = useCallback((list: UnifiedSong[], index: number) => {
    Haptics.selectionAsync().catch(() => {});
    commit();
    Keyboard.dismiss();
    const song = list[index];
    const playerBefore = usePlayerStore.getState();
    const selectedId = streamIdFor(song);
    const attempt = playerBefore.currentSongId === selectedId ? null : onlineResultsAttempt.current;
    const observingPlayback = androidPerformance.selectPlayback('online', attempt, selectedId);
    if (observingPlayback) androidPerformance.playbackCommanded(attempt);
    StreamService.playFromSearch(song);
    if (observingPlayback) {
      const currentId = usePlayerStore.getState().currentSongId;
      if (currentId === playerBefore.currentSongId) androidPerformance.finish(attempt, 'remote-routed');
      else if (currentId !== selectedId) androidPerformance.finish(attempt, 'aborted');
    }
  }, [commit]);

  // Round 7 item 9: Download sits beside the ⋮ on every catalog result again.
  const save = useCallback((song: UnifiedSong) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    addToDownloads([song]);
    setToast(`Saving \u201c${song.title}\u201d to your library`);
  }, [addToDownloads]);

  // The trace actions are a short list of choices, so they open as a sheet, not a system dialog.
  const [traceCount, setTraceCount] = useState<number | null>(null);
  const showTraceActions = useCallback(() => {
    setTraceCount(androidPerformance.trace.exportRecords().length);
  }, []);
  const clearTrace = useCallback(() => {
    setTraceCount(null);
    androidPerformance.clearSnapshot();
    setToast('Local performance trace cleared');
  }, []);
  const dumpTrace = useCallback(() => {
    setTraceCount(null);
    const written = androidPerformance.dumpSnapshotToLog();
    setToast(`Emitted ${written} trace records to local Android logcat`);
  }, []);

  // A long press opens the song's actions (Play next first), as everywhere in the app.
  const songActions = useStreamSongActions({ onDone: setToast });
  const queueNext = songActions.open;

  const searchFor = useCallback((text: string, nextScope: Scope = 'All') => {
    Haptics.selectionAsync().catch(() => {});
    startSearch(text, nextScope);
    remember(text);
    Keyboard.dismiss();
  }, [remember, startSearch]);

  const clearField = useCallback(() => {
    startSearch('', scope);
    inputRef.current?.focus();
  }, [scope, startSearch]);

  // Round 7 item 6: voice search lives in the field. What was heard becomes the query (editable, remembered).
  const heard = useCallback((text: string) => { startSearch(text, 'All'); remember(text); Keyboard.dismiss(); }, [startSearch, remember]);
  const typeInstead = useCallback((text: string) => { startSearch(text, scope); inputRef.current?.focus(); }, [scope, startSearch]);
  const voice = useVoiceField({ onHeard: heard, onType: typeInstead });
  const voicePicks = useVoiceSearchStore(s => (s.origin === 'field' && s.phase === 'results' ? s.picks : null));
  const voiceSelected = useVoiceSearchStore(s => s.selected);
  const topMatch = voicePicks?.[voiceSelected];
  const playTopMatch = useCallback(() => {
    if (!voicePicks) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    playVoicePick(voicePicks, voiceSelected);
    useVoiceSearchStore.getState().dismiss();
  }, [voicePicks, voiceSelected]);

  const localTrack = (s: Song): TrackItem => ({
    key: s.id, title: s.title, artist: s.artist, artwork: s.coverImageUri, isCurrent: currentSongId === s.id,
  });
  const onlineTrack = (s: UnifiedSong): TrackItem => ({
    key: streamIdFor(s), title: s.title, artist: s.artist, artwork: s.highResArt, isCurrent: currentSongId === streamIdFor(s), download: s,
  });

  // ── Body ───────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (!q) {
    body = (
      <RiseIn>
        {recent.length > 0 ? (
          <>
            <SectionHeading title="Recent searches" action="Clear" onAction={clearRecent} />
            <View style={styles.list}>
              {recent.map(r => (
                <View key={r} style={styles.recentRow}>
                  <TactileRow
                    onPress={() => searchFor(r)}
                    wrapperStyle={styles.recentMainCell}
                    style={styles.recentMain}
                    accessibilityRole="button"
                    accessibilityLabel={`Search ${r}`}
                  >
                    <Ionicons name="time-outline" size={18} color={Signal.inkMuted} />
                    <Text style={styles.recentText} numberOfLines={1}>{r}</Text>
                  </TactileRow>
                  <Tactile onPress={() => forget(r)} hitSlop={10} pressScale={0.9} accessibilityRole="button" accessibilityLabel={`Remove ${r}`}>
                    <Ionicons name="close" size={18} color={Signal.inkFaint} />
                  </Tactile>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <SectionHeading title="Browse by mood" />
        <View style={styles.moodGrid}>
          {MOODS.map((m, i) => (
            <Tactile
              key={m.label}
              onPress={() => searchFor(m.query, 'Online')}
              pressScale={0.96}
              accessibilityRole="button"
              accessibilityLabel={`${m.label} music`}
              wrapperStyle={styles.moodCell}
              style={styles.mood}
            >
              <LinearGradient
                colors={MOOD_TONES[i % MOOD_TONES.length]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <Ionicons name={m.icon} size={22} color={Signal.ink} />
              <Text style={styles.moodLabel}>{m.label}</Text>
            </Tactile>
          ))}
        </View>
      </RiseIn>
    );
  } else {
    const showPhone = scope !== 'Online';
    const showOnline = scope !== 'On this phone';
    const phoneSongs = scope === 'All' ? local.slice(0, PREVIEW) : local;
    const onlineSongs = scope === 'All' ? onlineFresh.slice(0, PREVIEW * 2) : onlineFresh;
    const nothingLocal = local.length === 0 && matchingPlaylists.length === 0;

    body = (
      <View>
        {showPhone ? (
          <>
            <SectionHeading
              title="On this phone"
              subtitle={local.length ? `${local.length} ${local.length === 1 ? 'song' : 'songs'} · plays offline` : undefined}
              action={scope === 'All' && local.length > PREVIEW ? 'See all' : undefined}
              onAction={() => changeScope('On this phone')}
            />
            {local.length === 0 ? (
              <Text style={styles.empty}>
                {nothingLocal ? 'Nothing downloaded matches. Online results are below.' : 'No songs match, only playlists.'}
              </Text>
            ) : (
              <View style={styles.list}>
                {phoneSongs.map((s, i) => (
                  <SongRow key={s.id} item={localTrack(s)} onPress={() => playLocal(phoneSongs, i)} />
                ))}
              </View>
            )}
          </>
        ) : null}

        {showOnline && category === 'All' && artists.length > 0 ? (
          <>
            <SectionHeading title="Artists" />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf} keyboardShouldPersistTaps="handled">
              {artists.map(a => (
                <Tactile
                  key={a.browseId}
                  onPress={() => { commit(); Keyboard.dismiss(); navigation.navigate('Browse', { screen: 'Artist', params: { name: a.title, browseId: a.browseId } }); }}
                  pressScale={0.96}
                  accessibilityRole="button"
                  accessibilityLabel={`Artist ${a.title}`}
                  style={styles.personCard}
                >
                  <View style={styles.personArt}>
                    <Artwork uri={a.thumbnail} title={a.title} size={96} style={StyleSheet.absoluteFill} />
                  </View>
                  <Text style={[styles.cardTitle, styles.center]} numberOfLines={1}>{a.title}</Text>
                </Tactile>
              ))}
            </ScrollView>
          </>
        ) : null}

        {showOnline ? (
          <>
            <SectionHeading
              title="Online"
              subtitle={onlineBusy ? 'Finding official releases…' : online ? `${onlineFresh.length} to stream` : undefined}
              action={scope === 'All' && onlineFresh.length > PREVIEW * 2 ? 'See all' : undefined}
              onAction={() => changeScope('Online')}
            />
            {onlineBusy && onlineFresh.length === 0 ? (
              <ActivityIndicator color={Signal.wave} style={styles.spinner} />
            ) : null}
            {!onlineBusy && online && onlineFresh.length === 0 ? (
              <Text style={styles.empty}>Nothing streamable for that. Try the artist name or another spelling — or check your connection.</Text>
            ) : null}
            <View style={styles.list}>
              {onlineSongs.map((s, i) => (
                <SongRow
                  key={streamIdFor(s)}
                  item={onlineTrack(s)}
                  onPress={() => playOnline(onlineSongs, i)}
                  onLongPress={() => queueNext(s)}
                  onSave={() => save(s)}
                />
              ))}
            </View>
          </>
        ) : null}
      </View>
    );
  }

  if (q && category !== 'All' && category !== 'Songs') {
    body = <SearchCategoryResults query={q} category={category} scope={scope} localSongs={local} />;
  } else if (q && category === 'All') {
    body = <>{body}<SearchCategoryResults query={q} category={category} scope={scope} localSongs={local} /></>;
  }

  return (
    <AppScreen style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        onScroll={e => patchSearch('search', { offset: e.nativeEvent.contentOffset.y })}
        scrollEventThrottle={100}
        onContentSizeChange={() => { if (!restoredScroll.current && initialOffset.current > 0) { scrollRef.current?.scrollTo({ y: initialOffset.current, animated: false }); restoredScroll.current = true; } }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: insets.top + Space.xs, paddingBottom: bottomClearance }}
      >
        <View style={[styles.header, styles.headerLead]}>
          {/* 1.42.0 (Spotify's place): your picture opens the profile menu. */}
          <IconButton icon="arrow-back" label="Back from Search" variant="plain" onPress={leaveSearch} />
          <ProfileButton />
          <InfoTitleRow>
            <Text style={styles.title} accessibilityRole="header">Search</Text>
            <InfoTour label="About Search" steps={SEARCH_TOUR} scene={searchScene} />
            {androidPerformance.trace.enabled ? (
              <Tactile onPress={showTraceActions} pressScale={0.97} accessibilityRole="button" accessibilityLabel="Local performance trace" style={styles.traceButton}>
                <Text style={styles.traceButtonLabel}>Trace</Text>
              </Tactile>
            ) : null}
          </InfoTitleRow>
          {/* 1.44.0 (Spotify's place): scan a LuvLyrics code someone shows you. */}
          <View style={styles.headerSpacer} />
          <IconButton icon="camera-outline" label="Scan a LuvLyrics code" variant="plain" onPress={() => navigationRef.navigate('ScanCode')} />
        </View>

        <View style={styles.searchBox} accessibilityRole="search">
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={Signal.inkMuted} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={text => startSearch(text)}
            onSubmitEditing={commit}
            placeholder="Songs, artists, albums, playlists"
            placeholderTextColor={Signal.inkFaint}
            returnKeyType="search"
            autoCorrect={false}
            style={styles.searchInput}
            accessibilityLabel="Search your phone and the catalog"
          />
          {query.length > 0 && !voice.busy ? (
            <Tactile onPress={clearField} pressScale={0.9} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clearTarget}>
              <Ionicons name="close-circle" size={18} color={Signal.inkMuted} />
            </Tactile>
          ) : null}
          {voice.trailing}
        </View>
        {voice.panel}
        </View>

        {topMatch ? (
          <View style={styles.topMatch} accessibilityRole="summary" accessibilityLabel="Top match">
            <SharedSongRow title={topMatch.song.title} artist={topMatch.song.artist}
              artwork={topMatch.kind === 'local' ? topMatch.song.coverImageUri : topMatch.song.highResArt}
              meta={topMatch.kind === 'local' ? 'In your library' : 'Top match'} onPress={playTopMatch}
              trailing={<Button label="Play" icon="play" variant="primary" size="compact" onPress={playTopMatch} />} />
          </View>
        ) : null}

        {q ? <SearchCategories selected={category} onSelect={nextCategory => patchSearch('search', { category: nextCategory })} /> : null}
        {q && category !== 'Playlists' ? (
          <View style={styles.chips}>
            <MoodChips moods={SCOPES} selected={scope} onSelect={s => changeScope((s as Scope | null) ?? 'All')} />
          </View>
        ) : null}

        <View style={voice.busy ? styles.dim : undefined} pointerEvents={voice.busy ? 'none' : 'auto'}>{body}</View>
      </ScrollView>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(10, 11, 14, 0.92)', 'rgba(10, 11, 14, 0)']}
        style={[styles.statusScrim, { height: insets.top + 16 }]}
      />
      {songActions.element}
      <Sheet visible={traceCount !== null} onClose={() => setTraceCount(null)} title="Local performance trace">
        <SheetOption icon="trash-outline" label="Clear" hint={`${traceCount ?? 0} bounded records in memory`} onPress={clearTrace} />
        <SheetOption icon="document-text-outline" label="Dump to device log" onPress={dumpTrace} />
      </Sheet>
      {toast ? <Toast visible message={toast} type="info" duration={2200} onDismiss={() => setToast(null)} /> : null}
    </AppScreen>
  );
};

/** Quiet duotones for the mood tiles — Allegra's warm/cool support colours. */
const MOOD_TONES: readonly [string, string][] = [
  ['#2c4a5e', '#16202a'],
  ['#6a5c1c', '#24220f'],
  ['#6b2f38', '#241217'],
  ['#2f5a45', '#122019'],
  ['#4b2f6b', '#1a1224'],
  ['#3a4660', '#141820'],
];

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bg },
  header: { height: 52, justifyContent: 'center', paddingHorizontal: GUTTER },
  // The picture's 48dp target starts at the gutter's edge, as on Stream and Library.
  headerLead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: Space.xs, paddingLeft: GUTTER - Space.sm, paddingRight: GUTTER - Space.sm },
  headerSpacer: { flex: 1 },
  title: { fontSize: TypeScale.page, fontWeight: '700', color: Signal.ink },
  traceButton: { paddingHorizontal: Space.xs, paddingVertical: Space.xs },
  traceButtonLabel: { color: Signal.inkMuted, fontSize: TypeScale.caption, fontWeight: '600' },
  // The field and its voice panel are one surface: listening opens inside it (Round 7 item 6).
  searchBox: {
    marginHorizontal: GUTTER,
    marginTop: Space.xs,
    borderRadius: Space.lg,
    overflow: 'hidden',
    backgroundColor: Glass.capsule,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    minHeight: 48,
    paddingLeft: Space.sm + 2,
    paddingRight: Space.xxs,
  },
  // The icon stays 18 and the target is the row's full 48dp, so a thumb that lands beside it still clears the field.
  clearTarget: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  topMatch: { marginTop: Space.sm },
  dim: { opacity: 0.32 },
  searchInput: { flex: 1, color: Signal.ink, fontSize: TypeScale.body, paddingVertical: 0 },
  chips: { marginTop: Space.sm },
  list: { paddingHorizontal: GUTTER },
  spinner: { marginTop: Space.md },
  empty: { color: Signal.inkMuted, fontSize: TypeScale.body, paddingHorizontal: GUTTER, marginBottom: Space.xs },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Surface.divider,
  },
  recentMainCell: { flex: 1 },
  recentMain: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingVertical: Space.sm },
  recentText: { flex: 1, color: Signal.ink, fontSize: TypeScale.body },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: GUTTER,
    rowGap: Space.sm,
  },
  moodCell: { width: '48.5%' },
  mood: {
    height: 84,
    borderRadius: Radius.well,
    overflow: 'hidden',
    padding: Space.sm,
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Glass.hairline,
  },
  moodLabel: { color: Signal.ink, fontSize: TypeScale.body, fontWeight: '700' },
  shelf: { paddingHorizontal: GUTTER, gap: Space.sm },
  playlistCard: { width: 120 },
  personCard: { width: 96 },
  personArt: { width: 96, height: 96, borderRadius: 48, overflow: 'hidden', backgroundColor: Signal.bgSubtle },
  center: { textAlign: 'center' },
  playlistArt: { width: 120, height: 120, borderRadius: Radius.art, overflow: 'hidden', backgroundColor: Signal.bgSubtle },
  cardTitle: { color: Signal.ink, fontSize: TypeScale.body, fontWeight: '600', marginTop: Space.xs },
  cardSub: { color: Signal.inkMuted, fontSize: TypeScale.caption, marginTop: 1 },
  statusScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
});

export default SearchScreen;
