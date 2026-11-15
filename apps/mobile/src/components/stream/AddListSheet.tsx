/**
 * "Add a list" in Stream's search: paste the songs you want, one per line, and save the lot.
 *
 *   paste      "Title - Artist", "Title by Artist", or just a title, numbered or not
 *   find       each line is looked up the way Stream's own search looks (the official song and its audio)
 *   check      what was found shows with its cover; a wrong match swaps for the next one, a line can be left out,
 *              and what is already on the phone says so
 *   save       everything that is ticked goes to the download queue, optionally into a playlist
 *
 * This is what the separate Get songs screen did for lists, inside the search it belongs to.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { Radius, Signal } from '../../constants/allegraTheme';
import { searchOfficial } from '../../services/stream/officialSearch';
import { LIST_LIMIT, parseSongList, queryFor, type ListEntry } from '../../services/stream/songList';
import { useDownloadQueueStore } from '../../store/downloadQueueStore';
import { useSongsStore } from '../../store/songsStore';
import type { UnifiedSong } from '../../types/song';
import { IconButton, Sheet, SheetScrollView } from '../../ui';
import { libraryKeys, matchKey } from '../../utils/downloadState';
import { countOf } from '../../utils/formatters';
import * as Haptics from '../../utils/haptics';
import { Artwork } from '../allegra/Artwork';
import { Tactile } from '../allegra/motion';
import { PlaylistSelectionModal } from '../PlaylistSelectionModal';

type RowStatus = 'searching' | 'found' | 'missing';

interface Row {
  readonly id: string;
  readonly entry: ListEntry;
  readonly status: RowStatus;
  readonly candidates: readonly UnifiedSong[];
  /** Which candidate is shown. */
  readonly pick: number;
  readonly skipped: boolean;
}

/** Lookups running at once: enough to feel quick, few enough not to flood the providers. */
const PARALLEL = 2;
const CANDIDATES = 5;

const AddListSheet: React.FC<{ visible: boolean; onClose: () => void; onSaved: (message: string) => void }> = ({ visible, onClose, onSaved }) => {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pickingPlaylist, setPickingPlaylist] = useState(false);
  const run = useRef(0);
  const library = useSongsStore(s => s.songs);
  const addToQueue = useDownloadQueueStore(s => s.addToQueue);

  const entries = useMemo(() => parseSongList(text), [text]);
  const saved = useMemo(() => libraryKeys(library), [library]);
  const isSaved = useCallback((song: UnifiedSong | undefined): boolean => !!song && saved.has(matchKey(song.title, song.artist)), [saved]);

  // Closing forgets the list, and stops any lookups still running for it.
  useEffect(() => {
    if (visible) return;
    run.current += 1;
    setText('');
    setRows(null);
    setPickingPlaylist(false);
  }, [visible]);

  const patch = useCallback((id: string, change: Partial<Row>) => {
    setRows(current => (current ? current.map(row => (row.id === id ? { ...row, ...change } : row)) : current));
  }, []);

  const find = useCallback(async () => {
    if (entries.length === 0) return;
    Haptics.selectionAsync().catch(() => {});
    const mine = ++run.current;
    const initial: Row[] = entries.map((entry, index) => ({ id: `row-${mine}-${index}`, entry, status: 'searching', candidates: [], pick: 0, skipped: false }));
    setRows(initial);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < initial.length && run.current === mine) {
        const row = initial[next++] as Row;
        const found = await searchOfficial(queryFor(row.entry), CANDIDATES).catch(() => [] as UnifiedSong[]);
        if (run.current !== mine) return;
        patch(row.id, { status: found.length > 0 ? 'found' : 'missing', candidates: found });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, initial.length) }, worker));
  }, [entries, patch]);

  const chosen = useCallback((row: Row): UnifiedSong | undefined => row.candidates[row.pick], []);
  const toSave = useMemo(
    () => (rows ?? []).filter(row => row.status === 'found' && !row.skipped && !isSaved(chosen(row))).map(row => chosen(row) as UnifiedSong),
    [rows, isSaved, chosen],
  );
  const searching = (rows ?? []).some(row => row.status === 'searching');

  const save = useCallback((playlistId?: string, playlistName?: string) => {
    if (toSave.length === 0) return;
    addToQueue(toSave, playlistId);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onSaved(`Saving ${toSave.length} ${toSave.length === 1 ? 'song' : 'songs'}${playlistName ? ` to ${playlistName}` : ''}`);
    onClose();
  }, [toSave, addToQueue, onSaved, onClose]);

  const swap = (row: Row): void => {
    if (row.candidates.length < 2) return;
    Haptics.selectionAsync().catch(() => {});
    patch(row.id, { pick: (row.pick + 1) % row.candidates.length });
  };

  return (
    <>
      <Sheet visible={visible} onClose={onClose} keyboard tall>
          <View style={styles.head}>
            <Text style={styles.title} accessibilityRole="header">{rows ? 'Your list' : 'Add a list'}</Text>
            <IconButton icon="close" size="sm" label="Close" onPress={onClose} />
          </View>

          {rows === null ? (
            <>
              <Text style={styles.lead}>Paste the songs you want, one per line. “Title - Artist” works best, a title alone is fine.</Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={'Tum Hi Ho - Arijit Singh\nKesariya\nChanna Mereya by Arijit Singh'}
                placeholderTextColor={Signal.inkFaint}
                multiline
                autoCorrect={false}
                selectionColor={Signal.wave}
                style={styles.input}
                accessibilityLabel="Songs, one per line"
              />
              <View style={styles.footer}>
                <Text style={styles.count}>
                  {entries.length === 0 ? 'Nothing pasted yet' : `${entries.length} ${entries.length === 1 ? 'song' : 'songs'}${entries.length >= LIST_LIMIT ? ` (the most at once)` : ''}`}
                </Text>
                <Tactile onPress={find} disabled={entries.length === 0} pressScale={0.96} accessibilityRole="button" accessibilityLabel="Find these songs" style={[styles.primary, entries.length === 0 && styles.dim]}>
                  <Ionicons name="search" size={16} color={Signal.waveInk} />
                  <Text style={styles.primaryText}>Find songs</Text>
                </Tactile>
              </View>
            </>
          ) : (
            <>
              <SheetScrollView style={styles.list} showsVerticalScrollIndicator={false} contentContainerStyle={styles.listContent}>
                {rows.map(row => {
                  const song = chosen(row);
                  const already = row.status === 'found' && isSaved(song);
                  const off = row.skipped || already;
                  return (
                    <View key={row.id} style={[styles.row, off && styles.rowOff]}>
                      <View style={styles.cover}>
                        {song ? <Artwork uri={song.highResArt || song.thumbnail} title={song.title} artist={song.artist} size={44} style={styles.coverArt} /> : (
                          <View style={styles.coverEmpty}>{row.status === 'searching' ? <ActivityIndicator size="small" color={Signal.inkSoft} /> : <Ionicons name="help" size={18} color={Signal.inkMuted} />}</View>
                        )}
                      </View>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle} numberOfLines={1}>{song?.title ?? row.entry.title}</Text>
                        <Text style={styles.rowSub} numberOfLines={1}>
                          {row.status === 'searching' ? 'Finding it…'
                            : row.status === 'missing' ? 'Not found'
                            : already ? 'Already on this phone'
                            : song?.artist || row.entry.artist || ' '}
                        </Text>
                      </View>
                      {row.status === 'found' && row.candidates.length > 1 && !already ? (
                        <Tactile onPress={() => swap(row)} hitSlop={8} pressScale={0.9} accessibilityRole="button" accessibilityLabel={`Try another match for ${row.entry.title}`} style={styles.iconBtn}>
                          <Ionicons name="swap-horizontal" size={18} color={Signal.inkSoft} />
                        </Tactile>
                      ) : null}
                      {row.status !== 'searching' && !already ? (
                        <Tactile onPress={() => { Haptics.selectionAsync().catch(() => {}); patch(row.id, { skipped: !row.skipped }); }} hitSlop={8} pressScale={0.9} accessibilityRole="button" accessibilityLabel={row.skipped ? `Include ${row.entry.title}` : `Leave out ${row.entry.title}`} style={styles.iconBtn}>
                          <Ionicons name={row.skipped ? 'add-circle-outline' : 'close-circle-outline'} size={20} color={Signal.inkSoft} />
                        </Tactile>
                      ) : null}
                    </View>
                  );
                })}
              </SheetScrollView>
              <View style={styles.footer}>
                <Tactile onPress={() => { run.current += 1; setRows(null); }} pressScale={0.96} accessibilityRole="button" accessibilityLabel="Edit the list" style={styles.secondary}>
                  <Text style={styles.secondaryText}>Edit list</Text>
                </Tactile>
                <View style={styles.footerActions}>
                  <Tactile onPress={() => setPickingPlaylist(true)} disabled={toSave.length === 0 || searching} pressScale={0.96} accessibilityRole="button" accessibilityLabel="Save to a playlist" style={[styles.secondary, (toSave.length === 0 || searching) && styles.dim]}>
                    <Ionicons name="albums-outline" size={16} color={Signal.ink} />
                    <Text style={styles.secondaryText}>Playlist</Text>
                  </Tactile>
                  <Tactile onPress={() => save()} disabled={toSave.length === 0 || searching} pressScale={0.96} accessibilityRole="button" accessibilityLabel={`Save ${countOf(toSave.length, 'song')}`} style={[styles.primary, (toSave.length === 0 || searching) && styles.dim]}>
                    {searching ? <ActivityIndicator size="small" color={Signal.waveInk} /> : <Ionicons name="arrow-down" size={16} color={Signal.waveInk} />}
                    <Text style={styles.primaryText}>{searching ? 'Finding' : `Save ${toSave.length}`}</Text>
                  </Tactile>
                </View>
              </View>
            </>
          )}
      </Sheet>
      <PlaylistSelectionModal
        visible={pickingPlaylist}
        onClose={() => setPickingPlaylist(false)}
        onSelect={(id, name) => { setPickingPlaylist(false); save(id, name); }}
      />
    </>
  );
};

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: Signal.ink, fontSize: 22, fontWeight: '700' },
  lead: { color: Signal.inkSoft, fontSize: 14, lineHeight: 20, marginTop: 8 },
  input: {
    marginTop: 14,
    minHeight: 150,
    maxHeight: 280,
    padding: 14,
    borderRadius: 18,
    color: Signal.ink,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { color: Signal.inkMuted, fontSize: 13, flexShrink: 1 },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 18, borderRadius: Radius.pill, backgroundColor: Signal.wave },
  primaryText: { color: Signal.waveInk, fontSize: 15, fontWeight: '700' },
  secondary: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 16, borderRadius: Radius.pill, backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  secondaryText: { color: Signal.ink, fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.45 },
  list: { marginTop: 12, flexGrow: 0 },
  listContent: { paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  rowOff: { opacity: 0.45 },
  cover: { width: 44, height: 44 },
  coverArt: { width: 44, height: 44, borderRadius: 8 },
  coverEmpty: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  rowCopy: { flex: 1 },
  rowTitle: { color: Signal.ink, fontSize: 15, fontWeight: '600' },
  rowSub: { color: Signal.inkMuted, fontSize: 13, marginTop: 2 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
});

export default AddListSheet;
