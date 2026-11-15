import { useFocusEffect, usePreventRemove } from '@react-navigation/native';
import { fromMobileId, parseSongRef } from '@shared/songRef';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dimensions, StatusBar, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as GestureHandler from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { rubberBand } from '../components/allegra/physics';
import ConnectRemotePlayer from '../components/connect/ConnectRemotePlayer';
import LuvLinkPanel from '../components/luvLink/LuvLinkPanel';
import { useNativeSkip } from '../components/NativeSkip';
import NowPlayingBackground from '../components/NowPlayingBackground';
import NowPlayingControls from '../components/NowPlayingControls';
import NowPlayingHeader from '../components/NowPlayingHeader';
import NowPlayingLyricsArea, { fullCoverHeight, CONTROLS_CLEARANCE, HEADER_CLEARANCE, LYRICS_MORPH_MS } from '../components/NowPlayingLyricsArea';
import AmbientMode from '../components/player/AmbientMode';
import { prefetchCover } from '../components/player/coverImages';
import { isCoverFull, SEEK_STEP_S, seekSide, seekTarget } from '../components/player/coverStage';
import LyricsPicker from '../components/player/LyricsPicker';
import { PlaybackFailureNotice } from '../components/player/PlaybackFailureNotice';
import { SongDetails, TempoPitch } from '../components/player/PlayerExtras';
import type { PlayerMenuAction, PlayerRequest } from '../components/player/playerMenuAction';
import { useSongActions } from '../components/library/useSongActions';
import { PlayerSheet, SleepTimerList } from '../components/player/PlayerSheet';
import SeekRipple, { SeekPulse } from '../components/player/SeekRipple';
import UpNextPanel from '../components/player/UpNextPanel';
import { Toast } from '../components/Toast';
import { Glass, Motion, Radius } from '../constants/allegraTheme';
import { useCanvasArtwork } from '../hooks/useCanvasArtwork';
import { useNowPlayingLogic } from '../hooks/useNowPlayingLogic';
import { handlePlayerBack, registerPlayerBackHandler } from '../navigation/playerBack';
import { shouldExitLyricsFullscreen, shouldOpenLyricsFullscreen, startsInFooter } from '../navigation/lyricsGesture';
import { fullscreenClearance } from '../components/player/fullscreenFooter';
import { beginSheetDrag, settleSheet, usePlayerSheetMotion } from '../navigation/usePlayerSheetMotion';
import { cardCoverRect, heroCoverRect, playerContentOpacity } from '../navigation/playerTransition';
import { SHEET_TOP_RADIUS } from '../navigation/miniShell';
import { shouldCloseSheet } from '../navigation/sheetClose';
import { playerCoverFrom } from '../navigation/sheetProgress';
import { MiniPlayerGlow } from '../components/MiniPlayerGlow';
import CoverGhost from '../components/player/CoverGhost';
import { DOCK_THUMB } from '../components/player/lyricsMorph';
import { heroHeight as playerHeroHeight } from '../components/player/AppleBackdrop';
import { playerSheetRest, tabBarTopFromBottom } from '../navigation/tabs';
import { shellNavHeight, SEEK_BAND_HEIGHT, miniRowHeight } from '../navigation/v6Shell';
import { durationSV, isSeeking, positionSV } from '../playback/positionBus';
import { nextSwipeIndex, previousSwipeAction } from '../playback/swipeRule';
import { useConnect } from '../services/connect/ConnectProvider';
import { NativeAudioPlayer } from '../services/NativeAudioPlayer';
import { notifyIslandAppShownAfterDraw } from '../services/NativeDynamicIsland';
import { refetchCurrent, setAsRingtone, shareSong, shuffleUpcoming } from '../services/player/playerMenuActions';
import { StreamService } from '../services/stream/StreamService';
import { isStreamSongId } from '../services/stream/streamSong';
import { useLuvLinkStore } from '../store/luvLinkStore';
import { usePlaybackModesStore } from '../store/playbackModesStore';
import { playerControls, usePlayerStore } from '../store/playerStore';
import { isCardPlayerBackground, useSettingsStore } from '../store/settingsStore';
import { sleepLabel, useSleepTimerStore } from '../store/sleepTimerStore';
import { RootStackScreenProps, BrowseStackParamList } from '../types/navigation';
import { Song } from '../types/song';
import { diag } from '../utils/diag';
import * as Haptics from '../utils/haptics';
import { navigationRef, safeGoBack } from '../utils/navigationService';
import { CoverArtSearchScreen } from './CoverArtSearchScreen';

const { Gesture, GestureDetector } = GestureHandler;
// Echo Music's sheet springs (Compose's defaults), critically damped — no
// bounce: a tap opens or closes on the softer one (StiffnessMediumLow, 400), a
// flick hands its speed to the firmer one (StiffnessMedium, 1500) so it lands
// fast. Every one starts from where the sheet is with the finger's speed, so a
// grab mid-flight just takes over.
const SOFT_SPRING = Motion.spring.open;
const FLING_SPRING = Motion.spring.fling;
const SETTLE_SPRING = Motion.spring.settle;
/** A release this fast (px/s) counts as a flick and takes the firmer spring. */
// The page underneath only dims while the sheet moves. It used to blur, which
// on Android re-renders the page under it on every frame of the drag and made
// opening and closing the player stutter; a dim costs nothing.
const PAGE_DIM = 0.5;
/** The sheet's top corners while it moves; square once open. */

type Props = RootStackScreenProps<'NowPlaying'>;

const LocalNowPlayingScreen: React.FC<Props> = ({ navigation, route }) => {
  const { songId } = route.params;
  const setMiniPlayerHiddenSource = usePlayerStore(state => state.setMiniPlayerHiddenSource);
  // The screen, not the window: on Android the window leaves out the nav bar,
  // and a sheet parked at the window height would leave a sliver showing.
  const { width: windowW, height: windowH, fontScale } = useWindowDimensions();
  const screenH = Math.max(windowH, Dimensions.get('screen').height);
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const pillNav = useSettingsStore(s => s.navBarStyle) === 'modern-pill';

  // ── Sheet: grow out of the pill, follow the finger, shrink back ──────────
  // translateY 0 = open; restY = resting on the pill (its top edge), where the
  // sheet is scaled to the pill's width. It starts there, so the first frame
  // never flashes the player at rest.
  const restY = pillNav ? screenH - shellNavHeight(windowH, insets.bottom, fontScale) - SEEK_BAND_HEIGHT - miniRowHeight(fontScale) : playerSheetRest(windowW, screenH, insets.bottom, pillNav).y;
  // Opened out of the system island: its native launch surface grows over the app, so the sheet is
  // already open in the first frame instead of rising a second time inside it.
  const fluid = useSettingsStore(s => s.fluidPlayer);
  const revealPill = useCallback(() => setMiniPlayerHiddenSource('NowPlaying', false), [setMiniPlayerHiddenSource]);
  const { holdRoute, sheetY, progress, closing, animateClose, controls: sheetControls } = usePlayerSheetMotion(restY, route.params.instant === true, fluid, reduceMotion, revealPill);
  // Where to go once the sheet is gone (the artist line opens their page).
  const afterClose = useRef<{ kind: 'artist'; name: string } | { kind: 'album'; params: BrowseStackParamList['CatalogAlbum'] } | null>(null);
  useEffect(() => {
    if (holdRoute) return;
    safeGoBack(navigation);
    const destination = afterClose.current;
    afterClose.current = null;
    if (destination && navigationRef.isReady()) {
      if (destination.kind === 'artist') navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'Artist', params: { name: destination.name } } });
      else navigationRef.navigate('Main', { screen: 'Browse', params: { screen: 'CatalogAlbum', params: destination.params } });
    }
  }, [holdRoute, navigation]);

  // Ambient mode (player menu): back leaves ambient first, then the player.
  const [ambient, setAmbient] = useState(false);
  const ambientRef = useRef(false);
  ambientRef.current = ambient;
  // A sheet over the player (timer, menu…). Swiping down or pressing back
  // closes the sheet only; the next swipe or press closes the player.
  type Sheet = 'timer' | 'menu' | 'details' | 'advanced' | 'together' | 'lyrics';
  const initialSheet = route.params.sheet;
  const [sheet, setSheet] = useState<Sheet | null>(initialSheet && initialSheet !== 'queue' ? initialSheet : null);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  // This is deliberately separate from showLyrics: leaving focus returns to
  // the regular lyrics view instead of making the listener reopen it.
  const [lyricsFullscreen, setLyricsFullscreen] = useState(false);
  // Opening and leaving also change showLyrics, which comes from a hook further down, so the
  // gestures and Back call through these refs (set once the hook has run).
  const openLyricsFullscreenRef = useRef<() => void>(() => undefined);
  const exitLyricsFullscreenRef = useRef<() => void>(() => undefined);
  const openLyricsFullscreen = useCallback(() => openLyricsFullscreenRef.current(), []);
  const exitLyricsFullscreen = useCallback(() => exitLyricsFullscreenRef.current(), []);

  // ── Up next: swipe up and the queue rises under the player (YouTube Music) ──
  // 0 closed .. 1 open. The finger drives it both ways; the title, scrubber and
  // transport ride up above the panel (NowPlayingControls), the rest fades.
  const upNext = useSharedValue(0);
  const [upNextOpen, setUpNextOpen] = useState(false);
  const [upNextMounted, setUpNextMounted] = useState(false);
  const upNextRef = useRef(false);
  upNextRef.current = upNextOpen;
  const upNextShown = useSharedValue(false);
  const frameH = useSharedValue(screenH);
  const [frameHeight, setFrameHeight] = useState(screenH);
  // The panel's top edge: half the player, so the compact transport keeps its room above it.
  const upNextTop = Math.round(frameHeight * 0.5);
  const upNextTravel = Math.max(1, frameHeight - upNextTop);

  const markUpNext = useCallback((open: boolean) => {
    setUpNextOpen(open);
    diag('player', `up next ${open ? 'open' : 'closed'}`);
  }, []);
  const openUpNext = useCallback((velocity = 0) => {
    setUpNextMounted(true);
    upNextShown.value = true;
    upNext.value = withSpring(1, { ...SETTLE_SPRING, velocity: -velocity / upNextTravel });
    markUpNext(true);
  }, [upNext, upNextShown, upNextTravel, markUpNext]);
  const closeUpNext = useCallback((velocity = 0) => {
    upNextShown.value = false;
    upNext.value = withSpring(0, { ...SETTLE_SPRING, velocity: -Math.max(0, velocity) / upNextTravel });
    markUpNext(false);
  }, [upNext, upNextShown, upNextTravel, markUpNext]);

  const handleBack = useCallback(() => handlePlayerBack({
    lyricsFullscreen,
    hasSheet: Boolean(sheetRef.current),
    upNextOpen: upNextRef.current,
    ambient: ambientRef.current,
  }, {
    exitLyricsFullscreen,
    closeSheet: () => setSheet(null),
    closeUpNext: () => closeUpNext(0),
    leaveAmbient: () => setAmbient(false),
    closePlayer: () => animateClose(0),
  }), [lyricsFullscreen, exitLyricsFullscreen, closeUpNext, animateClose]);

  // The root BackHandler invokes this before NavigationContainer's stack pop.
  useFocusEffect(useCallback(() => registerPlayerBackHandler(handleBack), [handleBack]));

  usePreventRemove(holdRoute, handleBack);

  // Drag down from anywhere to dismiss. Over the lyrics it only takes over once
  // the list is scrolled to its top — otherwise the drag scrolls the lyrics.
  const lyricsOffset = useSharedValue(0);
  const showLyricsSV = useSharedValue(false);
  const grabY = useSharedValue(0);
  // The lyrics list owns a drag that starts on it; anywhere else a drag down
  // closes the player, even with the lyrics scrolled.
  const lyricsTop = insets.top + HEADER_CLEARANCE;
  // Activation is the handler's own (12pt down, native side): a manual
  // activate() from onTouchesMove could land after a quick flick had already
  // lifted, and the flick did nothing.
  // With Up next open the same drag, started above the panel, lowers the
  // panel instead (the panel's own pan handles drags that start on it).
  const dragUpNext = useSharedValue(false);
  const dismissActive = useSharedValue(false);
  const dismissGesture = Gesture.Pan()
    .enabled(!ambient && sheet === null && !lyricsFullscreen)
    .activeOffsetY(12)
    .failOffsetY(-10)
    .failOffsetX([-24, 24])
    .onTouchesDown((e, state) => {
      'worklet';
      const y = e.allTouches[0] ? e.allTouches[0].y : 0;
      dragUpNext.value = upNextShown.value;
      if (upNextShown.value) {
        if (y > upNextTop) state.fail();
        return;
      }
      // Only while the lyrics are showing: the hidden (pre-mounted) list keeps
      // scrolling with the song, and must not block the swipe on the cover.
      if (showLyricsSV.value && lyricsOffset.value > 2) {
        if (y > lyricsTop && y < frameH.value - CONTROLS_CLEARANCE) state.fail();
      }
    })
    .onStart(() => {
      'worklet';
      dismissActive.value = true;
      // Grabbed mid-flight: carry on from where the sheet is, not from 0.
      if (!dragUpNext.value) grabY.value = beginSheetDrag(sheetControls);
    })
    .onUpdate(e => {
      'worklet';
      if (dragUpNext.value) {
        upNext.value = Math.min(1, Math.max(0, 1 - e.translationY / upNextTravel));
        return;
      }
      const y = grabY.value + e.translationY;
      // Past the top it resists instead of detaching; it never goes below the pill.
      sheetY.value = y >= 0 ? Math.min(y, restY) : rubberBand(y, 120);
    })
    .onEnd(e => {
      'worklet';
      if (dragUpNext.value) {
        if (shouldCloseSheet(e.translationY, e.velocityY)) runOnJS(closeUpNext)(e.velocityY);
        else upNext.value = withSpring(1, SETTLE_SPRING);
        return;
      }
      settleSheet(sheetControls, e.velocityY);
    })
    .onFinalize((_event, success) => {
      'worklet';
      if (!success && dismissActive.value && !dragUpNext.value) settleSheet(sheetControls, 0);
      dismissActive.value = false;
    });

  // Swipe up anywhere but the lyrics list (which scrolls) to open the fullscreen lyrics. Up next
  // stays behind its queue button and `player?sheet=queue`. A short swipe changes nothing.
  const lyricsUpGesture = Gesture.Pan()
    .enabled(!ambient && sheet === null && !upNextOpen && !lyricsFullscreen)
    .activeOffsetY(-12)
    .failOffsetY(10)
    .failOffsetX([-24, 24])
    .onTouchesDown((e, state) => {
      'worklet';
      const y = e.allTouches[0] ? e.allTouches[0].y : 0;
      if (closing.value || (showLyricsSV.value && y > lyricsTop && y < frameH.value - CONTROLS_CLEARANCE)) state.fail();
    })
    .onEnd(e => {
      'worklet';
      if (shouldOpenLyricsFullscreen(e.translationY, e.velocityY)) runOnJS(openLyricsFullscreen)();
    });
  // Fullscreen lyrics: a swipe down that starts in the controls footer goes back to the cover. This
  // pan runs once per touch, and the player's dismiss pan is off while the lyrics are fullscreen, so
  // one swipe never also closes the player; the next, separate swipe does (dismissGesture).
  // Fullscreen lyrics end at a slim footer, so only a swipe that starts there goes back to the cover.
  const fullscreenFooterHeight = fullscreenClearance(insets.bottom);
  const lyricsDownGesture = Gesture.Pan()
    .enabled(!ambient && sheet === null && lyricsFullscreen)
    .activeOffsetY(12)
    .failOffsetY(-10)
    .failOffsetX([-24, 24])
    .onTouchesDown((e, state) => {
      'worklet';
      const y = e.allTouches[0] ? e.allTouches[0].y : 0;
      if (!startsInFooter(y, frameH.value, fullscreenFooterHeight)) state.fail();
    })
    .onEnd(e => {
      'worklet';
      if (shouldExitLyricsFullscreen(e.translationY, e.velocityY)) runOnJS(exitLyricsFullscreen)();
    });
  const reverseActive = useSharedValue(false);
  const reverseGesture = Gesture.Pan()
    .enabled(!ambient && sheet === null && !lyricsFullscreen)
    .activeOffsetY(-12)
    .failOffsetX([-24, 24])
    .onTouchesDown((event, state) => {
      'worklet';
      const y = event.allTouches[0]?.y ?? 0;
      if (sheetY.value < 1 || upNextShown.value || (showLyricsSV.value && y > lyricsTop && y < frameH.value - CONTROLS_CLEARANCE)) state.fail();
    })
    .onStart(() => { 'worklet'; reverseActive.value = true; grabY.value = beginSheetDrag(sheetControls); })
    .onUpdate(event => {
      'worklet';
      const y = grabY.value + event.translationY;
      sheetY.value = y >= 0 ? Math.min(y, restY) : rubberBand(y, 120);
    })
    .onEnd(event => { 'worklet'; settleSheet(sheetControls, event.velocityY); })
    .onFinalize((_event, success) => {
      'worklet';
      if (!success && reverseActive.value) settleSheet(sheetControls, 0);
      reverseActive.value = false;
    });

  const playerGesture = Gesture.Race(dismissGesture, reverseGesture, lyricsUpGesture, lyricsDownGesture);

  // The sheet ends at the bottom bar's top while it is closed and reaches the screen's bottom once
  // open, the bar sliding down under that edge (useTabBarPushStyle) — the bar never pops out from
  // under a sheet that covered it. The clip moves up by the gap and the sheet down by it, so the
  // sheet stays where it was and only its bottom edge is cut. Transforms only.
  const barTop = pillNav ? shellNavHeight(windowH, insets.bottom, fontScale) : tabBarTopFromBottom(insets.bottom, pillNav);
  const sheetClipStyle = useAnimatedStyle(() => ({ transform: [{ translateY: reduceMotion ? 0 : -(1 - progress.value) * barTop }] }));
  // Echo Music's sheet: one full-width sheet that slides with the finger from
  // the mini player's top edge. It is solid from the first point of travel;
  // the pill fades off its top over the first quarter (PillPlayer), and the
  // player itself fades in between 15% and 40%, so the two never overlap. Its
  // top corners round off while it moves and square up once it is open.
  const sheetStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      opacity: reduceMotion ? p : 1,
      transform: [{ translateY: reduceMotion ? 0 : sheetY.value + (1 - p) * barTop }] as const,
    };
  });
  // Tap and drag share the same artwork handoff for card, full-cover and hero layouts.
  const coverLanding = useSettingsStore(s => (!isCardPlayerBackground(s.playerBackground) && s.appleMusicInspired ? 'hero' : isCoverFull(s.playerBackground, s.appleMusicInspired, s.playerCoverFull) ? 'full' : 'card'));
  const movingCover = !reduceMotion && playerCoverFrom.value.width > 0;
  const miniSurfaceStyle = useAnimatedStyle(() => ({ opacity: 1 - playerContentOpacity(progress.value) }));
  // The rising surface's glass: a soft sheen from its top edge and a hairline rim, gone once the player has arrived.
  const sheenStyle = useAnimatedStyle(() => ({ opacity: reduceMotion ? 0 : 1 - Math.min(1, Math.max(0, (progress.value - 0.3) / 0.45)) }));
  const playerFadeStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : movingCover ? playerContentOpacity(progress.value) : interpolate(progress.value, [0.15, 0.4], [0, 1], Extrapolation.CLAMP),
  }));
  const landingRect = coverLanding === 'hero'
    ? heroCoverRect(windowW, playerHeroHeight(windowW, screenH))
    : coverLanding === 'full' ? heroCoverRect(windowW, fullCoverHeight(windowW, screenH)) : cardCoverRect(windowW, screenH, insets.top + HEADER_CLEARANCE + 24);
  // The page underneath dims on Echo's curve: nothing for the first tenth, then fast, then easing off.
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: (reduceMotion ? 0 : PAGE_DIM) * Math.min(1, 1.4 * Math.sqrt(Math.max(0, progress.value - 0.1))),
  }));

  // Settings → Playback → Keep screen on: only while this screen is open.
  const keepScreenOn = useSettingsStore(s => s.keepScreenOn);
  useFocusEffect(
    React.useCallback(() => {
      if (!keepScreenOn) return undefined;
      activateKeepAwakeAsync('now-playing').catch(() => {});
      return () => { deactivateKeepAwake('now-playing').catch(() => {}); };
    }, [keepScreenOn])
  );

  useFocusEffect(
    React.useCallback(() => {
      setMiniPlayerHiddenSource('NowPlaying', true);
      return () => {
        setMiniPlayerHiddenSource('NowPlaying', false);
      };
    }, [setMiniPlayerHiddenSource])
  );

  const {
    currentSong,
    isCurrentSongLiked,
    isCurrentSongSaving,
    showCoverSearch,
    setShowCoverSearch,
    controlsVisible,
    animatedStyle,
    showLyrics,
    setShowLyrics,
    processedLyrics,
    flatListRef,
    togglePlay,
    skipForward,
    skipBackward,
    handleScrub,
    handleLyricTap,
    gradientColors,
    updateCurrentSong,
    addRecentArt,
    storePlaying,
    toggleLike,
    isUserScrolling,
    scrollTimeoutRef,
  } = useNowPlayingLogic(songId, route.params.lyrics === true);
  const nativeSkip = useNativeSkip();

  // With the lyrics hidden there is nothing to scroll, so a drag always dismisses.
  useEffect(() => {
    showLyricsSV.value = showLyrics;
    if (!showLyrics) lyricsOffset.value = 0;
  }, [showLyrics, lyricsOffset, showLyricsSV]);

  // Cover <-> lyrics as one motion: the cover (or record) flies down into the
  // thumbnail at the start of the title while the lines rise in, and back.
  // `dock` is the thumbnail's centre in the player, measured by the controls.
  const lyricsP = useSharedValue(showLyrics ? 1 : 0);
  const dockX = useSharedValue(0);
  const dockY = useSharedValue(0);
  // The thumbnail's centre as plain numbers: the moving cover (CoverGhost) takes a rectangle prop, and under
  // lyrics the cover lives in that thumbnail, so it must fly there and not to the big cover.
  const [dockCenter, setDockCenter] = useState({ x: 0, y: 0 });
  useAnimatedReaction(
    () => dockY.value,
    y => { if (y > 0) runOnJS(setDockCenter)({ x: dockX.value, y }); },
    [dockX, dockY],
  );
  useEffect(() => {
    const target = showLyrics || lyricsFullscreen ? 1 : 0;
    // Fullscreen rides the same cover -> lyrics morph (opacity only under Reduce Motion).
    lyricsP.value = reduceMotion
      ? target
      : withTiming(target, { duration: LYRICS_MORPH_MS, easing: Easing.bezier(0.32, 0.72, 0, 1) });
  }, [showLyrics, lyricsFullscreen, reduceMotion, lyricsP]);

  const canvas = useCanvasArtwork(currentSong);

  // ── The cover stage ──────────────────────────────────────────────────────
  // YouTube Music's cover gestures: tap it to go full-bleed (or back to a
  // card), double-tap the left or right half for 5 seconds back or on, swipe
  // it sideways for the previous or next song (it follows the finger, then the
  // new cover arrives from the other side). Off under lyrics, ambient mode,
  // sheets and Up next (where a tap on the cover just lowers the panel).
  const stageX = useSharedValue(0);
  const [swipePreview, setSwipePreview] = useState<Song | null>(null);
  const [swipeSource, setSwipeSource] = useState<Song | null>(null);
  const swipePreviewRef = useRef<Song | null>(null);
  const swipePreviewShown = useSharedValue(false);
  const swipePreviewAvailable = useSharedValue(false);
  const swipeDirectionRef = useRef<1 | -1>(-1);
  const [swipeSettled, setSwipeSettled] = useState(false);
  const swipePreviewTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageEnabled = !showLyrics && !ambient && sheet === null && !upNextOpen && !lyricsFullscreen;

  const clearSwipePreview = useCallback(() => {
    if (swipePreviewTimeout.current) clearTimeout(swipePreviewTimeout.current);
    swipePreviewTimeout.current = null;
    swipePreviewRef.current = null;
    swipePreviewShown.value = false;
    swipePreviewAvailable.value = false;
    setSwipePreview(null);
    setSwipeSource(null);
    setSwipeSettled(false);
  }, [swipePreviewShown, swipePreviewAvailable]);
  useEffect(() => () => {
    if (swipePreviewTimeout.current) clearTimeout(swipePreviewTimeout.current);
  }, []);

  const adjacentSong = useCallback((dir: 1 | -1): Song | null => {
    const { playlistQueue, currentQueueIndex } = usePlayerStore.getState();
    if (!playlistQueue || playlistQueue.length < 2 || currentQueueIndex < 0) return null;
    const repeat = usePlaybackModesStore.getState().repeatMode;
    const index = dir < 0
      ? nextSwipeIndex(playlistQueue.length, currentQueueIndex)
      : (() => {
        const action = previousSwipeAction(playerControls.getPosition(), playlistQueue.length, currentQueueIndex, repeat);
        return action?.kind === 'back' ? action.index : null;
      })();
    if (index === null) return null;
    return playlistQueue[index] ?? null;
  }, []);

  const previewAdjacentSong = useCallback((dir: 1 | -1) => {
    const song = adjacentSong(dir);
    if (!song) return;
    swipeDirectionRef.current = dir;
    swipePreviewRef.current = song;
    swipePreviewShown.value = true;
    swipePreviewAvailable.value = true;
    setSwipeSettled(false);
    setSwipePreview(song);
    setSwipeSource(usePlayerStore.getState().currentSong);
    prefetchCover(song.coverImageUri);
  }, [adjacentSong, swipePreviewShown, swipePreviewAvailable]);

  const settleSwipePreview = useCallback(() => {
    if (!swipePreviewRef.current) return;
    setSwipeSettled(true);
    if (swipePreviewTimeout.current) clearTimeout(swipePreviewTimeout.current);
    swipePreviewTimeout.current = setTimeout(() => {
      clearSwipePreview();
      stageX.value = withSpring(0, SETTLE_SPRING);
    }, 2600);
  }, [clearSwipePreview, stageX]);

  // Android may report the new current item before the outgoing cover has reached its edge. Hold the preview
  // through that travel, then let the real artwork settle from a short opposite offset instead of popping.
  useEffect(() => {
    if (!swipePreview || !swipeSettled || currentSong?.id !== swipePreview.id) return;
    if (swipePreviewTimeout.current) clearTimeout(swipePreviewTimeout.current);
    swipePreviewTimeout.current = null;
    const dir = swipeDirectionRef.current;
    clearSwipePreview();
    stageX.value = -dir * windowW * 0.12;
    stageX.value = withSpring(0, SOFT_SPRING);
  }, [swipePreview, swipeSettled, currentSong?.id, clearSwipePreview, stageX, windowW]);

  const toggleCover = useCallback(() => {
    if (upNextRef.current) {
      closeUpNext(0);
      return;
    }
    Haptics.selectionAsync().catch(() => {});
    const s = useSettingsStore.getState();
    const full = isCoverFull(s.playerBackground, s.appleMusicInspired, s.playerCoverFull);
    diag('player', `tap: cover ${full ? 'full -> card' : 'card -> full'}`);
    if (isCardPlayerBackground(s.playerBackground)) s.setPlayerCoverFull(!full);
    else s.setAppleMusicInspired(!full);
  }, [closeUpNext]);

  // Double-taps in a row on the same side add up, as on YouTube: 5, 10, 15…
  const [seekPulse, setSeekPulse] = useState<SeekPulse | null>(null);
  const seekRun = useRef<{ side: -1 | 1; seconds: number; at: number }>({ side: 1, seconds: 0, at: 0 });
  const seekBy = useCallback((x: number) => {
    const side = seekSide(x, windowW);
    const now = Date.now();
    const run = seekRun.current;
    const seconds = run.side === side && now - run.at < 900 ? run.seconds + SEEK_STEP_S : SEEK_STEP_S;
    seekRun.current = { side, seconds, at: now };
    const target = seekTarget(positionSV.value, durationSV.value, side * SEEK_STEP_S);
    diag('player', `double tap ${side < 0 ? 'left' : 'right'}: ${positionSV.value.toFixed(1)}s -> ${target.toFixed(1)}s`);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSeekPulse(p => ({ side, seconds, n: (p?.n ?? 0) + 1 }));
    // The bar jumps at once; handleScrub resumes playback if it was playing.
    isSeeking.value = true;
    positionSV.value = target;
    Promise.resolve(handleScrub(target)).finally(() => {
      setTimeout(() => { isSeeking.value = false; }, 280);
    });
  }, [windowW, handleScrub]);

  /** Whether a swipe in `dir` has a song to go to (-1 next, 1 previous). */
  const canSwipe = useCallback((dir: 1 | -1): boolean => {
    const player = usePlayerStore.getState();
    const queued = player.playlistQueue?.length ?? 0;
    if (dir < 0) return Boolean(adjacentSong(dir)) || player.currentPlaylistId === 'library';
    if (player.playlistQueue && player.currentQueueIndex >= 0) {
      return previousSwipeAction(
        playerControls.getPosition(),
        player.playlistQueue.length,
        player.currentQueueIndex,
        usePlaybackModesStore.getState().repeatMode,
      ) !== null;
    }
    return queued > 0 || player.currentPlaylistId === 'library';
  }, [adjacentSong]);

  /** The direction the cover is being pulled with nothing there (0 when it can go): it stretches instead of following. */
  const swipeBlocked = useSharedValue(0);
  const swipeRefused = useSharedValue(false);
  const noteSwipeDirection = useCallback((dir: 1 | -1) => {
    swipeBlocked.value = canSwipe(dir) ? 0 : dir;
    previewAdjacentSong(dir);
  }, [canSwipe, previewAdjacentSong, swipeBlocked]);
  const refuseSwipe = useCallback(() => Haptics.refuse(), []);

  // dir: -1 = swiped left (next song), 1 = swiped right (previous). `velocity` is the finger's (px/s) at release.
  const swipeSong = useCallback((dir: 1 | -1, velocity: number) => {
    const player = usePlayerStore.getState();
    const preview = adjacentSong(dir);
    const canSkip = canSwipe(dir);
    diag('player', `cover swipe ${dir < 0 ? 'left (next)' : 'right (previous)'}: ${canSkip ? 'skipping' : 'nothing to skip to'}`);
    if (!canSkip) {
      // Nothing to go to: the stretched cover eases home. The refusal was felt while pulling.
      clearSwipePreview();
      stageX.value = withSpring(0, SETTLE_SPRING);
      return;
    }
    if (preview && swipePreviewRef.current?.id !== preview.id) previewAdjacentSong(dir);
    Haptics.commit();
    if (dir < 0) {
      skipForward().catch(() => {});
    } else {
      const action = player.playlistQueue
        ? previousSwipeAction(
          playerControls.getPosition(),
          player.playlistQueue.length,
          player.currentQueueIndex,
          usePlaybackModesStore.getState().repeatMode,
        )
        : null;
      if (action?.kind === 'restart') {
        setSeekPulse(p => ({ side: -1, seconds: 0, n: (p?.n ?? 0) + 1 }));
        skipBackward().catch(() => {});
      } else if (action?.kind === 'back') {
        player.skipToQueueIndex(action.index);
      } else {
        skipBackward().catch(() => {});
      }
    }
    // Off the edge at the finger's speed: a spring that starts where the flick was going, never an ease-in from rest.
    const outward = dir * Math.max(0, dir * velocity);
    stageX.value = withSpring(dir * windowW, { ...FLING_SPRING, velocity: outward }, done => {
      'worklet';
      if (!done) return;
      if (swipePreviewAvailable.value) runOnJS(settleSwipePreview)();
      else {
        stageX.value = -dir * windowW;
        stageX.value = withSpring(0, SOFT_SPRING);
      }
    });
  }, [skipBackward, skipForward, stageX, windowW, adjacentSong, canSwipe, clearSwipePreview, previewAdjacentSong, settleSwipePreview, swipePreviewAvailable]);

  const stagePan = Gesture.Pan()
    .enabled(stageEnabled)
    .activeOffsetX([-14, 14])
    .failOffsetY([-16, 16])
    .onStart(() => {
      'worklet';
      swipePreviewShown.value = false;
      swipePreviewAvailable.value = false;
      swipeBlocked.value = 0;
      swipeRefused.value = false;
    })
    .onUpdate(e => {
      'worklet';
      const dir = e.translationX < 0 ? -1 : 1;
      // Toward a song that isn't there the cover gives a little and resists, instead of following 1:1.
      const blocked = swipeBlocked.value === dir;
      stageX.value = blocked ? rubberBand(e.translationX, 120) : e.translationX;
      if (blocked && !swipeRefused.value && Math.abs(stageX.value) > 24) {
        swipeRefused.value = true;
        runOnJS(refuseSwipe)();
      }
      if (Math.abs(e.translationX) > 12 && !swipePreviewShown.value) {
        swipePreviewShown.value = true;
        runOnJS(noteSwipeDirection)(dir);
      }
    })
    .onEnd(e => {
      'worklet';
      const projected = e.translationX + e.velocityX * 0.12;
      const dir = projected < 0 ? -1 : 1;
      if (Math.abs(projected) > windowW * 0.26 && swipeBlocked.value !== dir) runOnJS(swipeSong)(dir, e.velocityX);
      else {
        stageX.value = withSpring(0, SETTLE_SPRING);
        runOnJS(clearSwipePreview)();
      }
    })
    .onFinalize((_e, success) => {
      'worklet';
      if (!success) {
        stageX.value = withSpring(0, SETTLE_SPRING);
        runOnJS(clearSwipePreview)();
      }
    });
  const stageDoubleTap = Gesture.Tap()
    .enabled(stageEnabled)
    .numberOfTaps(2)
    .maxDelay(280)
    .onEnd((e, success) => {
      'worklet';
      if (success) runOnJS(seekBy)(e.x);
    });
  // Waits for the double-tap to fail, so a single tap lands ~280ms late —
  // the price of having both, as on YouTube.
  const stageTap = Gesture.Tap()
    .enabled(stageEnabled || upNextOpen)
    .maxDuration(400)
    .onEnd((_e, success) => {
      'worklet';
      if (success) runOnJS(toggleCover)();
    });
  const stageGesture = Gesture.Race(stagePan, Gesture.Exclusive(stageDoubleTap, stageTap));

  // Tap the artist line to open their page (YouTube Music, Echo style).
  const artistName = currentSong?.artist;
  const openArtist = React.useMemo(() => {
    if (!artistName || /^unknown artist$/i.test(artistName)) return undefined;
    return () => {
      // First credited artist ("A, B & C" → "A") — that's whose page to open.
      afterClose.current = { kind: 'artist', name: artistName.split(/,|&| feat\.? | ft\.? | x /i)[0]?.trim() || artistName };
      animateClose(0);
    };
  }, [artistName, animateClose]);

  const openAlbum = useCallback(() => {
    if (!currentSong) return;
    const origin = currentSong.originId;
    const ref = fromMobileId(currentSong.id) ?? (origin && parseSongRef(origin) ? origin : undefined);
    afterClose.current = { kind: 'album', params: { songRef: ref, album: currentSong.album, title: currentSong.title, artist: currentSong.artist } };
    animateClose(0);
  }, [currentSong, animateClose]);

  // A link can arrive while the player is already open (lyricflow://play?…&lyrics=1,
  // lyricflow://player?sheet=menu, an invite): apply it instead of ignoring it.
  const linkLyrics = route.params.lyrics;
  const linkSheet = route.params.sheet;
  useEffect(() => {
    if (linkLyrics) setShowLyrics(true);
  }, [linkLyrics, route.params.songId, setShowLyrics]);
  useEffect(() => {
    if (linkSheet === 'queue') openUpNext(0);
    else if (linkSheet) setSheet(linkSheet);
  }, [linkSheet, openUpNext]);
  const closeSheet = useCallback(() => setSheet(null), []);
  const songActions = useSongActions();
  const enterLyricsFullscreen = useCallback(() => {
    setShowLyrics(true);
    setLyricsFullscreen(true);
  }, [setShowLyrics]);
  openLyricsFullscreenRef.current = enterLyricsFullscreen;
  // Leaving goes back to the cover, not to the regular lyrics view.
  exitLyricsFullscreenRef.current = () => {
    setLyricsFullscreen(false);
    setShowLyrics(false);
  };

  // The sleep timer's remaining time, refreshed while it runs.
  const sleepEndsAt = useSleepTimerStore(s => s.endsAt);
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!sleepEndsAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [sleepEndsAt]);
  const sleepText = sleepEndsAt ? sleepLabel(sleepEndsAt, now) : null;

  // What the ••• menu's actions report, as a toast.
  const [notice, setNotice] = useState<string | null>(null);
  const say = useCallback((text: string) => setNotice(text), []);

  // The heart: fills at once, and says where the song went. A streamed song is
  // saved into the library first (isCurrentSongSaving), then lands in Liked songs.
  // What the lyrics picker searches for: one object per song, so the search runs once per opening.
  const pickerTarget = React.useMemo(
    () => ({
      title: currentSong?.title ?? '',
      artist: currentSong?.artist ?? '',
      duration: currentSong?.duration ?? 0,
      album: currentSong?.album,
      ref: currentSong?.originId && parseSongRef(currentSong.originId)
        ? currentSong.originId
        : fromMobileId(currentSong?.id ?? '') ?? undefined,
    }),
    [currentSong?.title, currentSong?.artist, currentSong?.duration, currentSong?.id, currentSong?.album, currentSong?.originId],
  );

  const onToggleLike = useCallback(async () => {
    if (!currentSong) return;
    const result = await toggleLike(currentSong.id);
    say(
      result === 'liked' ? 'Added to Liked songs'
        : result === 'unliked' ? 'Removed from Liked songs'
        : result === 'saving' ? 'Saving to Liked songs…'
        : 'Couldn’t update Liked songs',
    );
  }, [currentSong, toggleLike, say]);
  const repeatOne = usePlaybackModesStore(s => s.repeatOne);
  const setRepeatOne = usePlaybackModesStore(s => s.setRepeatOne);
  const roomOpen = useLuvLinkStore(s => s.room !== null);
  const listeners = useLuvLinkStore(s => s.room?.users.length ?? 0);
  const connect = useConnect();
  const openConnectDevices = connect.openDevices;

  const onMenuAction = useCallback(async (action: PlayerMenuAction) => {
    const song = currentSong;
    if (!song) return;
    const stream = isStreamSongId(song.id);
    switch (action) {
      case 'radio': {
        setSheet(null);
        say('Starting a radio from this song…');
        const n = await StreamService.startRadio(song);
        say(n > 0 ? `Radio on — ${n} songs up next` : 'Couldn’t find a radio for this song');
        return;
      }
      case 'add':
        setSheet(null);
        if (stream) say(StreamService.save(song.id) ? 'Downloading — once it’s saved you can add it to a playlist' : 'Couldn’t save this song');
        else navigation.navigate('AddToPlaylist', { songId: song.id });
        return;
      case 'share':
        shareSong(song);
        return;
      case 'cast':
        setSheet(null);
        if (!NativeAudioPlayer.openOutputSwitcher()) say('No other devices found');
        return;
      case 'ambient':
        setSheet(null);
        setAmbient(true);
        return;
      case 'lyrics':
        setSheet(null);
        setLyricsFullscreen(false);
        setShowLyrics(!showLyrics);
        return;
      case 'shuffle':
        setSheet(null);
        say(shuffleUpcoming() > 0 ? 'Shuffled what plays next' : 'Nothing queued to shuffle');
        return;
      case 'download':
        setSheet(null);
        say(StreamService.save(song.id) ? 'Downloading to your library' : 'Couldn’t download this song');
        return;
      case 'like':
        onToggleLike();
        return;
      case 'repeat':
        setRepeatOne(!repeatOne);
        say(repeatOne ? 'Repeat off' : 'Repeating this song');
        return;
      case 'refetch': {
        setSheet(null);
        say('Loading the song again…');
        const ok = await refetchCurrent();
        say(ok ? 'Reloaded' : 'Couldn’t reload the song');
        return;
      }
      case 'artist':
        setSheet(null);
        openArtist?.();
        return;
      case 'ringtone':
        setSheet(null);
        say(await setAsRingtone(song));
        return;
      case 'together':
        setSheet('together');
        return;
      case 'connect':
        setSheet(null);
        openConnectDevices();
        return;
      case 'details':
        setSheet('details');
        return;
      case 'equalizer':
        setSheet(null);
        if (!NativeAudioPlayer.openEqualizer()) say('No equalizer on this phone');
        return;
      case 'advanced':
        setSheet('advanced');
        return;
    }
  }, [currentSong, navigation, say, showLyrics, setShowLyrics, onToggleLike, repeatOne, setRepeatOne, openArtist, openConnectDevices]);

  // The ••• button, the deep link and the mini player all open the app's one song sheet (owner, 2026-11-13).
  const answerPlayer = useCallback((request: PlayerRequest) => {
    if ('sheet' in request) {
      if (request.sheet === 'queue') openUpNext(0);
      else setSheet('timer');
    } else if (request.action === 'lyrics') setSheet('lyrics');
    else void onMenuAction(request.action);
  }, [onMenuAction, openUpNext]);
  useEffect(() => {
    if (sheet !== 'menu') return;
    setSheet(null);
    if (currentSong) songActions.open(currentSong, { current: true, onPlayer: answerPlayer });
    // songActions.open is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, currentSong, answerPlayer]);

  const appliedMenuAction = useRef(false);
  useEffect(() => {
    if (!route.params.action || !currentSong || appliedMenuAction.current) return;
    appliedMenuAction.current = true;
    if (route.params.action === 'lyrics') setSheet('lyrics');
    else void onMenuAction(route.params.action);
  }, [route.params.action, currentSong, onMenuAction]);

  const handleCoverSelect = useCallback(async (uri: string) => {
    setShowCoverSearch(false);
    if (currentSong) {
      const updatedSong = { ...currentSong, coverImageUri: uri };
      updateCurrentSong({ coverImageUri: uri });
      try {
        const queries = await import('../database/queries');
        await queries.updateSong(updatedSong);
        addRecentArt(uri);
      } catch (e) {
        if (__DEV__) console.error('[NowPlaying] Failed to save cover:', e);
      }
    }
  }, [currentSong, updateCurrentSong, addRecentArt, setShowCoverSearch]);

  // Up next: the cover (or lyrics) steps back and the room darkens a little
  // so the lifted title reads over it.
  const stageBackStyle = useAnimatedStyle(() => ({ opacity: 1 - 0.75 * upNext.value }));
  const upNextShadeStyle = useAnimatedStyle(() => ({ opacity: upNext.value }));
  // With lyrics up (regular or fullscreen) the cover is the title's thumbnail, so the sheet's cover lands there.
  const ghostOnDock = (showLyrics || lyricsFullscreen) && dockCenter.y > 0;
  const dockRect = { x: dockCenter.x - DOCK_THUMB / 2, y: dockCenter.y - DOCK_THUMB / 2, width: DOCK_THUMB, height: DOCK_THUMB };

  return (
    <View style={styles.root}>
      <StatusBar hidden={false} animated />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      <Animated.View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.sheetClip, sheetClipStyle]}>
      <GestureDetector gesture={playerGesture}>
      <Animated.View
        style={[styles.container, sheetStyle]}
        onLayout={e => {
          const h = e.nativeEvent.layout.height;
          frameH.value = h;
          if (h > 0) setFrameHeight(h);
        }}
      >
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, miniSurfaceStyle]}><MiniPlayerGlow uri={currentSong?.coverImageUri} active={false} /></Animated.View>
        <Animated.View pointerEvents="none" style={[styles.surfaceSheen, sheenStyle]}>
          <LinearGradient colors={Glass.sheen} style={StyleSheet.absoluteFill} />
          <View style={styles.surfaceRim} />
        </Animated.View>
        <Animated.View style={[styles.playerLayer, playerFadeStyle]}>
        <NowPlayingBackground
          coverImageUri={swipeSource?.coverImageUri ?? currentSong?.coverImageUri}
          incomingCoverImageUri={swipePreview?.coverImageUri}
          gradientColors={gradientColors}
          showLyrics={showLyrics}
          canvas={ambient || swipePreview ? null : canvas}
          playing={storePlaying}
          shift={stageX}
        />

        {!lyricsFullscreen ? (
          <NowPlayingHeader
            animatedStyle={animatedStyle}
            controlsVisible={controlsVisible}
            onGoBack={() => animateClose(0)}
            together={roomOpen ? listeners : null}
            onTogetherPress={() => setSheet('together')}
          />
        ) : null}

        {/* Built when asked for (Details → Change cover), not on every open of the player. */}
        {showCoverSearch ? (
          <CoverArtSearchScreen
            visible
            initialQuery={`${currentSong?.title} ${currentSong?.artist}`}
            onClose={() => setShowCoverSearch(false)}
            onSelect={handleCoverSelect}
          />
        ) : null}

        <Animated.View style={[styles.contentArea, stageBackStyle]}>
          <NowPlayingLyricsArea
            transitionProgress={movingCover ? progress : undefined}
            showLyrics={showLyrics}
            processedLyrics={processedLyrics}
            lyricSource={currentSong?.lyricSource}
            currentTime={positionSV}
            onLyricPress={handleLyricTap}
            songTitle={swipePreview?.title ?? currentSong?.title}
            isUserScrollingRef={isUserScrolling}
            scrollTimeoutRef={scrollTimeoutRef}
            flatListRef={flatListRef}
            coverImageUri={swipeSource?.coverImageUri ?? currentSong?.coverImageUri}
            songArtist={currentSong?.artist}
            scrollOffset={lyricsOffset}
            stageX={stageX}
            lyricsP={lyricsP}
            dockX={dockX}
            dockY={dockY}
            fullscreen={lyricsFullscreen}
            localClock
            songId={currentSong?.id}
          />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, upNextShadeStyle]}>
          {/* Deep enough that the lifted title and transport read over a bright cover. */}
          <LinearGradient colors={['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.62)', 'rgba(0,0,0,0.72)']} style={StyleSheet.absoluteFill} />
        </Animated.View>

        {/* Above the cover, below the controls: tap for full-bleed, double-tap a side to seek, swipe sideways to skip. */}
        <GestureDetector gesture={stageGesture}>
          <View
            style={[styles.stageZone, { height: Math.round(screenH * 0.56) }]}
            pointerEvents={stageEnabled || upNextOpen ? 'auto' : 'none'}
            collapsable={false}
          />
        </GestureDetector>
        <SeekRipple pulse={seekPulse} width={windowW} height={Math.round(screenH * 0.56)} />

        <PlaybackFailureNotice width={windowW} height={screenH} hidden={showLyrics || upNextOpen} onRetry={() => usePlayerStore.getState().requestPlayback(true)} />
        <NowPlayingControls
          animatedStyle={animatedStyle}
          controlsVisible={controlsVisible}
          storePlaying={storePlaying}
          currentSongTitle={swipePreview?.title ?? currentSong?.title}
          currentSongArtist={swipePreview?.artist ?? currentSong?.artist}
          songId={swipePreview?.id ?? currentSong?.id}
          isCurrentSongLiked={isCurrentSongLiked}
          isLikeSaving={isCurrentSongSaving}
          onRetry={() => usePlayerStore.getState().requestPlayback(true)}
          onTogglePlay={togglePlay}
          onSkipForward={skipForward}
          onSkipBackward={skipBackward}
          nativeSkip={nativeSkip}
          onToggleLike={onToggleLike}
          onToggleLyrics={() => {
            // From fullscreen the lyrics button goes back to the cover in one step.
            if (lyricsFullscreen) setLyricsFullscreen(false);
            setShowLyrics(!showLyrics);
          }}
          onLyricsLongPress={() => setSheet('lyrics')}
          onHighlightSwitched={h => say(h === 'letters' ? 'Lyrics light up letter by letter' : 'Lyrics light up line by line')}
          positionSV={positionSV}
          durationSV={durationSV}
          onSeek={handleScrub}
          localSongId={currentSong?.id}
          showLyrics={showLyrics}
          compact={showLyrics}
          lyricsFullscreen={lyricsFullscreen}
          onExitLyricsFullscreen={exitLyricsFullscreen}
          onEnterLyricsFullscreen={enterLyricsFullscreen}
          coverImageUri={currentSong?.coverImageUri}
          lyricsP={lyricsP}
          dockX={dockX}
          dockY={dockY}
          onMorePress={() => setSheet('menu')}
          onOpenQueue={() => openUpNext(0)}
          onOpenTimer={() => setSheet('timer')}
          sleepLabel={sleepText}
          onArtistPress={openArtist}
          onAlbumPress={openAlbum}
          upNext={upNext}
          upNextTop={upNextTop}
          upNextOpen={upNextOpen}
        />

        {upNextMounted ? (
          <UpNextPanel progress={upNext} top={upNextTop} frameH={frameHeight} open={upNextOpen} onClose={closeUpNext} onNotice={say} />
        ) : null}

        <PlayerSheet visible={sheet === 'timer'} title="Sleep timer" onClose={closeSheet}>
          <SleepTimerList onPicked={closeSheet} />
        </PlayerSheet>
        {songActions.element}
        <PlayerSheet visible={sheet === 'details'} title="Details" onClose={closeSheet}>
          {currentSong ? (
            <SongDetails
              song={currentSong}
              onEditLyrics={() => { closeSheet(); navigation.navigate('EditLyrics', { songId: currentSong.id }); }}
              onChangeCover={() => { closeSheet(); setShowCoverSearch(true); }}
            />
          ) : null}
        </PlayerSheet>
        <PlayerSheet visible={sheet === 'advanced'} title="Tempo and pitch" onClose={closeSheet}>
          <TempoPitch />
        </PlayerSheet>
        <PlayerSheet visible={sheet === 'lyrics'} title="Lyrics" tall onClose={closeSheet}>
          {currentSong && sheet === 'lyrics' ? (
            <LyricsPicker
              target={pickerTarget}
              currentSource={currentSong.lyricSource}
              onDone={(message, used) => {
                closeSheet();
                if (used) setShowLyrics(true);
                say(message);
              }}
            />
          ) : null}
        </PlayerSheet>
        <PlayerSheet visible={sheet === 'together'} title="LuvLink" tall onClose={closeSheet}>
          <LuvLinkPanel />
        </PlayerSheet>

        {ambient && currentSong ? (
          <AmbientMode song={currentSong} canvas={canvas} playing={storePlaying} onExit={() => setAmbient(false)} />
        ) : null}

        <Toast visible={notice !== null} message={notice ?? ''} type="info" onDismiss={() => setNotice(null)} duration={2600} />
        </Animated.View>
      </Animated.View>
      </GestureDetector>
      </Animated.View>
      {movingCover && currentSong ? (
        <CoverGhost
          progress={progress}
          to={ghostOnDock ? dockRect : landingRect}
          toRadius={ghostOnDock ? Radius.thumb : coverLanding === 'card' ? Radius.panel : 0}
          fadeOut={!ghostOnDock && coverLanding !== 'card'}
          uri={currentSong.coverImageUri}
          title={currentSong.title}
          artist={currentSong.artist}
        />
      ) : null}
    </View>
  );
};

const NowPlayingScreen: React.FC<Props> = (props) => {
  const connect = useConnect();
  const fromConnect = Boolean(parseSongRef(props.route.params.songId));
  const openedOpen = props.route.params.instant === true;
  // Both local and Connect players acknowledge only once their first frame has been drawn.
  useEffect(() => openedOpen ? notifyIslandAppShownAfterDraw() : undefined, [openedOpen]);
  return connect.remotePlayback || fromConnect
    ? <ConnectRemotePlayer {...props} />
    : <LocalNowPlayingScreen {...props} />;
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    backgroundColor: '#000',
  },
  sheetClip: {
    overflow: 'hidden',
  },
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
    overflow: 'hidden',
    // The mini player's outline (navigation/miniShell): the close lands on exactly the pill's shape.
    borderTopLeftRadius: SHEET_TOP_RADIUS,
    borderTopRightRadius: SHEET_TOP_RADIUS,
  },
  surfaceSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 240,
  },
  surfaceRim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: Glass.sheenRim,
  },
  playerLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  contentArea: {
    flex: 1,
  },
  // Catches swipes and double-taps on the cover; the transport sits above it.
  stageZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});

export default NowPlayingScreen;
