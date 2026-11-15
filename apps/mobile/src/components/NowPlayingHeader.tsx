/**
 * Apple Music has no header bar on Now Playing — just a grabber at the top.
 * Tap it (or swipe the screen down) to go back. While a LuvLink room
 * is open, a small chip beside it shows how many are listening; while another
 * device plays over Connect, one says which device it is.
 */
import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Signal } from '../constants/allegraTheme';
import { Tactile } from '../ui';
import NativeHeader, { nativeHeaderAvailable } from './player/NativeHeader';
import { shouldUseNativeHeader, type HeaderAction } from './player/nativeHeaderProps';

interface NowPlayingHeaderProps {
  animatedStyle: React.ComponentProps<typeof Animated.View>['style'];
  controlsVisible: boolean;
  onGoBack: () => void;
  /** Listeners in the LuvLink room, or null when not in one. */
  together?: number | null;
  onTogetherPress?: () => void;
  /** Connect: the device that is playing, or null when this phone plays. */
  playingOn?: { readonly name: string; readonly kind: 'web' | 'android' | 'ios' } | null;
  onPlayingOnPress?: () => void;
}

const NowPlayingHeader: React.FC<NowPlayingHeaderProps> = ({
  animatedStyle, controlsVisible, onGoBack, together = null, onTogetherPress, playingOn = null, onPlayingOnPress,
}) => {
  const insets = useSafeAreaInsets();
  // The Kotlin header only says which control was used; the same handlers as the React Native ones run here.
  const nativeHeader = shouldUseNativeHeader(nativeHeaderAvailable());
  const onNativeAction = useCallback((action: HeaderAction) => {
    if (action === 'back') onGoBack();
    else if (action === 'together') onTogetherPress?.();
    else onPlayingOnPress?.();
  }, [onGoBack, onTogetherPress, onPlayingOnPress]);
  return (
    <Animated.View
      style={[styles.container, { paddingTop: insets.top + 6 }, animatedStyle]}
      pointerEvents={controlsVisible ? 'box-none' : 'none'}
    >
      {nativeHeader ? (
        <NativeHeader together={together} playingOn={playingOn} waveColor={Signal.wave} onAction={onNativeAction} />
      ) : (
        <>
          <Tactile onPress={onGoBack} hitSlop={{ top: 12, bottom: 12, left: 40, right: 40 }} pressScale={0.9} accessibilityRole="button" accessibilityLabel="Close player">
            <View style={styles.grabber} />
          </Tactile>
          {together !== null ? (
            <Tactile onPress={onTogetherPress} hitSlop={{ top: 9, bottom: 9, left: 0, right: 0 }} wrapperStyle={styles.chipWrap} style={styles.chip} pressScale={0.96} accessibilityRole="button" accessibilityLabel={`Listening together, ${together} in the room`}>
              <MaterialCommunityIcons name="account-multiple" size={15} color="#fff" />
              <Text style={styles.chipText}>{`Listening together · ${together}`}</Text>
            </Tactile>
          ) : null}
          {playingOn ? (
            <Tactile onPress={onPlayingOnPress} hitSlop={{ top: 9, bottom: 9, left: 0, right: 0 }} wrapperStyle={styles.chipWrap} style={styles.chip} pressScale={0.96} accessibilityRole="button" accessibilityLabel={`Playing on ${playingOn.name}. Choose a device`}>
              <MaterialCommunityIcons name={playingOn.kind === 'web' ? 'laptop' : 'cellphone'} size={15} color={Signal.wave} />
              <Text style={styles.chipText} numberOfLines={1}>{`Playing on ${playingOn.name}`}</Text>
            </Tactile>
          ) : null}
        </>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 20 },
  grabber: { width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)', marginVertical: 6 },
  chipWrap: { marginTop: 18, maxWidth: '80%' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.35)' },
  chipText: { flexShrink: 1, color: '#fff', fontSize: 13, fontWeight: '600' },
});

export default React.memo(NowPlayingHeader);
