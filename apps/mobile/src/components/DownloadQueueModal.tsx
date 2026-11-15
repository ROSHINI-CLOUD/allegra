import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Glass, Signal } from '../constants/allegraTheme';
import { useDownloadItem, useQueueShape } from '../store/downloadQueueSelectors';
import { QueueItem, useDownloadQueueStore, visibleDownloads } from '../store/downloadQueueStore';
import { plainErrorMessage } from '../utils/plainError';
import { Button, IconButton, Sheet, SheetScrollable, Text } from '../ui';
import { Artwork } from './allegra/Artwork';
import { DownloadButton } from './stream/DownloadButton';

interface DownloadQueueModalProps {
  visible: boolean;
  onClose: () => void;
}

/** One plain line under the song: what is happening to it right now. */
const statusLine = (item: QueueItem): string => {
  switch (item.status) {
    case 'completed': return 'Saved to your library';
    case 'paused': return `Paused at ${Math.round((item.progress || 0) * 100)}%`;
    case 'downloading': {
      const pct = `${Math.round((item.progress || 0) * 100)}%`;
      return item.stageStatus ? `${item.stageStatus.replace(/\.+$/, '')} · ${pct}` : `Downloading · ${pct}`;
    }
    case 'staging': return item.stageStatus?.replace(/\.+$/, '') || 'Getting ready';
    case 'failed': {
      // The stored error is whatever the downloader threw; only a plain sentence or a connection hint reaches the row.
      const reason = item.error ? plainErrorMessage(item.error, '').replace(/\.$/, '') : '';
      return reason ? `Didn't download · ${reason}` : "Didn't download";
    }
    default: return 'Waiting for a slot';
  }
};

// Reads its own item, so a progress tick re-renders one row, not the sheet.
const QueueRow: React.FC<{ id: string }> = ({ id }) => {
  const item = useDownloadItem(id);
  const removeItem = useDownloadQueueStore(state => state.removeItem);
  const retryItem = useDownloadQueueStore(state => state.retryItem);
  if (!item?.song) return null;
  const title = item.song.title || 'Untitled';
  const artist = item.song.artist || 'Unknown artist';
  const moving = item.status === 'downloading' || item.status === 'paused';
  const progress = item.status === 'completed' ? 1 : Math.max(0, Math.min(1, item.progress || 0));

  return (
    <View style={styles.row}>
      <Artwork uri={item.song.highResArt} title={title} artist={artist} size={52} style={styles.art} />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text
          style={[styles.status, item.status === 'failed' && styles.statusFailed, item.status === 'completed' && styles.statusDone]}
          numberOfLines={1}
        >
          {statusLine(item)}
        </Text>
        {moving ? (
          <View style={styles.track}>
            {/* Scaled from the left edge, not resized. */}
            <View style={[styles.bar, { transform: [{ scaleX: progress }] }]} />
          </View>
        ) : null}
      </View>
      <DownloadButton song={{ id: item.id, title, artist }} onSave={() => retryItem(item.id)} />
      <IconButton
        icon="close"
        size="sm"
        variant="plain"
        label={`Remove ${title} from downloads`}
        haptic="select"
        onPress={() => removeItem(item.id)}
        style={styles.remove}
      />
    </View>
  );
};

const renderItem = ({ item }: { item: string }) => <QueueRow id={item} />;

export const DownloadQueueModal = ({ visible, onClose }: DownloadQueueModalProps) => {
  // The list follows the queue's shape (items and their state), not its progress.
  const shape = useQueueShape();
  const clearCompleted = useDownloadQueueStore(state => state.clearCompleted);
  const { ids, done } = useMemo(() => {
    // Songs saved only for a downloaded playlist are that playlist's business (1.41.0).
    const queue = visibleDownloads(useDownloadQueueStore.getState().queue);
    return { ids: queue.map(i => i.id), done: queue.filter(i => i.status === 'completed').length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  return (
    <Sheet visible={visible} onClose={onClose} tall>
      <View style={styles.header}>
        <Text variant="lead" accessibilityRole="header">Downloads</Text>
        <IconButton icon="close" size="sm" label="Close" onPress={onClose} />
      </View>

      <SheetScrollable>
        <FlatList
          data={ids}
          renderItem={renderItem}
          keyExtractor={id => id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="arrow-down-circle-outline" size={40} color={Signal.inkFaint} />
              <Text variant="lead" style={styles.emptyTitle}>Nothing downloading</Text>
              <Text variant="secondary" tone="muted" style={styles.emptyText}>Songs you save from Stream or Search show up here while they download.</Text>
            </View>
          }
        />
      </SheetScrollable>

      {done > 0 && (
        <View style={styles.clear}>
          <Button label={done === 1 ? 'Clear the saved song' : `Clear ${done} saved songs`} onPress={clearCompleted} variant="glass" block />
        </View>
      )}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 8,
  },
  list: { flexGrow: 0 },
  clear: { marginTop: 4 },
  listContent: { paddingTop: 4, paddingBottom: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 6,
    borderRadius: 16,
    backgroundColor: Glass.fillLight,
  },
  art: { width: 52, height: 52, borderRadius: 8 },
  info: { flex: 1, marginLeft: 12, marginRight: 4, justifyContent: 'center' },
  title: { color: Signal.ink, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  status: { color: Signal.inkMuted, fontSize: 13 },
  statusFailed: { color: Signal.accent },
  statusDone: { color: Signal.wave },
  track: {
    alignSelf: 'stretch',
    height: 3,
    marginTop: 6,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: Glass.hairline,
  },
  bar: { width: '100%', height: '100%', borderRadius: 2, backgroundColor: Signal.wave, transformOrigin: 'left' },
  remove: { marginLeft: 2 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingVertical: 48 },
  emptyTitle: { marginTop: 12 },
  emptyText: { marginTop: 6, textAlign: 'center' },
});
