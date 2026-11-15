/**
 * Your Luvs: the songs you hearted, in a frosted sheet — a three-column grid
 * of covers and one button to download them all.
 */

import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  View,
  type FlatListProps,
} from 'react-native';
import { Signal } from '../constants/allegraTheme';
import { useDownloadQueueStore } from '../store/downloadQueueStore';
import { useLuvsFeedStore } from '../store/luvsFeedStore';
import { UnifiedSong } from '../types/song';
import { Button, ConfirmSheet, Sheet, SheetScrollable, Tactile } from '../ui';
import { countOf } from '../utils/formatters';
import Artwork from './allegra/Artwork';
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface LuvsVaultModalProps {
  visible: boolean;
  onClose: () => void;
}

/** A FlatList inside the sheet: a drag down at its top moves the sheet. */
function SheetList<T>(props: FlatListProps<T>): React.ReactElement {
  return (
    <SheetScrollable>
      <FlatList<T> {...props} />
    </SheetScrollable>
  );
}

export const LuvsVaultModal: React.FC<LuvsVaultModalProps> = ({
  visible,
  onClose,
}) => {
  const vault = useLuvsFeedStore(s => s.vault);
  const removeFromVault = useLuvsFeedStore(s => s.removeFromVault);
  const clearVault = useLuvsFeedStore(s => s.clearVault);
  const addToQueue = useDownloadQueueStore((state) => state.addToQueue);

  const [downloadAlertVisible, setDownloadAlertVisible] = React.useState(false);
  const [startedAlertVisible, setStartedAlertVisible] = React.useState(false);

  // The download button only shows while the vault has songs, so an empty vault has nothing to confirm.
  const handleDownloadAll = () => {
    if (vault.length === 0) return;
    setDownloadAlertVisible(true);
  };

  const confirmDownload = () => {
    setDownloadAlertVisible(false);
    addToQueue(vault);
    setStartedAlertVisible(true);
  };

  const handleRemoveSong = (songId: string) => {
    removeFromVault(songId);
  };

  const renderSong = ({ item }: { item: UnifiedSong }) => (
    <View style={styles.songCard}>
      <Artwork uri={item.highResArt} title={item.title} artist={item.artist} size={(SCREEN_WIDTH - 48) / 3} style={styles.coverArt} />
      <Tactile
        wrapperStyle={styles.removeButton}
        onPress={() => handleRemoveSong(item.id)}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.title}`}
      >
        <Ionicons name="close" size={14} color={Signal.ink} />
      </Tactile>
      <View style={styles.songInfo}>
        <Text style={styles.songTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.songArtist} numberOfLines={1}>
          {item.artist}
        </Text>
      </View>
    </View>
  );

  return (
    <>
      <Sheet visible={visible} onClose={onClose} tall title={`Your Luvs ${vault.length}`}>
        {vault.length > 0 ? (
          <SheetList<UnifiedSong>
            data={vault}
            renderItem={renderSong}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={styles.gridContainer}
            showsVerticalScrollIndicator={false}
            columnWrapperStyle={styles.columnWrapper}
          />
        ) : (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="heart-multiple-outline" size={64} color={Signal.inkFaint} />
            <Text style={styles.emptyText}>Nothing here yet</Text>
            <Text style={styles.emptySubtext}>
              Tap the heart on a Luv and it waits here.
            </Text>
          </View>
        )}

        {vault.length > 0 && (
          <View style={styles.footer}>
            <Button label={`Download all ${vault.length}`} icon="arrow-down" variant="primary" block onPress={handleDownloadAll} />
          </View>
        )}
      </Sheet>

      <ConfirmSheet
        visible={downloadAlertVisible}
        title="Download all"
        body={vault.length === 1 ? 'Download this song to your library?' : `Download all ${vault.length} songs to your library?`}
        confirmLabel="Download all"
        onConfirm={confirmDownload}
        onClose={() => setDownloadAlertVisible(false)}
      />

      <ConfirmSheet
        visible={startedAlertVisible}
        title="Downloading"
        body={vault.length === 1 ? 'The song is on its way. Clear it from your Luvs?' : `${countOf(vault.length, 'song')} are on their way. Clear them from your Luvs?`}
        confirmLabel="Clear them"
        cancelLabel="Keep them"
        destructive
        onConfirm={() => { setStartedAlertVisible(false); clearVault(); }}
        onClose={() => { setStartedAlertVisible(false); onClose(); }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  gridContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  columnWrapper: {
    justifyContent: 'flex-start',
    gap: 8,
    marginBottom: 12,
  },
  songCard: {
    width: (SCREEN_WIDTH - 48) / 3,
  },
  coverArt: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  removeButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 11, 14, 0.66)',
    zIndex: 5,
  },
  songInfo: {
    paddingTop: 6,
  },
  songTitle: {
    color: Signal.ink,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 1,
  },
  songArtist: {
    color: Signal.inkMuted,
    fontSize: 11,
  },
  emptyState: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    color: Signal.ink,
    fontSize: 20,
    fontWeight: '700',
    marginTop: 18,
  },
  emptySubtext: {
    color: Signal.inkMuted,
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 22,
  },
  footer: {
    paddingTop: 12,
  },
});
