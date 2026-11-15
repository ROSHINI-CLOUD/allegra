import { useSavedQuickPicks } from '../components/library/SavedQuickPicks';
import { AppScreen } from '../components/AppScreen';
/**
 * PlaylistsScreen - Library Hub
 * Displays all playlists in a grid, with "Liked Songs" at the top. Built from src/ui: a long press opens the
 * playlist's actions sheet, and deleting asks with a ConfirmSheet.
 */

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InfoTitleRow, InfoTour } from '../components/allegra/InfoTour';
import { PLAYLISTS_TOUR, playlistsScene } from '../components/allegra/infoTours';
import { MosaicCover } from '../components/MosaicCover';
import { PlaylistsStrings } from '../constants/uiStrings';
import { getOnlinePlaylistSongs } from '../database/syncQueries';
import { navigationRef } from '../utils/navigationService';
import { toStreamSong } from '../services/stream/streamSong';
import { onlineRowToSong } from '../services/sync/onlineSongs';
import { useOnlineLibraryStore } from '../store/onlineLibraryStore';
import { usePlaylistStore } from '../store/playlistStore';
import { LibraryStackParamList, RootStackParamList } from '../types/navigation';
import { Playlist, Song } from '../types/song';
import {
  ConfirmSheet, EmptyState, GUTTER, IconButton, Placeholder, Sheet, SheetOption, Signal, Space, Tactile, Text,
  useBottomClearance,
} from '../ui';
import { countOf } from '../utils/formatters';
import { displayPlaylistName } from '../utils/sentenceCase';

/** The grid's side padding and each card's margin: two folders share what is left of the width. */
const GRID_PADDING = Space.sm;
const CARD_MARGIN = Space.xs;

export const PlaylistsScreen: React.FC<{ embedded?: boolean; query?: string }> = ({ embedded = false, query = '' }) => {
  const { width: screenWidth, fontScale } = useWindowDimensions();
  const columns = fontScale >= 1.6 ? 1 : 2;
  const folderWidth = Math.floor((screenWidth - GRID_PADDING * 2 - CARD_MARGIN * 2 * columns) / columns);
  const bottom = useBottomClearance();
  // This screen sits in the Library tab's nested stack: PlaylistDetail resolves
  // locally, everything else bubbles up to the root stack.
  const navigation = useNavigation<
    NativeStackNavigationProp<LibraryStackParamList & RootStackParamList>
  >();
  const isLoading = usePlaylistStore(state => state.isLoading);
  const deletePlaylist = usePlaylistStore(state => state.deletePlaylist);
  const ordinaryPlaylists = usePlaylistStore(state => state.playlists);
  const { entry: livePicks } = useSavedQuickPicks();
  const playlists = React.useMemo<Playlist[]>(() => livePicks?.saved ? [{
    id: `generated:quick-picks:${livePicks.scope}`, name: 'Quick picks', description: 'Live on this phone',
    isDefault: false, sortOrder: -1, dateCreated: new Date(livePicks.generatedAt).toISOString(),
    dateModified: new Date(livePicks.generatedAt).toISOString(), songCount: livePicks.songs.length,
  }, ...ordinaryPlaylists] : ordinaryPlaylists, [ordinaryPlaylists, livePicks]);
  const fetchPlaylists = usePlaylistStore(state => state.fetchPlaylists);
  const [playlistSongs, setPlaylistSongs] = React.useState<Record<string, Song[]>>({});

  // Same room as Library: the live shader, tinted by the playing cover.




  // Load playlists on mount and refresh on focus
  useFocusEffect(
    React.useCallback(() => {
      fetchPlaylists();
    }, [fetchPlaylists])
  );

  // A sync that lands while this page is open (a playlist built on the website, a like from another device)
  // changes the counts and covers: read them again, but not on the first render, where the focus effect does it.
  const onlineVersion = useOnlineLibraryStore(state => state.playlistVersion + state.likes.length);
  React.useEffect(() => {
    if (onlineVersion > 0) fetchPlaylists();
  }, [onlineVersion, fetchPlaylists]);

  // Fetch songs for each playlist to display in mosaic: the ones on this phone first, then the online-only
  // ones (their covers are links), so a playlist built elsewhere has a cover too.
  React.useEffect(() => {
    let current = true;
    const fetchAllPlaylistSongs = async () => {
      const { getPlaylistSongs } = await import('../database/playlistQueries');
      const songsMap: Record<string, Song[]> = {};

      for (const playlist of playlists) {
        if (playlist.id.startsWith('generated:quick-picks:')) { songsMap[playlist.id] = (livePicks?.songs ?? []).slice(0, 4).map(song => toStreamSong(song)); continue; }
        const local = await getPlaylistSongs(playlist.id);
        const online = local.length >= 4
          ? []
          : (playlist.isDefault ? useOnlineLibraryStore.getState().likes : await getOnlinePlaylistSongs(playlist.id)).map(onlineRowToSong);
        const seen = new Set(local.map(song => song.id));
        songsMap[playlist.id] = [...local, ...online.filter(song => !seen.has(song.id))].slice(0, 4); // Only need 4 for mosaic
      }

      if (current) setPlaylistSongs(songsMap);
    };

    if (playlists.length > 0) {
      fetchAllPlaylistSongs().catch(() => undefined);
    }
    return () => { current = false; };
  }, [playlists, onlineVersion, livePicks]);

  const handlePlaylistPress = (playlistId: string) => {
    if (playlistId.startsWith('generated:quick-picks:')) { navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'QuickPicks' } }); return; }
    navigation.navigate('PlaylistDetail', { playlistId });
  };

  const handleCreatePlaylist = () => {
    navigation.navigate('CreatePlaylist');
  };

  // A long press opens the playlist's actions; deleting asks first.
  const [selectedPlaylist, setSelectedPlaylist] = React.useState<Playlist | null>(null);
  const [actionsOpen, setActionsOpen] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const handleLongPress = (playlist: Playlist) => {
    if (playlist.isDefault) return; // Cannot modify "Liked Songs"
    setSelectedPlaylist(playlist);
    setActionsOpen(true);
  };

  const handleRename = () => {
    if (!selectedPlaylist) return;
    setActionsOpen(false);
    navigation.navigate('CreatePlaylist', {
      playlistId: selectedPlaylist.id,
      initialName: selectedPlaylist.name,
    });
  };

  const handleDelete = () => {
    if (!selectedPlaylist) return;
    deletePlaylist(selectedPlaylist.id);
    setConfirmDelete(false);
  };

  const selectedName = selectedPlaylist ? displayPlaylistName(selectedPlaylist.name) : '';

  // Embedded in Library, the page behind (its background and header glow) shows through: a screen of its own here
  // drew an opaque box and a second glow that cut the Library's background off at this view's top edge.
  const Frame = embedded ? View : AppScreen;
  return (
    <Frame style={embedded ? styles.embedded : styles.container}>
      <SafeAreaView style={styles.safeArea} edges={embedded ? [] : ['top']}>
        <View style={styles.header}>
          {embedded ? <Text variant="meta" tone="secondary" style={styles.titleFlex}>{countOf(playlists.length, 'playlist')}</Text> : <>
          {navigation.canGoBack() ? (
            <IconButton icon="chevron-back" label="Back" variant="plain" onPress={() => navigation.goBack()} />
          ) : null}
          <InfoTitleRow style={styles.titleFlex}>
            <Text variant="page" accessibilityRole="header">Playlists</Text>
            <InfoTour label="About playlists" steps={PLAYLISTS_TOUR} scene={playlistsScene} />
          </InfoTitleRow>
          </>}
          <IconButton icon="add" label={PlaylistsStrings.createPlaylist} onPress={handleCreatePlaylist} />
        </View>

        {isLoading && playlists.length === 0 ? (
          <View style={[styles.grid, styles.placeholderGrid]}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={styles.playlistCard}>
                <Placeholder width={folderWidth} height={folderWidth} radius={Space.md} />
                <Placeholder width="70%" height={14} style={styles.placeholderLine} />
              </View>
            ))}
          </View>
        ) : playlists.length === 0 ? (
          <EmptyState
            icon="folder-open-outline"
            title={PlaylistsStrings.noPlaylistsYet}
            body="Group songs you saved or streamed. They sync with Allegra on the web."
            action={{ label: PlaylistsStrings.createPlaylist, icon: 'add', onPress: handleCreatePlaylist }}
            style={[styles.empty, { paddingBottom: bottom }]}
          />
        ) : (
          <FlatList
            data={playlists.filter(item => !query || item.name.toLowerCase().includes(query.toLowerCase()))}
            key={`grid-${columns}`}
            numColumns={columns}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[styles.grid, { paddingBottom: bottom }]}
            renderItem={({ item }) => {
              const name = displayPlaylistName(item.name);
              const count = item.id.startsWith('generated:') ? 'Live - updates on this phone' : countOf(item.songCount || 0, 'song');
              return (
                <Tactile
                  wrapperStyle={[styles.playlistCard, { maxWidth: columns === 1 ? '100%' : '46%' }]}
                  pressScale={0.98}
                  haptic="select"
                  onPress={() => handlePlaylistPress(item.id)}
                  onLongPress={item.isDefault || item.id.startsWith('generated:') ? undefined : () => handleLongPress(item)}
                  delayLongPress={350}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${name}, ${count}`}
                  accessibilityHint={item.isDefault || item.id.startsWith('generated:') ? undefined : 'Long press for more'}
                >
                  <MosaicCover songs={playlistSongs[item.id] || []} size={folderWidth} name={name} />
                  <View style={styles.playlistMeta}>
                    <Text variant="row" numberOfLines={1} style={styles.playlistName}>{name}</Text>
                    <Text variant="meta" tone="muted" tabular>{count}</Text>
                  </View>
                </Tactile>
              );
            }}
          />
        )}
      </SafeAreaView>

      <Sheet visible={actionsOpen} onClose={() => setActionsOpen(false)} title={selectedName}>
        <SheetOption label="Rename playlist" icon="pencil-outline" onPress={handleRename} />
        <SheetOption
          label="Delete playlist"
          icon="trash-outline"
          destructive
          onPress={() => { setActionsOpen(false); setConfirmDelete(true); }}
        />
      </Sheet>
      <ConfirmSheet
        visible={confirmDelete}
        title={`Delete “${selectedName}”?`}
        body="Songs stay in your library."
        confirmLabel="Delete playlist"
        destructive
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </Frame>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Signal.bgDeep },
  embedded: { flex: 1, backgroundColor: 'transparent' },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: GUTTER - Space.xxs,
    paddingVertical: Space.sm,
  },
  titleFlex: { flex: 1 },
  grid: { paddingHorizontal: GRID_PADDING },
  placeholderGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  placeholderLine: { marginTop: Space.sm },
  playlistCard: {
    flex: 1,
    margin: CARD_MARGIN,
    maxWidth: '46%',
    marginBottom: Space.md,
  },
  playlistMeta: {
    gap: Space.xxs,
    marginTop: Space.xs,
    paddingHorizontal: 2,
  },
  playlistName: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center' },
});

export default PlaylistsScreen;
