import { seekTargetForGesture } from '../playback/seekTarget';
import { NativePlaybackControl as PlaybackButton } from './NativePlaybackControl';
/**
 * V6 mini player: a thin progress line on a separate seek band, a square cover and stable transport.
 * Sideways on the cover and title skips (left: next, right: previous) through the owner's onNext/onPrevious, so
 * local playback, Connect and LuvLink keep deciding what a skip means. Up opens the player; a tap opens it too.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Dimensions, I18nManager, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardVisible } from '../hooks/useKeyboardVisible';
import { usePlaybackStatus } from '../hooks/usePlaybackStatus';
import { playerCoverFrom, playerDrag, playerSheetProgress, createSheetProgress } from '../navigation/sheetProgress';
import { miniContentOpacity } from '../navigation/playerTransition';
import { useSettingsStore } from '../store/settingsStore';
import { MINI_COVER_SIZE, SEEK_BAND_HEIGHT, miniRowHeight, shellNavHeight } from '../navigation/v6Shell';
import { MINI_CONTENT_SIDE_INSET, MINI_PLAY_OFFSET, MINI_ROW_PADDING_RIGHT, miniShellOutline } from '../navigation/miniShell';
import { miniPlayerLabel } from '../playback/miniPlayerLabel';
import { miniSwipe, swipeFollow } from '../playback/miniSwipe';
import { durationSV, positionSV } from '../playback/positionBus';
import { usePlayerStore } from '../store/playerStore';
import { usePositionStore } from '../store/positionStore';
import { Control, Motion, Radius, Signal, Space, Surface, Tactile, Text, Typography } from '../ui';
import Marquee from './allegra/Marquee';
import Artwork from './allegra/Artwork';
import { MiniPlayerGlow } from './MiniPlayerGlow';
import { MiniScrubber } from './MiniScrubber';
import { NativeSwipeSkip, useNativeSwipeSkip } from './NativeSwipeSkip';
import { useShellMenuStore } from '../store/shellMenuStore';
import { scrubSeconds, spokenPosition } from '../playback/miniScrub';
import { ShellFrost } from '../constants/allegraTheme';

interface Props {
  title: string; artist?: string; coverImageUri?: string; playing: boolean; bottom: number; sheetUp?: boolean;
  onOpen: (velocity?: number) => void;
  /** Fluid player: open the sheet under a finger that is still dragging. */
  onOpenTracking?: () => void;
  onTogglePlay: () => void; onNext: () => void; onPrevious: () => void;
  onSeek?: (time: number) => Promise<void>;
  onRetry?: () => void;
  remote?: boolean;
  /** Song actions, saved mark, then play. Each shows only when its owner passes it. */
  onMore?: () => void;
  liked?: boolean;
  onToggleLike?: () => void;
}

/** A skip that never lands (the queue's last song, a rejected remote command) gives the content back after this. */
const SKIP_SETTLE_MS = 1200;

const time = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
export default function PillPlayer({ title, artist, coverImageUri, playing, remote, sheetUp, onOpen, onOpenTracking, onTogglePlay, onNext, onPrevious, onSeek, onRetry, onMore, liked, onToggleLike }: Props) {
  const { height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const bottom = shellNavHeight(height, insets.bottom, fontScale);
  const localStatus = usePlaybackStatus();
  const status = remote ? (playing ? 'playing' : 'paused') : localStatus;
  const songId = usePlayerStore(s => s.currentSongId);
  const localDuration = usePositionStore(s => s.duration);
  const duration = remote ? 0 : localDuration;
  // Read only by the seek band's TalkBack value. The store ticks once a second, and each tick re-rendered the whole
  // pill (cover, marquee, glow, buttons) for a number nobody sees; five-second steps keep the spoken value close.
  const position = usePositionStore(s => spokenPosition(s.position));
  const loading = status === 'loading';
  /** 0..1 while the line is being scrubbed (1.41.0: on the UI thread, no React render per frame). */
  const scrubbing = useSharedValue(0);
  const [infoWidth, setInfoWidth] = useState(1);
  const keyboard = useKeyboardVisible();
  const seekGeneration = useRef(0);
  const track = useRef(songId); track.current = songId;
  const gestureSong = useRef(songId);
  // Fluid player (Settings, off by default): a drag up from here opens the sheet at once and the sheet follows the finger.
  const fluid = useSettingsStore(s => s.fluidPlayer) && !!onOpenTracking;
  const restY = Math.max(height, Dimensions.get('screen').height) - bottom - SEEK_BAND_HEIGHT - miniRowHeight(fontScale);
  // The pill stays drawn while the finger is down, even once the sheet is up: its drag is what moves the sheet.
  const [fingerDown, setFingerDown] = useState(false);
  useAnimatedReaction(() => playerDrag.tracking.value, (now, before) => { if (now !== before) runOnJS(setFingerDown)(now); });
  const coverRef = useRef<View>(null);
  const measureCover = (after?: () => void) => {
    coverRef.current?.measureInWindow((x, y, width, h) => {
      if (width > 0) playerCoverFrom.value = { x, y, width, height: h, radius: Radius.cover };
      after?.();
    });
  };
  const beginTracking = () => { measureCover(onOpenTracking); };
  const openMeasured = () => measureCover(() => onOpen());
  const enabled = !!onSeek && Number.isFinite(duration) && duration > 0 && !loading;
  useEffect(() => { seekGeneration.current++; gestureSong.current = songId; }, [songId, loading]);
  const commit = async (seconds: number, startedOn = track.current) => {
    if (!enabled || !track.current || !onSeek) return;
    const target = seekTargetForGesture(startedOn, track.current, seconds, duration, loading);
    if (target === null) return;
    ++seekGeneration.current;
    try { await onSeek(target); }
    catch { AccessibilityInfo.announceForAccessibility('Could not seek. Position restored.'); }
  };
  // The scrub started on this song; a skip mid-drag must not seek the next one (seekTargetForGesture refuses it).
  const commitFraction = async (fraction: number) => {
    const seconds = scrubSeconds(fraction, duration);
    if (seconds !== null) await commit(seconds, gestureSong.current);
  };
  const rowDim = useAnimatedStyle(() => ({ opacity: 1 - (1 - Control.disabledOpacity) * scrubbing.value }));

  // ── Sideways skip on the cover and title ───────────────────────────────
  const shift = useSharedValue(0);
  const fade = useSharedValue(1);
  const skipInFlight = useSharedValue(false);
  const [displayed, setDisplayed] = useState(() => ({ songId, title, artist, coverImageUri }));
  /** The song a committed swipe is waiting to leave; null when no skip is in flight. */
  const skipping = useRef<{ from: string; dir: -1 | 1; timer: ReturnType<typeof setTimeout>; swapTimer?: ReturnType<typeof setTimeout> } | null>(null);
  const settle = () => {
    skipInFlight.value = false;
    shift.value = withTiming(0, { duration: Motion.duration.fast, easing: Motion.ease.decelerate });
    fade.value = withTiming(1, { duration: Motion.duration.fast });
  };
  const cancelSkip = () => {
    if (skipping.current) {
      clearTimeout(skipping.current.timer);
      if (skipping.current.swapTimer) clearTimeout(skipping.current.swapTimer);
    }
    skipping.current = null;
  };
  // What is showing: a remote (Connect) song changes its title, not the local song id.
  const showing = `${songId ?? ''}|${title}`;
  const shownRef = useRef(showing); shownRef.current = showing;
  // Hold the outgoing row until its 100 ms slide finishes. A restart leaves `showing` unchanged and uses the fallback.
  useEffect(() => {
    const pending = skipping.current;
    const next = { songId, title, artist, coverImageUri };
    if (pending && pending.from === showing) {
      setDisplayed(next);
      return;
    }
    if (pending && pending.from !== showing && !reduceMotion) {
      clearTimeout(pending.timer);
      if (pending.swapTimer) clearTimeout(pending.swapTimer);
      pending.swapTimer = setTimeout(() => {
        setDisplayed(next);
        skipping.current = null;
        shift.value = -pending.dir * 16;
        settle();
      }, Motion.duration.instant);
      skipping.current = pending;
      return;
    }
    cancelSkip();
    setDisplayed(next);
    settle();
    // Only the song identity drives this; shared values are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, songId, title, artist, coverImageUri]);
  useEffect(() => () => cancelSkip(), []);
  const skip = (which: 'next' | 'previous', dx: number) => {
    cancelSkip();
    const dir: -1 | 1 = dx < 0 ? -1 : 1;
    skipInFlight.value = true;
    if (!reduceMotion) shift.value = withTiming(dir * 32, { duration: Motion.duration.instant, easing: Motion.ease.accelerate });
    fade.value = withTiming(0.2, { duration: Motion.duration.instant });
    skipping.current = { from: shownRef.current, dir, timer: setTimeout(() => { skipping.current = null; settle(); }, SKIP_SETTLE_MS) };
    (which === 'next' ? onNext : onPrevious)();
  };
  const resetGesture = () => {
    'worklet';
    skipInFlight.value = false;
    shift.value = withTiming(0, { duration: Motion.duration.fast, easing: Motion.ease.decelerate });
    fade.value = withTiming(1, { duration: Motion.duration.fast });
  };
  const rtl = I18nManager.isRTL;
  // With the native swipe on, Kotlin owns the sideways swipe (follow, decide, skip); this pan steps aside.
  const nativeSwipe = useNativeSwipeSkip(!!remote);
  const swipe = Gesture.Pan().enabled(!nativeSwipe).activeOffsetX([-16, 16]).failOffsetY([-14, 14])
    .onUpdate(e => {
      'worklet';
      if (skipInFlight.value) return;
      if (!reduceMotion) shift.value = swipeFollow(e.translationX);
      fade.value = 1 - Math.min(0.5, Math.abs(e.translationX) / 240);
    })
    .onEnd(e => {
      'worklet';
      const which = miniSwipe(e.translationX, e.translationY, e.velocityX, infoWidth, rtl);
      if (which) {
        skipInFlight.value = true;
        runOnJS(skip)(which, e.translationX);
      } else resetGesture();
    })
    .onFinalize((_e, success) => { 'worklet'; if (!success && !skipInFlight.value) resetGesture(); });
  const classicOpen = Gesture.Pan().activeOffsetY(-20).failOffsetX([-20, 20]).runOnJS(true).onEnd(e => { if (e.translationY < -24) measureCover(() => onOpen(Math.max(0, -e.velocityY))); });
  const fluidOpen = Gesture.Pan().activeOffsetY(-10).failOffsetX([-20, 20])
    .onStart(() => {
      'worklet';
      playerDrag.y.value = restY;
      playerDrag.tracking.value = true;
      runOnJS(beginTracking)();
    })
    .onUpdate(e => {
      'worklet';
      playerDrag.y.value = restY + e.translationY;
    })
    .onEnd(e => {
      'worklet';
      playerDrag.velocity.value = e.velocityY;
      playerDrag.tracking.value = false;
      playerDrag.ended.value += 1;
    })
    .onFinalize((_e, success) => {
      'worklet';
      // Cancelled by the system (a call, another gesture): let the sheet settle from where it is.
      if (!success && playerDrag.tracking.value) {
        playerDrag.velocity.value = 0;
        playerDrag.tracking.value = false;
        playerDrag.ended.value += 1;
      }
    });
  const open = fluid ? fluidOpen : classicOpen;
  const infoGesture = Gesture.Race(open, swipe);
  const following = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateX: shift.value }] }));
  const createOpen = useShellMenuStore(s => s.createOpen);
  const createDim = useAnimatedStyle(() => ({ opacity: miniContentOpacity(playerSheetProgress.value) * (1 - Math.min(1, createSheetProgress.value * 2)) }));

  if (keyboard) return null;
  const rowHeight = miniRowHeight(fontScale);
  // The Create sheet is up: the pill is part of the dimmed page under it, and a tap on it reaches the page's scrim
  // (which closes the sheet) instead of opening the player.
  return <Animated.View accessibilityElementsHidden={createOpen || sheetUp} importantForAccessibility={createOpen || sheetUp ? 'no-hide-descendants' : 'auto'} pointerEvents={createOpen || (sheetUp && !fingerDown) ? 'none' : 'auto'} style={[styles.shell, { bottom }, createDim]}>
    {/* 1.41.0: the mini player has its own soft, frosted cover glow; the navigation keeps the shell material. */}
    <MiniPlayerGlow uri={coverImageUri} active={!sheetUp && !createOpen} />
    <MiniScrubber positionSV={positionSV} durationSV={durationSV} enabled={enabled} active={scrubbing} height={SEEK_BAND_HEIGHT}
      onCommit={commitFraction}
      accessibility={{
        accessible: true, accessibilityRole: 'adjustable', accessibilityLabel: 'Song position',
        accessibilityState: { disabled: !enabled },
        accessibilityValue: { min: 0, max: duration || 1, now: position, text: `${time(position)} of ${time(duration)}` },
        accessibilityActions: [{ name: 'increment', label: 'Forward ten seconds' }, { name: 'decrement', label: 'Back ten seconds' }],
        onAccessibilityAction: e => { if (enabled) commit(usePositionStore.getState().position + (e.nativeEvent.actionName === 'increment' ? 10 : -10)); },
      }} />
    <Animated.View style={[styles.row, { height: rowHeight }, rowDim]}>
      <GestureDetector gesture={infoGesture}><View style={styles.main} onLayout={e => setInfoWidth(e.nativeEvent.layout.width)}>
        {/* Owner, 2026-11-13: no ••• on the mini player; a long press opens the song's actions instead. */}
        <NativeSwipeSkip enabled={nativeSwipe} songKey={`${displayed.songId ?? ''}|${displayed.title}`} style={{ height: rowHeight }}>
        <Tactile onPress={openMeasured} onLongPress={onMore} delayLongPress={350} pressScale={0.985} accessibilityRole="button" accessibilityLabel={miniPlayerLabel(displayed.title)} accessibilityHint={displayed.artist ? `By ${displayed.artist}` : undefined}
          accessibilityActions={[{ name: 'activate' }, { name: 'next', label: 'Next song' }, { name: 'previous', label: 'Previous song' }, ...(onMore ? [{ name: 'longpress', label: 'Song options' }] : [])]}
          onAccessibilityAction={e => { const a = e.nativeEvent.actionName; if (a === 'next') onNext(); else if (a === 'previous') onPrevious(); else if (a === 'longpress') onMore?.(); else openMeasured(); }}
          style={[styles.info, { height: rowHeight }]}>
          <Animated.View style={[styles.follow, following]}>
            <View ref={coverRef} onLayout={() => measureCover()} style={styles.cover}><Artwork uri={displayed.coverImageUri} title={displayed.title} artist={displayed.artist} size={MINI_COVER_SIZE} style={StyleSheet.absoluteFill} /></View>
            {/* 1.43.0 (owner's Spotify screenshot): the title in bold, scrolling slowly when it doesn't fit, with the
                artist on its own line under it. */}
            <View style={styles.copy}>
              <Marquee text={displayed.title} style={styles.line} active={!sheetUp} />
              <Text variant="secondary" tone="secondary" numberOfLines={1}>
                {status === 'error' ? 'Couldn’t play, tap to retry' : displayed.artist || ' '}
              </Text>
            </View>
          </Animated.View>
        </Tactile>
        </NativeSwipeSkip>
      </View></GestureDetector>
      {/* Song options, the saved mark, then play. Next is the sideways swipe (and TalkBack's
          "Next song" action above). */}
      {/* 1.44.0 (owner: "place neatly like Spotify"): three glyphs of one size on an even rhythm, centred on the row,
          close to the right edge. Each slot is 44 wide and answers a 48dp touch. */}
      <View style={styles.actions}>
        {/* Spotify's saved mark: a filled tick in a circle once saved, an outlined plus before. */}
        {onToggleLike ? (
          <Tactile onPress={onToggleLike} haptic="select" pressScale={0.9} hitSlop={ACTION_SLOP} accessibilityRole="button"
            accessibilityLabel={liked ? 'Remove from Liked songs' : 'Add to Liked songs'} accessibilityState={{ selected: !!liked }} style={styles.action}>
            <Ionicons name={liked ? 'checkmark-circle' : 'add-circle-outline'} size={ACTION_GLYPH} color={Signal.ink} />
          </Tactile>
        ) : null}
        <View style={styles.playButtonOffset}>
          <PlaybackButton size={48} plain remote={remote} status={status} onPress={() => { if (!remote && status === 'error') (onRetry ?? onTogglePlay)(); else onTogglePlay(); }} />
        </View>
      </View>
    </Animated.View>
  </Animated.View>;
}
/** The right-hand controls: one glyph size, 44-wide slots (Spotify's rhythm), each answering a 48dp touch. */
const ACTION_GLYPH = 26;
const ACTION_SLOT = 48;
const ACTION_SLOP = { left: 0, right: 0, top: 0, bottom: 0 } as const;
const styles = StyleSheet.create({
  // MiniPlayerGlow is the surface. Full width with the player sheet's own top corners (navigation/miniShell): the
  // sheet closes onto exactly this outline, so the close ends on one shape. The rim marks the top edge.
  shell: { position: 'absolute', ...miniShellOutline, zIndex: 15, overflow: 'hidden', borderTopWidth: StyleSheet.hairlineWidth, borderColor: ShellFrost.miniRim },
  // The inset the shell used to have sits inside it, so the cover and play button keep their places.
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: Space.xs + MINI_CONTENT_SIDE_INSET, paddingRight: MINI_ROW_PADDING_RIGHT + MINI_CONTENT_SIDE_INSET },
  actions: { flexDirection: 'row', alignItems: 'center' },
  playButtonOffset: { marginRight: MINI_PLAY_OFFSET },
  action: { width: ACTION_SLOT, height: Control.target, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, minWidth: 0 }, info: { justifyContent: 'center' },
  follow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, paddingLeft: Space.xs },
  cover: { width: MINI_COVER_SIZE, height: MINI_COVER_SIZE, borderRadius: Radius.cover, overflow: 'hidden', backgroundColor: Surface.control },
  copy: { flex: 1, minWidth: 0 },
  line: { ...Typography.row, color: Signal.ink, fontWeight: '600' },
});
