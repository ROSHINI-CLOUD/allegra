/**
 * The Blend as a story you watch: full screen, segmented bars along the top, each slide playing for a
 * few seconds. Tap the right side for the next slide, the left for the one before; hold anywhere to
 * pause. It opens on the two of you, counts up the match, walks through the story cards with each
 * song's cover filling the room, fans out the top songs, and ends on Play.
 *
 * Reduce Motion: slides fade, nothing travels and the number lands at once. With a screen reader on,
 * slides wait for the listener instead of advancing by themselves.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, BackHandler, Modal, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { cancelAnimation, Easing, FadeIn, FadeInDown, FadeOut, runOnJS, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { BLEND_TEXT, storyText } from '@shared/blendCopy';
import type { Story } from '@shared/blendStories';
import type { BlendDetail } from '@shared/blendView';
import type { SongSnapshot } from '@shared/songRef';

import { Motion, Radius, Signal, Space } from '../../constants/allegraTheme';
import { countOf } from '../../utils/formatters';
import * as Haptics from '../../utils/haptics';
import { IconButton, Tactile } from '../../ui';
import { Artwork } from '../allegra/Artwork';
import { discColour, MemberDisc } from './BlendParts';

/** How long one slide plays before the next. */
const SLIDE_MS = 5200;

type Slide =
  | { readonly kind: 'intro' }
  | { readonly kind: 'match'; readonly value: number; readonly label: string; readonly note?: string }
  | { readonly kind: 'story'; readonly story: Story }
  | { readonly kind: 'top' }
  | { readonly kind: 'outro' };

const storySong = (story: Story): SongSnapshot | undefined => (story.kind === 'song' || story.kind === 'gift' ? story.song : undefined);

function slidesFor(detail: BlendDetail): Slide[] {
  const group = detail.members.length > 2;
  const match = group && detail.pairs.length > 0
    ? Math.round(detail.pairs.reduce((total, pair) => total + pair.match, 0) / detail.pairs.length)
    : detail.pairs[0]?.match;
  const slides: Slide[] = [{ kind: 'intro' }];
  if (match !== undefined) slides.push({ kind: 'match', value: match, label: group ? 'Group match' : 'Taste match', ...(!group && detail.pairs[0]?.confidence === 'low' ? { note: BLEND_TEXT.lowconfidence } : {}) });
  for (const story of detail.stories) if (story.kind !== 'match' && story.kind !== 'groupMatch') slides.push({ kind: 'story', story });
  if (detail.tracks.length >= 3) slides.push({ kind: 'top' });
  slides.push({ kind: 'outro' });
  return slides;
}

/** One bar per slide: done ones full, the current one filling, later ones empty. Transform only. */
const Segment: React.FC<{ state: 'done' | 'now' | 'later'; progress: SharedValue<number> }> = ({ state, progress }) => {
  const [width, setWidth] = useState(0);
  const fill = useAnimatedStyle(() => {
    const t = state === 'done' ? 1 : state === 'later' ? 0 : progress.value;
    return { transform: [{ translateX: -(1 - t) * width }] };
  });
  return (
    <View style={styles.segment} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <Animated.View style={[styles.segmentFill, fill]} />
    </View>
  );
};

/** The match counts up from zero, easing out as it lands. */
const CountUp: React.FC<{ value: number; reduced: boolean }> = ({ value, reduced }) => {
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) { setShown(value); return undefined; }
    const started = Date.now();
    const duration = Motion.duration.cinematic * 1.6;
    let frame = 0;
    const tick = (): void => {
      const t = Math.min(1, (Date.now() - started) / duration);
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced, value]);
  return <Text style={styles.matchNumber} accessibilityLabel={`${value} percent`}>{shown}%</Text>;
};

/** Discs that start apart and slide together, the same meeting as the first-visit reveal. */
const Meeting: React.FC<{ detail: BlendDetail; reduced: boolean }> = ({ detail, reduced }) => {
  const t = useSharedValue(reduced ? 1 : 0);
  useEffect(() => { t.value = reduced ? 1 : withDelay(120, withSpring(1, Motion.spring.hero)); }, [reduced, t]);
  const size = detail.members.length > 2 ? 64 : 104;
  return (
    <View style={styles.meeting}>
      {detail.members.map((member, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        return <MeetingDisc key={member.userId} t={t} side={side} overlap={index > 0 ? -size / 4 : 0}><MemberDisc member={member} size={size} /></MeetingDisc>;
      })}
    </View>
  );
};
const MeetingDisc: React.FC<{ t: SharedValue<number>; side: number; overlap: number; children: React.ReactNode }> = ({ t, side, overlap, children }) => {
  const style = useAnimatedStyle(() => ({ opacity: t.value, transform: [{ translateX: (1 - t.value) * 140 * side }] }));
  return <Animated.View style={[{ marginLeft: overlap }, style]}>{children}</Animated.View>;
};

export const BlendStoryPlayer: React.FC<{
  readonly detail: BlendDetail;
  readonly visible: boolean;
  readonly onClose: () => void;
  /** The phone's playback path with the Blend as the queue. */
  readonly onPlay: (song: SongSnapshot | null) => void;
}> = ({ detail, visible, onClose, onPlay }) => {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const slides = useMemo(() => slidesFor(detail), [detail]);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const progress = useSharedValue(0);
  const slide = slides[Math.min(index, slides.length - 1)]!;
  const tones = detail.members.map((member) => discColour(member.userId));
  const backdropSong = slide.kind === 'story' ? storySong(slide.story) : slide.kind === 'top' || slide.kind === 'outro' ? detail.tracks[0]?.song : undefined;

  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const indexRef = useRef(index); indexRef.current = index;
  /** How much of the current slide has played (0–1), kept on the JS side so pause and resume pick up where they were. */
  const played = useRef(0);
  const startedAt = useRef(0);
  const shownIndex = useRef(-1);

  useEffect(() => { if (visible) { setIndex(0); setPaused(false); shownIndex.current = -1; } }, [visible]);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((on) => { if (alive) setScreenReader(on); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => { alive = false; sub.remove(); };
  }, []);

  const go = useCallback((delta: number) => {
    const next = indexRef.current + delta;
    if (next >= slides.length) { onCloseRef.current(); return; }
    setIndex(Math.max(0, next));
  }, [slides.length]);
  const tap = (delta: number): void => { Haptics.selectionAsync().catch(() => undefined); go(delta); };

  // The current bar fills over SLIDE_MS; reaching the end moves on. A pause keeps where it got to.
  const auto = visible && !paused && !screenReader;
  useEffect(() => {
    if (shownIndex.current !== index) { shownIndex.current = index; played.current = 0; }
    progress.value = played.current;
    if (!auto) return undefined;
    startedAt.current = Date.now();
    progress.value = withTiming(1, { duration: SLIDE_MS * (1 - played.current), easing: Easing.linear }, (finished) => { if (finished) runOnJS(go)(1); });
    return () => {
      cancelAnimation(progress);
      played.current = Math.min(1, played.current + (Date.now() - startedAt.current) / SLIDE_MS);
    };
  }, [auto, go, index, progress]);

  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose, visible]);

  const enter = reduced ? FadeIn.duration(Motion.duration.base) : FadeInDown.duration(Motion.duration.slow).easing(Motion.ease.decelerate);
  const rise = (step: number) => (reduced ? FadeIn.duration(Motion.duration.base) : FadeInDown.duration(Motion.duration.slow).delay(step * 90).easing(Motion.ease.decelerate));

  const content = (() => {
    switch (slide.kind) {
      case 'intro':
        return (
          <View style={styles.center}>
            <Meeting detail={detail} reduced={reduced} />
            <Animated.Text entering={rise(3)} style={styles.eyebrow}>Your Blend</Animated.Text>
            <Animated.Text entering={rise(4)} style={styles.headline} numberOfLines={3}>{detail.name}</Animated.Text>
            <Animated.Text entering={rise(5)} style={styles.detail}>{countOf(detail.tracks.length, 'song')}, made from {detail.members.length > 2 ? 'all of you' : 'both of you'} today.</Animated.Text>
          </View>
        );
      case 'match':
        return (
          <View style={styles.center}>
            <Animated.Text entering={rise(0)} style={styles.eyebrow}>{slide.label}</Animated.Text>
            <CountUp value={slide.value} reduced={reduced} />
            {slide.note ? <Animated.Text entering={rise(4)} style={styles.detail}>{slide.note}</Animated.Text> : null}
          </View>
        );
      case 'story': {
        const text = storyText(slide.story, detail);
        const song = storySong(slide.story);
        return (
          <View style={styles.center}>
            <Animated.Text entering={rise(0)} style={styles.eyebrow}>{text.eyebrow}</Animated.Text>
            {song ? (
              <Animated.View entering={rise(1)} style={styles.coverShadow}>
                <Artwork uri={song.artwork} title={song.title} artist={song.artist} size={Math.min(width * 0.62, 280)} priority="high" style={[styles.cover, { width: Math.min(width * 0.62, 280), height: Math.min(width * 0.62, 280) }]} />
              </Animated.View>
            ) : null}
            <Animated.Text entering={rise(2)} style={[styles.headline, !song && styles.headlineBig]} numberOfLines={4}>{text.headline}</Animated.Text>
            {text.detail ? <Animated.Text entering={rise(3)} style={styles.detail} numberOfLines={4}>{text.detail}</Animated.Text> : null}
            {song ? (
              <Animated.View entering={rise(4)}>
                <Tactile onPress={() => onPlay(song)} haptic="light" accessibilityRole="button" accessibilityLabel={`Play ${song.title}`} hitSlop={8} style={styles.playSmall}>
                  <Ionicons name="play" size={18} color={Signal.waveInk} /><Text style={styles.playSmallText}>Play</Text>
                </Tactile>
              </Animated.View>
            ) : null}
          </View>
        );
      }
      case 'top': {
        const top = detail.tracks.slice(0, 5);
        return (
          <View style={styles.center}>
            <Animated.Text entering={rise(0)} style={styles.eyebrow}>Top of today’s mix</Animated.Text>
            <View style={styles.topList}>
              {top.map((track, i) => (
                <Animated.View key={track.song.ref} entering={rise(i + 1)} style={styles.topRow}>
                  <Text style={styles.topIndex}>{i + 1}</Text>
                  <Artwork uri={track.song.artwork} title={track.song.title} artist={track.song.artist} size={52} style={styles.topCover} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.topTitle} numberOfLines={1}>{track.song.title}</Text>
                    <Text style={styles.topArtist} numberOfLines={1}>{track.song.artist}</Text>
                  </View>
                </Animated.View>
              ))}
            </View>
          </View>
        );
      }
      case 'outro':
        return (
          <View style={styles.center}>
            <Animated.Text entering={rise(0)} style={styles.eyebrow}>That’s your Blend</Animated.Text>
            <Animated.Text entering={rise(1)} style={styles.headline}>Press play and hear it together.</Animated.Text>
            <Animated.View entering={rise(2)}>
              <Tactile onPress={() => { onPlay(null); onClose(); }} haptic="light" accessibilityRole="button" accessibilityLabel={`Play ${detail.name}`} style={styles.playBig}>
                <Ionicons name="play" size={30} color={Signal.waveInk} />
              </Tactile>
            </Animated.View>
          </View>
        );
      default:
        return null;
    }
  })();

  return (
    <Modal visible={visible} animationType={reduced ? 'fade' : 'slide'} statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.screen}>
        {/* The room takes the members' colours; a song slide lays its cover, blurred, over them. */}
        <LinearGradient colors={tones.length > 1 ? [tones[0]!, Signal.bgDeep, tones[1]!] : [tones[0] ?? Signal.accentDeep, Signal.bgDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        {backdropSong?.artwork ? (
          <Animated.View key={backdropSong.ref} entering={FadeIn.duration(Motion.duration.cinematic)} exiting={FadeOut.duration(Motion.duration.base)} style={StyleSheet.absoluteFill}>
            <Image source={{ uri: backdropSong.artwork }} blurRadius={40} contentFit="cover" style={[StyleSheet.absoluteFill, { opacity: 0.55 }]} />
          </Animated.View>
        ) : null}
        <LinearGradient colors={['rgba(7, 8, 11, 0.35)', 'rgba(7, 8, 11, 0)', 'rgba(7, 8, 11, 0.55)']} style={StyleSheet.absoluteFill} />

        {/* Tap zones: left third goes back, the rest goes on; holding pauses. */}
        <Tactile
          wrapperStyle={StyleSheet.absoluteFill}
          style={StyleSheet.absoluteFill}
          pressScale={1}
          onPressIn={() => setPaused(true)}
          onPressOut={() => setPaused(false)}
          onPress={(event) => tap(event.nativeEvent.locationX < width / 3 ? -1 : 1)}
          delayLongPress={250}
          onLongPress={() => undefined}
          accessibilityRole="button"
          accessibilityLabel={`Slide ${index + 1} of ${slides.length}. Tap for the next slide.`}
        >
          <Animated.View key={index} entering={enter} style={[styles.body, { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 48 }]} pointerEvents="box-none">
            {content}
          </Animated.View>
        </Tactile>

        <View style={[styles.top, { paddingTop: insets.top + Space.xs }]} pointerEvents="box-none">
          <View style={styles.segments}>
            {slides.map((item, i) => <Segment key={`${item.kind}-${i}`} state={i < index ? 'done' : i === index ? 'now' : 'later'} progress={progress} />)}
          </View>
          <View style={styles.topBar}>
            <Text style={styles.topName} numberOfLines={1}>{detail.name}</Text>
            {screenReader ? <IconButton icon="chevron-forward" label="Next slide" onPress={() => tap(1)} /> : null}
            <IconButton icon="close" label="Close story" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bgDeep },
  body: { flex: 1, paddingHorizontal: Space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space.md },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: Space.sm, gap: Space.xs },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255, 255, 255, 0.24)' },
  segmentFill: { ...StyleSheet.absoluteFillObject, backgroundColor: Signal.ink, borderRadius: 2 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, paddingLeft: Space.xxs },
  topName: { flex: 1, color: Signal.ink, fontSize: 14, fontWeight: '700' },
  meeting: { flexDirection: 'row', alignItems: 'center', marginBottom: Space.md },
  eyebrow: { color: Signal.inkSoft, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  headline: { color: Signal.ink, fontSize: 30, lineHeight: 36, fontWeight: '700', textAlign: 'center' },
  headlineBig: { fontSize: 38, lineHeight: 44 },
  detail: { color: Signal.inkSoft, fontSize: 16, lineHeight: 22, textAlign: 'center', maxWidth: 320 },
  matchNumber: { color: Signal.ink, fontSize: 132, lineHeight: 140, fontWeight: '700', fontVariant: ['tabular-nums'] },
  coverShadow: { borderRadius: Radius.art, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 14 }, elevation: 18 },
  cover: { borderRadius: Radius.art },
  playSmall: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 20, borderRadius: Radius.pill, backgroundColor: Signal.wave },
  playSmallText: { color: Signal.waveInk, fontSize: 15, fontWeight: '700' },
  playBig: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  topList: { alignSelf: 'stretch', gap: Space.sm, marginTop: Space.sm },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  topIndex: { width: 22, color: Signal.inkSoft, fontSize: 18, fontWeight: '700', textAlign: 'center', fontVariant: ['tabular-nums'] },
  topCover: { width: 52, height: 52, borderRadius: Radius.thumb },
  topTitle: { color: Signal.ink, fontSize: 16, fontWeight: '700' },
  topArtist: { color: Signal.inkSoft, fontSize: 13 },
});

export default BlendStoryPlayer;
