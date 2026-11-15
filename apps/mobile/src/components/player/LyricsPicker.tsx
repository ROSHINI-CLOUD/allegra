/**
 * Long press on the player's lyrics button: every lyrics source is asked at once and each answer appears as it
 * lands — which source, whether it is timed word by word, by line or not at all, how well it matches the song, and
 * its first lines. Tap one to use it (services/lyrics/lyricsPicker).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TactileRow } from '../allegra/motion';
import { SheetScrollView } from './PlayerSheet';
import { KIND_LABEL, LyricsOption, rankOptions } from '../../services/lyrics/lyricsChoice';
import { applyLyricsOption, PickerTarget, searchEveryProvider } from '../../services/lyrics/lyricsPicker';
import { DEFAULT_PROVIDER_ORDER } from '../../services/lyrics/providers';
import * as Haptics from '../../utils/haptics';

/** Echo's seven providers and the Lyrica backend. */
const SOURCES = DEFAULT_PROVIDER_ORDER.length + 1;

interface Props {
  target: PickerTarget;
  /** The source of the lyrics on screen now, marked "In use". */
  currentSource?: string;
  /** Told what happened, for the player's toast; the picker is then closed by the player. */
  onDone: (message: string, used: boolean) => void;
}

export const LyricsPicker: React.FC<Props> = ({ target, currentSource, onDone }) => {
  const [options, setOptions] = useState<LyricsOption[]>([]);
  const [searching, setSearching] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOptions([]);
    setSearching(true);
    searchEveryProvider(
      target,
      option => setOptions(list => [...list.filter(o => o.id !== option.id), option]),
      () => cancelled,
    ).finally(() => { if (!cancelled) setSearching(false); });
    return () => { cancelled = true; };
  }, [target]);

  const ranked = useMemo(() => rankOptions(options), [options]);

  const pick = useCallback(async (option: LyricsOption) => {
    if (applying) return;
    Haptics.selectionAsync().catch(() => {});
    setApplying(option.id);
    const ok = await applyLyricsOption(option);
    setApplying(null);
    onDone(ok ? `Using lyrics from ${option.provider}` : 'Those lyrics could not be used', ok);
  }, [applying, onDone]);

  const status = searching
    ? `Searching ${SOURCES} sources… ${options.length > 0 ? `${options.length} found so far` : ''}`
    : options.length > 0
      ? `${options.length} found · tap one to use it`
      : 'No source has lyrics for this song';

  return (
    <View style={styles.wrap}>
      <View style={styles.statusRow}>
        {searching ? <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" /> : <Ionicons name="checkmark-circle" size={18} color="rgba(255,255,255,0.8)" />}
        <Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text>
      </View>
      <SheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {ranked.map((option, i) => {
          const inUse = !!currentSource && currentSource.toLowerCase() === option.provider.toLowerCase();
          return (
            <TactileRow
              key={option.id}
              onPress={() => pick(option)}
              style={[styles.card, i === 0 && !searching && styles.best]}
              accessibilityRole="button"
              accessibilityLabel={`${option.provider}, ${KIND_LABEL[option.kind]}, ${option.score} percent match${inUse ? ', in use' : ''}. Use these lyrics`}
            >
              <View style={styles.cardHead}>
                <Text style={styles.provider} numberOfLines={1}>{option.provider}</Text>
                <View style={[styles.badge, option.kind === 'words' && styles.badgeWords]}>
                  <Text style={[styles.badgeText, option.kind === 'words' && styles.badgeTextWords]}>{KIND_LABEL[option.kind]}</Text>
                </View>
                <Text style={styles.score}>{option.score}% match</Text>
                {applying === option.id ? <ActivityIndicator size="small" color="#fff" style={styles.mark} /> : null}
                {inUse && applying !== option.id ? <Text style={styles.inUse}>In use</Text> : null}
              </View>
              {option.trackName || option.artistName ? (
                <Text style={styles.meta} numberOfLines={1}>{[option.trackName, option.artistName].filter(Boolean).join(' · ')}</Text>
              ) : null}
              {option.preview.map((line, n) => (
                <Text key={n} style={[styles.line, n === 0 && styles.lineFirst]} numberOfLines={1}>{line}</Text>
              ))}
            </TactileRow>
          );
        })}
      </SheetScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 12 },
  status: { color: 'rgba(255,255,255,0.75)', fontSize: 14, flex: 1 },
  list: { gap: 10, paddingBottom: 24 },
  card: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  best: { borderColor: 'rgba(255,255,255,0.5)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  provider: { color: '#fff', fontSize: 16, fontWeight: '700', flexShrink: 1 },
  badge: { paddingHorizontal: 8, minHeight: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  badgeWords: { backgroundColor: 'rgba(255,255,255,0.92)' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  badgeTextWords: { color: '#0B0B0F' },
  score: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginLeft: 'auto' },
  mark: { marginLeft: 4 },
  inUse: { color: '#fff', fontSize: 12, fontWeight: '700', marginLeft: 4 },
  meta: { color: 'rgba(255,255,255,0.55)', fontSize: 12, marginTop: 4 },
  line: { color: 'rgba(255,255,255,0.8)', fontSize: 14, marginTop: 3 },
  lineFirst: { marginTop: 10 },
});

export default LyricsPicker;
