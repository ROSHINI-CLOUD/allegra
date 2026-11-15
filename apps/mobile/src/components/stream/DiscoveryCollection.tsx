import React from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '../AppScreen';
import { heroHeight, heroImageUrl } from '../playlist/heroFade';
import { ImmersiveHero, ImmersiveTopBar, useHeroScroll } from '../playlist/ImmersiveHero';
import { Button, Space, Surface, Text, SongRow, useBottomClearance } from '../../ui';
import type { UnifiedSong } from '../../types/song';
import { StreamService } from '../../services/stream/StreamService';
import { CatalogDownloadButton } from './CatalogDownloadButton';
import { useStreamSongActions } from './useStreamSongActions';
import { countOf } from '../../utils/formatters';
import { shuffled } from '../../utils/shuffle';
interface Props { title: string; subtitle: string; artwork?: string; songs: UnifiedSong[]; loading: boolean; error?: string; onBack: () => void; onRefresh: () => void; saved?: boolean; onSave?: () => void;
  /** Only a catalog album sets this (CatalogAlbumScreen): the page gets the album Download button. Quick picks, which is the listener's own live playlist, does not. */
  catalogDownload?: boolean }
/** One presentation for catalog albums and the locally managed personalized playlist. */
export function DiscoveryCollection({ title, subtitle, artwork, songs, loading, error, onBack, onRefresh, saved, onSave, catalogDownload }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bottom = useBottomClearance();
  const scroll = useHeroScroll();
  const actions = useStreamSongActions();
  const hero = heroHeight(width, height);
  return <AppScreen staticGlow={false} style={styles.screen}>
    <Animated.FlatList data={songs} keyExtractor={song => `${song.source}:${song.id}`} onScroll={scroll.onScroll} scrollEventThrottle={16}
      contentContainerStyle={{ paddingBottom: bottom }}
      ListHeaderComponent={<>
        <ImmersiveHero uri={heroImageUrl(artwork || songs[0]?.highResArt)} title={title} lines={[subtitle, countOf(songs.length, 'song')]} width={width} height={hero} scrollY={scroll.y}>
          <View style={styles.actions}>
            <Button label="Shuffle" icon="shuffle" disabled={!songs.length} onPress={() => StreamService.play(shuffled([...songs]), 0)} />
            <Button label="Play" icon="play" variant="primary" disabled={!songs.length} onPress={() => StreamService.play([...songs], 0)} />
            {catalogDownload ? <CatalogDownloadButton songs={songs} ready={!loading && !error && songs.length > 0} /> : null}
          </View>
        </ImmersiveHero>
        <View style={styles.status}>
          {onSave ? <Button block label={saved ? 'Remove from your library' : 'Save live playlist'} icon={saved ? 'checkmark-circle' : 'add-circle-outline'} disabled={!songs.length} onPress={onSave} /> : null}
          <Button label={loading ? 'Refreshing…' : 'Refresh'} busy={loading} onPress={onRefresh} />
          {error ? <Text tone="secondary" accessibilityLiveRegion="polite">{error}</Text> : null}
          {!loading && !songs.length && !error ? <Text tone="secondary">No songs available yet. Try refreshing.</Text> : null}
        </View>
      </>}
      renderItem={({ item, index }) => <SongRow title={item.title} artist={item.artist} artwork={item.highResArt} onPress={() => StreamService.play([...songs], index)} onActions={() => actions.open(item)} />} />
    <ImmersiveTopBar title={title} height={hero} scrollY={scroll.y} topInset={insets.top} onBack={onBack} />
    {actions.element}
  </AppScreen>;
}
const styles = StyleSheet.create({ screen: { backgroundColor: Surface.immersive }, actions: { flexDirection: 'row', justifyContent: 'center', gap: Space.sm, padding: Space.md }, status: { gap: Space.sm, padding: Space.md } });
