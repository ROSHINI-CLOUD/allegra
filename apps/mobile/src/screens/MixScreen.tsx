import { playList } from '../services/sync/onlineSongs';
import React from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BrowseStackParamList } from '../types/navigation';
import { AppScreen } from '../components/AppScreen';
import { useSongActions } from '../components/library/useSongActions';
import { heroHeight, heroImageUrl } from '../components/playlist/heroFade';
import { ImmersiveHero, ImmersiveTopBar, useHeroScroll } from '../components/playlist/ImmersiveHero';
import { CatalogDownloadButton } from '../components/stream/CatalogDownloadButton';
import { useStreamSongActions } from '../components/stream/useStreamSongActions';
import { Surface } from '../constants/allegraTheme';
import { StreamService } from '../services/stream/StreamService';
import { Button, Space, SongRow, useBottomClearance } from '../ui';
import { countOf } from '../utils/formatters';
import { shuffled } from '../utils/shuffle';

/**
 * A Made for you mix: the first song's cover fills the top edge to edge and dissolves into a solid black list
 * (components/playlist/ImmersiveHero). The list never takes a colour from the cover.
 */
export default function MixScreen({ route, navigation }: NativeStackScreenProps<BrowseStackParamList, 'Mix'>) {
  const mix = route.params;
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const bottom = useBottomClearance();
  const localActions = useSongActions();
  const streamActions = useStreamSongActions();
  const scroll = useHeroScroll();
  const hero = heroHeight(width, windowHeight);
  const play = (index: number) => mix.kind === 'stream' ? StreamService.play(mix.songs, index) : playList(`mix:${mix.title}`, mix.songs, index);
  const playShuffled = () => {
    if (mix.kind === 'stream') StreamService.play(shuffled(mix.songs), 0);
    else playList(`mix:${mix.title}`, shuffled(mix.songs), 0);
  };
  const rows = mix.kind === 'stream' ? mix.songs.map((song, index) => ({ key: song.id, title: song.title, artist: song.artist, artwork: song.highResArt, onPress: () => play(index), onActions: () => streamActions.open(song) }))
    : mix.songs.map((song, index) => ({ key: song.id, title: song.title, artist: song.artist, artwork: song.coverImageUri, onPress: () => play(index), onActions: () => localActions.open(song) }));
  const header = (
    <ImmersiveHero uri={heroImageUrl(rows[0]?.artwork)} title={mix.title} lines={[`${countOf(rows.length, 'song')} · Made for you`]} width={width} height={hero} scrollY={scroll.y}>
      <View style={styles.actions}>
        <Button label="Shuffle" icon="shuffle" size="compact" disabled={!rows.length} onPress={playShuffled} />
        <Button label="Play mix" icon="play" variant="primary" disabled={!rows.length} onPress={() => play(0)} />
        {mix.kind === 'stream' ? <CatalogDownloadButton songs={mix.songs} ready={mix.songs.length > 0} /> : null}
      </View>
    </ImmersiveHero>
  );
  return (
    <AppScreen staticGlow={false} style={styles.screen}>
      <Animated.FlatList
        data={rows}
        keyExtractor={row => row.key}
        renderItem={({ item }) => <SongRow {...item} />}
        ListHeaderComponent={header}
        onScroll={scroll.onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: bottom }}
        style={styles.list}
      />
      <ImmersiveTopBar title={mix.title} height={hero} scrollY={scroll.y} topInset={insets.top} onBack={() => navigation.goBack()} />
      {localActions.element}{streamActions.element}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  // Fixed pure black: set on the page and the list, so no scroll position or cover can show anything else.
  screen: { backgroundColor: Surface.immersive },
  list: { backgroundColor: Surface.immersive },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space.sm, paddingHorizontal: Space.md, paddingVertical: Space.sm },
});
