import { usePlaybackStatus } from '../hooks/usePlaybackStatus';
import { NativePlaybackControl as PlaybackButton } from './NativePlaybackControl';
/**
 * Now Playing transport — Apple Music's layout.
 *
 *   Title / artist                         ( ••• ) ( ♥ )
 *   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *   0:42                                            -2:31
 *            ◀◀              ▶              ▶▶
 *   🔈 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 🔊
 *   ☰              [ speaker | timer ]               ❝
 *
 * White on the cover's own colours, no chrome of our own: the backdrop
 * (NowPlayingBackground) carries the look.
 */
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  DerivedValue,
  Easing,
  runOnJS,
  SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlayerType, Signal } from '../constants/allegraTheme';
import { formatTimeSV, isSeeking } from '../playback/positionBus';
import { NativeAudioPlayer } from '../services/NativeAudioPlayer';
import { lastSongDirection } from '../store/playerStore';
import { swapMarqueeDirection, swapMarqueeKey } from './allegra/marqueeMath';
import { useSettingsStore } from '../store/settingsStore';
import * as Haptics from '../utils/haptics';
import Artwork from './allegra/Artwork';
import { SwapMarquee } from './allegra/Marquee';
import { PLAYER_ARTIST_REST_MS, PLAYER_TITLE_REST_MS, PLAYER_TITLE_SPEED } from './allegra/marqueeMath';
import { MorphIcon, NudgeIcon, Tactile } from './allegra/motion';
import { NativeSkip } from './NativeSkip';
import AppleSlider from './player/AppleSlider';
import { LYRICS_TAP_WINDOW_MS, lyricsButtonTap, LyricsTapRun, NO_TAPS } from './player/lyricsButtonTaps';
import { DOCK_GAP, DOCK_THUMB, LYRICS_MORPH_MS } from './player/lyricsMorph';
import { footerSleepLabel, shouldUseNativeFooter, type FooterAction } from './player/nativeFooterProps';
import NativePlayerFooter, { NATIVE_FOOTER_SLOP, nativePlayerFooterAvailable } from './player/NativePlayerFooter';
import NativeScrubber, { nativeScrubberAvailable } from './player/NativeScrubber';
import { shouldUseNativeScrubber } from './player/nativeScrubberProps';
import NativeSongActions, { nativeSongActionsAvailable } from './player/NativeSongActions';
import { likeLabelOf, shouldUseNativeSongActions, type SongAction } from './player/nativeSongActionsProps';
import { TIME_ROW_STYLE, TIME_TEXT_STYLE } from './player/scrubberLayout';
import { FULLSCREEN_FOOTER_TOP, fullscreenFooterPad } from './player/fullscreenFooter';

interface NowPlayingControlsProps {
  animatedStyle: React.ComponentProps<typeof Animated.View>['style'];
  controlsVisible: boolean;
  storePlaying: boolean;
  currentSongTitle?: string;
  currentSongArtist?: string;
  /** Identity for title swaps, including remote Connect playback. */
  songId?: string;
  isCurrentSongLiked: boolean;
  /** Liked, but a streamed song is still downloading into Liked songs. */
  isLikeSaving?: boolean;
  onTogglePlay: () => void;
  onRetry?: () => void;
  onSkipForward: () => void;
  onSkipBackward: () => void;
  /** Skips go straight to the engine on Android's main thread (components/NativeSkip); the local player only. */
  nativeSkip?: boolean;
  onToggleLike: () => void;
  onToggleLyrics: () => void;
  /** Long press on the lyrics button: the lyrics picker (every source, choose one). */
  onLyricsLongPress?: () => void;
  /** Three quick taps on the lyrics button switched how lyrics light up. */
  onHighlightSwitched?: (highlight: 'letters' | 'lines') => void;
  positionSV: SharedValue<number>;
  durationSV: SharedValue<number>;
  onSeek: (seconds: number) => void | Promise<void>;
  /**
   * The song this phone's own player is playing. When given (Now Playing, never Connect's remote player) and the
   * Kotlin view exists, the scrubber is drawn natively and follows the Media3 clock itself.
   */
  localSongId?: string;
  showLyrics?: boolean;
  /** Opens the player menu; receives the press event for menu anchoring. */
  onMorePress?: (event?: GestureResponderEvent) => void;
  onOpenQueue: () => void;
  /** Leave out to drop the sleep timer (it pauses this phone, not a remote player). */
  onOpenTimer?: () => void;
  /** Time left on the sleep timer ("12 min"), or null when it is off. */
  sleepLabel?: string | null;
  onArtistPress?: () => void;
  onAlbumPress?: () => void;
  /** Lyrics view: drop the volume row so the lines get the room. */
  compact?: boolean;
  /** Up next (0 closed .. 1 open): title, scrubber and transport ride up above the panel, the rest fades. */
  upNext?: SharedValue<number>;
  /** The Up next panel's top edge when open, in the player's frame. */
  upNextTop?: number;
  upNextOpen?: boolean;
  /** The cover, shown as a thumbnail at the start of the title while lyrics are up. */
  coverImageUri?: string;
  /** Cover (0) .. lyrics (1): the thumbnail's slot opens and the title moves over. */
  lyricsP?: SharedValue<number>;
  /** Written here: the thumbnail's centre in the player, so the cover knows where to fly. */
  dockX?: SharedValue<number>;
  dockY?: SharedValue<number>;
  /** Connect: the playing device's volume instead of this phone's. */
  remoteVolume?: { readonly level: SharedValue<number>; readonly onCommit: (volume: number) => void };
  /** Replaces the speaker (Android's output switcher) with Connect's device picker. */
  onOutputPress?: () => void;
  /** Playback is on another device: the output button lights up. */
  outputActive?: boolean;
  /** Lyrics-only view: compact song identity at the top, words filling the screen. */
  lyricsFullscreen?: boolean;
  /** Leaves the lyrics-only view without hiding the lyrics themselves. */
  onExitLyricsFullscreen?: () => void;
  /** Opens the lyrics-only view from the button beside song options. */
  onEnterLyricsFullscreen?: () => void;
}

/**
 * Lyrics open or close: the volume row fades and the rows above it slide down into its place.
 * Transforms and opacity only. The row stays mounted: unmounting it through an `exiting`
 * animation while the box ran a layout transition crashed the app on Android when lyrics opened.
 */
const ROWS_MOVE = { duration: 460, easing: Easing.bezier(0.32, 0.72, 0, 1) };

const CONTENT_PAD = 28;

const INK = '#ffffff';
const INK_SOFT = 'rgba(255,255,255,0.62)';
/** Echo's secondary text on the player: near white, not grey. */
const INK_META = 'rgba(255,255,255,0.86)';

/** Motion is felt as well as seen: every transport tap gets a haptic tick. */
const tick = (kind: 'light' | 'medium' | 'success') => {
  const run = kind === 'success'
    ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    : Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  run.catch(() => {});
};

/** Elapsed on the left, the song's length on the right (Echo); follows the finger while scrubbing. */
const TimeLabels: React.FC<{ display: DerivedValue<number>; durationSV: SharedValue<number> }> = ({ display, durationSV }) => {
  const [elapsed, setElapsed] = useState('0:00');
  const [remaining, setRemaining] = useState('0:00');
  useAnimatedReaction(
    () => {
      const d = durationSV.value;
      const t = display.value * d;
      return `${formatTimeSV(t)}|${formatTimeSV(d)}`;
    },
    (next, prev) => {
      if (next === prev) return;
      const [a, b] = next.split('|');
      runOnJS(setElapsed)(a);
      runOnJS(setRemaining)(b);
    },
  );
  return (
    <View style={styles.timeRow}>
      <Text style={styles.time}>{elapsed}</Text>
      <Text style={styles.time}>{remaining}</Text>
    </View>
  );
};

/** The system media volume, kept in step with the hardware keys. */
/** The heart breathes while a streamed song saves into Liked songs. */
const SavingPulse: React.FC<{ saving: boolean; children: React.ReactNode }> = ({ saving, children }) => {
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(o);
    if (reduce) {
      o.value = 1;
    } else if (saving) {
      o.value = withRepeat(withSequence(withTiming(0.4, { duration: 600, easing: Easing.inOut(Easing.quad) }), withTiming(1, { duration: 600, easing: Easing.inOut(Easing.quad) })), -1);
    } else {
      o.value = withTiming(1, { duration: 160 });
    }
    return () => cancelAnimation(o);
  }, [saving, reduce, o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={style}>{children}</Animated.View>;
};

const NowPlayingControls: React.FC<NowPlayingControlsProps> = ({
  animatedStyle,
  controlsVisible,
  storePlaying,
  currentSongTitle,
  currentSongArtist,
  songId,
  isCurrentSongLiked,
  isLikeSaving = false,
  onTogglePlay,
  onRetry,
  onSkipForward,
  onSkipBackward,
  onToggleLike,
  onToggleLyrics,
  onLyricsLongPress,
  onHighlightSwitched,
  positionSV,
  durationSV,
  onSeek,
  localSongId,
  showLyrics = false,
  onMorePress,
  onOpenQueue,
  onOpenTimer,
  sleepLabel,
  onArtistPress,
  onAlbumPress,
  compact = false,
  upNext,
  upNextTop = 0,
  upNextOpen = false,
  coverImageUri,
  lyricsP,
  dockX,
  dockY,
  remoteVolume,
  onOutputPress,
  outputActive = false,
  lyricsFullscreen = false,
  nativeSkip = false,
  onExitLyricsFullscreen,
  onEnterLyricsFullscreen,
}) => {
  const insets = useSafeAreaInsets();
  // Where the transport's bottom edge sits in the player, so Up next can lift
  // it to just above the panel whatever the screen size.
  const boxY = useSharedValue(0);
  // The title row's place in the box, for the thumbnail's centre.
  const metaY = useSharedValue(0);
  const metaH = useSharedValue(0);
  // The volume row's height (with its gap): under lyrics the rows above slide down by it.
  const volumeH = useSharedValue(0);
  const compactP = useSharedValue(compact ? 1 : 0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) compactP.value = compact ? 1 : 0;
    else compactP.value = withTiming(compact ? 1 : 0, ROWS_MOVE);
  }, [compact, reduceMotion, compactP]);
  const syncDock = () => {
    if (dockX) dockX.value = CONTENT_PAD + DOCK_THUMB / 2;
    // Docked under lyrics, where the title row has slid down by the volume row.
    if (dockY) dockY.value = boxY.value + CONTAINER_PAD_TOP + metaY.value + metaH.value / 2 + volumeH.value;
  };
  // The thumbnail's slot is laid out once, as lyrics open (and removed once
  // they have closed); the title glides over by transform alone, so the flight
  // costs no layout pass per frame. The thumbnail fades in as the cover lands.
  const [docked, setDocked] = useState(showLyrics);
  // The title's shift reads this shared value: a style keyed on React state could keep the lyrics-open offset after
  // the slot was removed, clipping the title's first letters at the left edge.
  const dockedSV = useSharedValue(showLyrics);
  useEffect(() => { dockedSV.value = docked; }, [docked, dockedSV]);
  useEffect(() => {
    if (showLyrics) {
      setDocked(true);
      return undefined;
    }
    const t = setTimeout(() => setDocked(false), LYRICS_MORPH_MS + 40);
    return () => clearTimeout(t);
  }, [showLyrics]);
  const titleShift = DOCK_THUMB + DOCK_GAP;
  const titleStyle = useAnimatedStyle(() => {
    const p = lyricsP ? lyricsP.value : 0;
    return { transform: [{ translateX: dockedSV.value ? -titleShift * (1 - p) : 0 }] };
  });
  const thumbStyle = useAnimatedStyle(() => {
    const p = lyricsP ? lyricsP.value : 0;
    const t = Math.min(1, Math.max(0, (p - 0.78) / 0.22));
    return { opacity: t };
  });
  const transportEnd = useSharedValue(0);
  const liftStyle = useAnimatedStyle(() => {
    const p = upNext ? upNext.value : 0;
    const bottom = boxY.value + CONTAINER_PAD_TOP + transportEnd.value + volumeH.value * compactP.value;
    const lift = transportEnd.value > 0 ? Math.min(0, upNextTop - 6 - bottom) : 0;
    return { transform: [{ translateY: p * lift }] };
  });
  const dropStyle = useAnimatedStyle(() => ({ transform: [{ translateY: volumeH.value * compactP.value }] }));
  const lowerStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, (upNext ? upNext.value : 0) * 2.5) }));
  const shadeStyle = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, (upNext ? upNext.value : 0) * 2.5) }));
  // Long titles scroll only while this screen is the one in front.
  const focused = useIsFocused();
  // Read at render: when the title changes this is the way the skip went.
  const previousMarqueeSongId = useRef(songId);
  const songDirection = swapMarqueeDirection(previousMarqueeSongId.current, songId, lastSongDirection());
  useEffect(() => { previousMarqueeSongId.current = songId; }, [songId]);
  const localPlaybackStatus = usePlaybackStatus();
  const playbackStatus = remoteVolume ? (storePlaying ? 'playing' : 'paused') : localPlaybackStatus;

  const [backNudge, setBackNudge] = useState(0);
  const [forwardNudge, setForwardNudge] = useState(0);

  const progress = useDerivedValue(() => (durationSV.value > 0 ? positionSV.value / durationSV.value : 0));
  const seekSeconds = useCallback(async (seconds: number) => {
    isSeeking.value = true;
    positionSV.value = seconds;
    try {
      await onSeek(seconds);
    } catch {
      // A seek that fails (the other device unreachable) is shown by the player's own error line;
      // here it must only let the scrubber go, never escape from a gesture callback.
    } finally {
      setTimeout(() => { isSeeking.value = false; }, 280);
    }
  }, [positionSV, onSeek]);
  const seek = useCallback((fraction: number) => seekSeconds(fraction * durationSV.value), [seekSeconds, durationSV]);
  const nativeScrubber = shouldUseNativeScrubber(nativeScrubberAvailable(), localSongId);

  // The lyrics button: one tap shows or hides lyrics, three quick ones switch letter by letter ↔ line by line,
  // a long press opens the picker (player/lyricsButtonTaps).
  const taps = useRef<LyricsTapRun>(NO_TAPS);
  const closeLater = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (closeLater.current) clearTimeout(closeLater.current); }, []);
  const lyricsTap = useCallback(() => {
    const { run, action } = lyricsButtonTap(taps.current, Date.now(), showLyrics);
    taps.current = run;
    if (action === 'toggle') {
      tick('light');
      onToggleLyrics();
    } else if (action === 'toggle-later') {
      tick('light');
      if (closeLater.current) clearTimeout(closeLater.current);
      closeLater.current = setTimeout(() => {
        closeLater.current = null;
        if (taps.current.count > 0) {
          taps.current = NO_TAPS;
          onToggleLyrics();
        }
      }, LYRICS_TAP_WINDOW_MS);
    } else if (action === 'switch-highlight') {
      if (closeLater.current) { clearTimeout(closeLater.current); closeLater.current = null; }
      const settings = useSettingsStore.getState();
      const next = settings.lyricsHighlight === 'lines' ? 'letters' : 'lines';
      settings.setLyricsHighlight(next);
      tick('light');
      onHighlightSwitched?.(next);
    }
  }, [showLyrics, onToggleLyrics, onHighlightSwitched]);
  const lyricsLongPress = useCallback(() => {
    if (!onLyricsLongPress) return;
    if (closeLater.current) { clearTimeout(closeLater.current); closeLater.current = null; }
    taps.current = NO_TAPS;
    tick('light');
    onLyricsLongPress();
  }, [onLyricsLongPress]);

  const output = useCallback(() => {
    tick('light');
    NativeAudioPlayer.openOutputSwitcher();
  }, []);

  // The Kotlin bottom row only says which control was used; the same handlers as the React Native row run here.
  const nativeFooter = shouldUseNativeFooter(nativePlayerFooterAvailable());
  const onFooterAction = useCallback((action: FooterAction) => {
    if (action === 'queue') {
      tick('light');
      onOpenQueue();
    } else if (action === 'output') {
      if (onOutputPress) { tick('light'); onOutputPress(); } else output();
    } else if (action === 'timer') {
      if (onOpenTimer) { tick('light'); onOpenTimer(); }
    } else if (action === 'lyrics') {
      lyricsTap();
    } else {
      lyricsLongPress();
    }
  }, [onOpenQueue, onOutputPress, onOpenTimer, output, lyricsTap, lyricsLongPress]);

  // The Kotlin buttons at the end of the title row only say which was used; the same handlers as the React Native ones run here.
  const nativeActions = shouldUseNativeSongActions(nativeSongActionsAvailable());
  const onSongAction = useCallback((action: SongAction) => {
    if (action === 'fullscreen') {
      tick('light');
      (lyricsFullscreen ? onExitLyricsFullscreen : onEnterLyricsFullscreen)?.();
    } else if (action === 'more') {
      tick('light');
      onMorePress?.();
    } else {
      tick(isCurrentSongLiked ? 'light' : 'success');
      onToggleLike();
    }
  }, [lyricsFullscreen, onExitLyricsFullscreen, onEnterLyricsFullscreen, onMorePress, isCurrentSongLiked, onToggleLike]);

  // Fullscreen lyrics keep this same bottom stack (title, scrubber, transport, the three action icons);
  // only the first icon turns from "open" into "exit".
  return (
    <Animated.View
      // Pinned to the bottom. Its size never changes with lyrics: the volume row fades in place (ROWS_MOVE).
      style={[styles.container, lyricsFullscreen && styles.containerCompact, animatedStyle]}
      pointerEvents={controlsVisible ? 'box-none' : 'none'}
      onLayout={e => { boxY.value = e.nativeEvent.layout.y; syncDock(); }}
    >
      {/* Only a whisper of shade — enough for white text over a bright canvas video. */}
      <Animated.View style={[StyleSheet.absoluteFill, shadeStyle]} pointerEvents="none">
        <LinearGradient colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.28)']} style={StyleSheet.absoluteFill} />
      </Animated.View>

      {/* Echo keeps the bottom row a clear step above the system bar. */}
      <Animated.View
        style={[styles.content, { paddingBottom: lyricsFullscreen ? fullscreenFooterPad(insets.bottom) : Math.max(insets.bottom, 16) + 14 }, liftStyle]}
        pointerEvents="box-none"
      >
        <Animated.View style={[dropStyle, nativeActions && styles.metaRowNative]} pointerEvents="box-none">
        <Animated.View
          style={[styles.metaRow, nativeActions && styles.metaRowNative]}
          onLayout={e => { metaY.value = e.nativeEvent.layout.y; metaH.value = e.nativeEvent.layout.height; syncDock(); }}
        >
          {docked ? (
            <View style={styles.dockSlot}>
              <Animated.View style={[styles.dockThumb, thumbStyle]} pointerEvents={showLyrics ? 'auto' : 'none'}>
                <Tactile onPress={() => { tick('light'); onToggleLyrics(); }} pressScale={0.96} accessibilityRole="button" accessibilityLabel="Show the cover">
                  <Artwork uri={coverImageUri} title={currentSongTitle ?? ''} artist={currentSongArtist} size={DOCK_THUMB} style={styles.dockArt} />
                </Tactile>
              </Animated.View>
            </View>
          ) : null}
          <View style={styles.metaText}>
            {/* The dock shift lives on its own view: Tactile's press scale would otherwise replace its transform. */}
            <Animated.View style={titleStyle}>
              <Tactile onPress={onAlbumPress} disabled={!onAlbumPress} accessibilityRole="button" accessibilityLabel="Open song album" style={styles.swapLine}>
                {/* 1.41.0 (owner): full size, scrolling slowly right to left with a 5 s rest; never shrunk to fit. */}
                <SwapMarquee style={styles.title} key={swapMarqueeKey(songId, currentSongTitle || 'Not playing')} songId={songId} direction={songDirection} active={focused} speed={PLAYER_TITLE_SPEED}
                  restMs={PLAYER_TITLE_REST_MS}>{currentSongTitle || 'Not playing'}</SwapMarquee>
              </Tactile>
              {/* Fullscreen lyrics keep only the song's name beside the cover. */}
              {lyricsFullscreen ? null : (
              <Tactile onPress={onArtistPress} disabled={!onArtistPress} accessibilityRole="button" accessibilityLabel="Open artist" style={styles.swapLineSmall}>
                <SwapMarquee style={styles.artist} key={swapMarqueeKey(songId, currentSongArtist || 'Unknown artist')} songId={songId} direction={songDirection} active={focused} speed={PLAYER_TITLE_SPEED}
                  restMs={PLAYER_ARTIST_REST_MS}>{currentSongArtist || 'Unknown artist'}</SwapMarquee>
              </Tactile>
              )}
            </Animated.View>
          </View>

          {nativeActions ? (
            <NativeSongActions
              fullscreen={onEnterLyricsFullscreen ? (lyricsFullscreen ? 'exit' : 'enter') : 'none'}
              hasMore={!!onMorePress && !lyricsFullscreen}
              liked={isCurrentSongLiked}
              saving={isLikeSaving}
              likeLabel={likeLabelOf(isCurrentSongLiked, isLikeSaving)}
              slop={8}
              reduceMotion={reduceMotion}
              onAction={onSongAction}
            />
          ) : (
            <>
          {onEnterLyricsFullscreen ? (
            <Tactile
              onPress={() => { tick('light'); (lyricsFullscreen ? onExitLyricsFullscreen : onEnterLyricsFullscreen)?.(); }}
              hitSlop={8}
              pressScale={0.88}
              accessibilityRole="button"
              accessibilityLabel={lyricsFullscreen ? 'Exit lyrics fullscreen' : 'Open lyrics fullscreen'}
              style={styles.roundGlass}
            >
              <MaterialCommunityIcons name={lyricsFullscreen ? 'fullscreen-exit' : 'fullscreen'} size={19} color={INK} />
            </Tactile>
          ) : null}
          {onMorePress && !lyricsFullscreen ? (
            <Tactile
              onPress={e => { tick('light'); onMorePress(e); }}
              hitSlop={8}
              pressScale={0.88}
              accessibilityRole="button"
              accessibilityLabel="Song options"
              style={styles.roundGlass}
            >
              <Ionicons name="ellipsis-vertical" size={18} color={INK} />
            </Tactile>
          ) : null}
          <Tactile
            onPress={() => { tick(isCurrentSongLiked ? 'light' : 'success'); onToggleLike(); }}
            hitSlop={8}
            pressScale={0.88}
            accessibilityRole="button"
            accessibilityLabel={isLikeSaving ? 'Saving to Liked songs, tap to cancel' : isCurrentSongLiked ? 'Unlike' : 'Like'}
            style={styles.roundGlass}
          >
            <SavingPulse saving={isLikeSaving}>
              <MorphIcon on={isCurrentSongLiked} onIcon="heart" offIcon="heart-outline" size={20} color={INK} />
            </SavingPulse>
          </Tactile>
            </>
          )}
        </Animated.View>

        <Animated.View style={[styles.scrubber, lyricsFullscreen && styles.scrubberCompact]}>
          {nativeScrubber && localSongId ? (
            <NativeScrubber
              songId={localSongId}
              positionSV={positionSV}
              durationSV={durationSV}
              onSeekSeconds={seekSeconds}
              live={focused}
              trackHeight={10}
              accessibilityLabel="Song position"
            />
          ) : (
            <AppleSlider
              progress={progress}
              onCommit={seek}
              height={10}
              accessibilityLabel="Song position"
              renderBelow={display => <TimeLabels display={display} durationSV={durationSV} />}
            />
          )}
        </Animated.View>

        {/* Fullscreen lyrics drop the transport and the rows under it: cover, name, exit, like and the scrubber stay. */}
        {lyricsFullscreen ? null : (
        <Animated.View style={styles.transport} onLayout={e => { transportEnd.value = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }}>
            <>
              <View style={styles.transportSlot}>
                <NativeSkip direction={-1} enabled={nativeSkip} slop={12}>
                  <Tactile onPress={() => { tick('light'); setBackNudge(n => n + 1); if (!nativeSkip) onSkipBackward(); }} hitSlop={12} pressScale={0.84} accessibilityRole="button" accessibilityLabel="Previous" style={styles.transportBtn}>
                    <NudgeIcon name="play-back" size={42} color={INK} direction={-1} trigger={backNudge} />
                  </Tactile>
                </NativeSkip>
              </View>
              <View style={styles.transportSlot}>
                <PlaybackButton remote={!!remoteVolume} status={playbackStatus} onPress={() => { if (!remoteVolume && playbackStatus === 'error') (onRetry ?? onTogglePlay)(); else onTogglePlay(); }} />
              </View>
              <View style={styles.transportSlot}>
                <NativeSkip direction={1} enabled={nativeSkip} slop={12}>
                  <Tactile onPress={() => { tick('light'); setForwardNudge(n => n + 1); if (!nativeSkip) onSkipForward(); }} hitSlop={12} pressScale={0.84} accessibilityRole="button" accessibilityLabel="Next" style={styles.transportBtn}>
                    <NudgeIcon name="play-forward" size={42} color={INK} direction={1} trigger={forwardNudge} />
                  </Tactile>
                </NativeSkip>
              </View>
            </>
        </Animated.View>
        )}
        </Animated.View>

        {lyricsFullscreen ? null : (
        <Animated.View style={[lowerStyle, nativeFooter && styles.lowerNative]} pointerEvents={upNextOpen ? 'none' : 'box-none'}>


        {nativeFooter ? (
          <NativePlayerFooter
            style={styles.footerNative}
            hasTimer={!!onOpenTimer}
            sleepLabel={footerSleepLabel(!!onOpenTimer, sleepLabel)}
            outputDevices={!!onOutputPress}
            outputActive={outputActive}
            showLyrics={showLyrics}
            lyricsLongPress={!!onLyricsLongPress}
            waveColor={Signal.wave}
            reduceMotion={reduceMotion}
            onAction={onFooterAction}
          />
        ) : (
        <View style={styles.footer}>
          <Tactile onPress={() => { tick('light'); onOpenQueue(); }} hitSlop={10} pressScale={0.86} style={styles.footerBtn} accessibilityRole="button" accessibilityLabel="Up next">
            <Ionicons name="list" size={26} color={INK_SOFT} />
          </Tactile>

          <View style={styles.segment}>
            <Tactile
              onPress={onOutputPress ? () => { tick('light'); onOutputPress(); } : output}
              pressScale={0.92}
              style={styles.segmentHalf}
              accessibilityRole="button"
              accessibilityLabel="Play on another device"
            >
              {onOutputPress
                ? <MaterialCommunityIcons name="devices" size={21} color={outputActive ? Signal.wave : INK_SOFT} />
                : <MaterialCommunityIcons name="speaker" size={22} color={INK_SOFT} />}
            </Tactile>
            {onOpenTimer ? (
              <>
                <View style={styles.segmentDivider} />
                <Tactile onPress={() => { tick('light'); onOpenTimer(); }} pressScale={0.92} style={styles.segmentHalf} accessibilityRole="button" accessibilityLabel="Sleep timer">
                  <MaterialCommunityIcons name="timer-outline" size={21} color={sleepLabel ? INK : INK_SOFT} />
                  {sleepLabel ? <Text style={styles.sleepText}>{sleepLabel}</Text> : null}
                </Tactile>
              </>
            ) : null}
          </View>

          <Tactile
            onPress={lyricsTap}
            onLongPress={onLyricsLongPress ? lyricsLongPress : undefined}
            delayLongPress={420}
            hitSlop={10}
            pressScale={0.86}
            style={[styles.footerBtn, showLyrics && styles.footerBtnOn]}
            accessibilityRole="button"
            accessibilityLabel={showLyrics ? 'Hide lyrics' : 'Show lyrics'}
            accessibilityHint="Long press to choose from every lyrics source. Triple tap to switch letter by letter and line by line."
          >
            <MaterialCommunityIcons name="comment-quote-outline" size={24} color={showLyrics ? '#15151a' : INK_SOFT} />
          </Tactile>
        </View>
        )}
        </Animated.View>
        )}
      </Animated.View>
    </Animated.View>
  );
};

const CONTAINER_PAD_TOP = 40;

const styles = StyleSheet.create({
  container: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 15, paddingTop: CONTAINER_PAD_TOP },
  // Fullscreen lyrics: a slim footer (NowPlayingLyricsArea FULLSCREEN_FOOTER_BASE adds up to this).
  containerCompact: { paddingTop: FULLSCREEN_FOOTER_TOP },
  content: { paddingHorizontal: CONTENT_PAD },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // The native buttons carry their 8 dp hit slop outside the row's right edge: Android hands a child only the touches
  // inside its parent, so the row and the block that holds it (`dropStyle`) are each padded by the slop and pulled back
  // by an equal negative margin (nothing moves).
  metaRowNative: { marginRight: -8, paddingRight: 8 },
  // The row's gap (10) plus this makes DOCK_GAP between the thumbnail and the title.
  dockSlot: { width: DOCK_THUMB, height: DOCK_THUMB, marginRight: DOCK_GAP - 10 },
  dockThumb: { position: 'absolute', left: 0, top: 0, width: DOCK_THUMB, height: DOCK_THUMB },
  dockArt: { width: DOCK_THUMB, height: DOCK_THUMB, borderRadius: 8, overflow: 'hidden' },
  metaText: { flex: 1 },
  // At least one line tall, growing for a two-line title or large text instead of clipping it.
  swapLine: { minHeight: 30, overflow: 'hidden' },
  swapLineSmall: { minHeight: 24, overflow: 'hidden' },
  title: { ...PlayerType.title, color: INK, fontWeight: '700' },
  artist: { ...PlayerType.artist, color: INK_META },
  roundGlass: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  // Echo's rhythm: 24 between the title and the bar, 24 under the times,
  // ~30 between the transport and the bottom row.
  scrubber: { marginTop: 24 },
  scrubberCompact: { marginTop: 10 },
  // Shared with the native scrubber's spacer, so both are the same height.
  timeRow: TIME_ROW_STYLE,
  time: TIME_TEXT_STYLE,
  transport: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  transportSlot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  transportBtn: { width: 76, height: 72, alignItems: 'center', justifyContent: 'center' },
  nativeTransport: { width: '100%', height: 72 },
  // The play triangle's optical centre sits left of its box.
  playNudge: { marginLeft: 5 },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  volumeSlider: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 26 },
  // The native row is the row plus its 10 dp hit slop on every side. Android hands a child only the touches inside its
  // parent, so the parent is padded by the slop and pulled back by an equal negative margin (its children keep their
  // places), and the row's own top margin gives up the slop it now carries.
  lowerNative: { marginHorizontal: -NATIVE_FOOTER_SLOP, paddingHorizontal: NATIVE_FOOTER_SLOP, marginBottom: -NATIVE_FOOTER_SLOP, paddingBottom: NATIVE_FOOTER_SLOP },
  footerNative: { marginTop: 26 - NATIVE_FOOTER_SLOP },
  footerBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  footerBtnOn: { backgroundColor: 'rgba(255,255,255,0.9)' },
  segment: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
  segmentHalf: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 64, minHeight: 44, paddingHorizontal: 16, gap: 6 },
  segmentDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: 'rgba(255,255,255,0.3)' },
  sleepText: { color: INK, fontSize: 13, fontWeight: '600' },
});

export default React.memo(NowPlayingControls);
