/**
 * The small "i" beside a screen's title: a short walkthrough of what the screen does, the phone's
 * version of the website's InfoTour (apps/web/src/components/InfoTour.tsx).
 *
 * Motion contract: tapping the "i" lifts a frosted card in over a dimmed screen. Its stage acts out
 * each step with the screen's own object (a scene from infoTours.tsx); the words swap step by step,
 * the title rising first and its line a beat later. The arrows and the dots move
 * between steps. Got it, the cross, the backdrop and Android back close it: the words and buttons step
 * aside, the scene plays a short finishing beat (everything draws in to its centre: lights merge,
 * sleeves stack), then the card shrinks straight into the "i", which gives one small bounce.
 *
 * Transform and opacity only. Reduce Motion: parts appear in place, no loops, and the card fades.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  cancelAnimation, Easing, FadeIn, FadeInDown, FadeOut, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';

import { Glass, Motion, Radius, Signal, Space } from '../../constants/allegraTheme';
import * as Haptics from '../../utils/haptics';
import Frosted from './Frosted';
import { Tactile } from './motion';

export interface TourStep {
  readonly title: string;
  readonly body: string;
}

/** A screen's stage: what it shows for each step. Hooks live in the parts it returns, never in the function. */
export type TourScene = (step: number) => React.ReactNode;

export const STAGE_H = 168;

// ─── Scene parts ────────────────────────────────────────────────────────────

/**
 * One part of a scene, placed at (x, y) from the stage centre. It springs in from `from` (an offset,
 * a size, a turn) when its step shows; the step's group fades it out when the step changes.
 */
export const Part: React.FC<{
  x?: number; y?: number; delay?: number; style?: StyleProp<ViewStyle>; children?: React.ReactNode;
  from?: { x?: number; y?: number; scale?: number; rotate?: number };
}> = ({ x = 0, y = 0, delay = 0, style, children, from }) => {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = reduce ? withTiming(1, { duration: Motion.duration.fast }) : withDelay(delay, withSpring(1, Motion.spring.hero));
  }, [delay, reduce, t]);
  const fx = reduce ? 0 : from?.x ?? 0;
  const fy = reduce ? 0 : from?.y ?? 12;
  const fs = reduce ? 1 : from?.scale ?? 0.7;
  const fr = reduce ? 0 : from?.rotate ?? 0;
  const anim = useAnimatedStyle((): ViewStyle => {
    const k = t.value;
    return {
      opacity: Math.min(1, k),
      transform: [{ translateX: x + fx * (1 - k) }, { translateY: y + fy * (1 - k) }, { scale: fs + (1 - fs) * k }, { rotate: `${fr * (1 - k)}deg` }],
    };
  });
  return <Animated.View style={[styles.part, style, anim]}>{children}</Animated.View>;
};

export type LoopKind = 'pulse' | 'float' | 'spin' | 'ripple' | 'travel' | 'rise' | 'beat' | 'bar' | 'sway' | 'blink' | 'glide';

/**
 * A repeating move: `amount` is px for float/travel/rise/glide, a fraction for pulse/beat/ripple, degrees
 * for sway. `phase` (0–1) offsets bars against each other. Reduce Motion holds a still middle pose.
 */
export const Loop: React.FC<{
  kind: LoopKind; amount?: number; duration: number; delay?: number; phase?: number;
  style?: StyleProp<ViewStyle>; children?: React.ReactNode;
}> = ({ kind, amount = 1, duration, delay = 0, phase = 0, style, children }) => {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return undefined;
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(p);
  }, [delay, duration, p, reduce]);
  const anim = useAnimatedStyle((): ViewStyle => {
    const v = reduce ? 0.5 : p.value;
    const a = amount;
    const wave = Math.sin(Math.PI * 2 * v);
    switch (kind) {
      case 'pulse': return { transform: [{ scale: 1 + a * 0.5 * (1 + wave) }] };
      case 'float': return { transform: [{ translateY: -a * wave }] };
      case 'spin': return { transform: [{ rotate: `${v * 360}deg` }] };
      case 'ripple': return { opacity: 0.6 * (1 - v), transform: [{ scale: 0.6 + a * v }] };
      case 'travel': return { opacity: Math.sin(Math.PI * v), transform: [{ translateX: -a + 2 * a * v }] };
      case 'rise': return { opacity: Math.sin(Math.PI * v), transform: [{ translateY: a - 2 * a * v }] };
      case 'beat': {
        const up = v < 0.12 ? v / 0.12 : v < 0.24 ? 1 - (v - 0.12) / 0.12 : v < 0.34 ? (v - 0.24) / 0.1 * 0.6 : v < 0.46 ? 0.6 * (1 - (v - 0.34) / 0.12) : 0;
        return { transform: [{ scale: 1 + a * up }] };
      }
      case 'bar': return { transform: [{ scaleY: 0.3 + 0.7 * Math.abs(Math.sin(Math.PI * (v + phase))) }] };
      case 'sway': return { transform: [{ rotate: `${a * wave}deg` }] };
      case 'blink': return { opacity: v < 0.5 ? 1 : 0 };
      case 'glide': return { transform: [{ translateX: -a * Math.cos(Math.PI * 2 * v) }] };
      default: return {};
    }
  });
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
};

/** A step's group: everything that belongs to one step, faded out together when the step changes. */
export const StepGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Animated.View exiting={FadeOut.duration(Motion.duration.fast)} style={styles.group} pointerEvents="none">{children}</Animated.View>
);

/** A counter that ticks every `ms` while the scene shows (not under Reduce Motion): drives shuffles and filters. */
export function useTick(ms: number): number {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return undefined;
    const timer = setInterval(() => setTick((value) => value + 1), ms);
    return () => clearInterval(timer);
  }, [ms, reduce]);
  return tick;
}

/** A screen title with its "i" beside it. */
export const InfoTitleRow: React.FC<{ children: React.ReactNode; style?: StyleProp<ViewStyle> }> = ({ children, style }) => (
  <View style={[styles.titleRow, style]}>{children}</View>
);

// ─── The button and the card ────────────────────────────────────────────────

export const InfoTour: React.FC<{
  label: string; steps: readonly TourStep[]; scene: TourScene;
  /** Parts that stay on the stage across steps and change pose (they get the step too): sleeves, lights, dials. */
  persist?: TourScene;
  style?: StyleProp<ViewStyle>;
}> = ({ label, steps, scene, persist, style }) => {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const shown = useSharedValue(0);
  // Closing: where the "i" is from the card's centre, and whether the card is folding there.
  const foldX = useSharedValue(0);
  const foldY = useSharedValue(0);
  const folding = useSharedValue(0);
  const bounce = useSharedValue(1);
  const ring = useSharedValue(1);
  const buttonBox = useRef<View>(null);
  const cardBox = useRef<View>(null);
  const count = steps.length;

  const open = (): void => {
    setIndex(0); setDirection(1); setVisible(true);
    folding.value = 0;
    shown.value = reduce ? withTiming(1, { duration: Motion.duration.base }) : withSpring(1, Motion.spring.sheet);
  };
  const finish = useCallback(() => {
    shown.value = withTiming(0, { duration: reduce ? Motion.duration.base : 600, easing: Easing.linear }, (done) => {
      if (!done) return;
      runOnJS(setVisible)(false);
      if (folding.value === 1) {
        bounce.value = withSequence(withTiming(1.35, { duration: 140 }), withSpring(1, Motion.spring.tactile));
        ring.value = 0;
        ring.value = withTiming(1, { duration: 600 });
      }
    });
  }, [bounce, folding, reduce, ring, shown]);
  const close = useCallback(() => {
    if (reduce || !buttonBox.current || !cardBox.current) { folding.value = 0; finish(); return; }
    const card = cardBox.current;
    buttonBox.current.measureInWindow((bx, by, bw, bh) => {
      card.measureInWindow((cx, cy, cw, ch) => {
        foldX.value = bx + bw / 2 - (cx + cw / 2);
        foldY.value = by + bh / 2 - (cy + ch / 2);
        folding.value = bw > 0 ? 1 : 0;
        finish();
      });
    });
  }, [finish, foldX, foldY, folding, reduce]);
  const go = (next: number): void => {
    const bounded = Math.max(0, Math.min(count - 1, next));
    if (bounded === index) return;
    Haptics.selectionAsync().catch(() => {});
    setDirection(bounded > index ? 1 : -1);
    setIndex(bounded);
  };

  const backdrop = useAnimatedStyle((): ViewStyle => ({ opacity: shown.value }));
  const card = useAnimatedStyle((): ViewStyle => {
    if (folding.value === 1) {
      // After the scene's beat (the first 40%), straight into the "i", fading at the very end.
      const q = Math.min(1, Math.max(0, (1 - shown.value - 0.4) / 0.6));
      return { opacity: q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3, transform: [{ translateX: foldX.value * q }, { translateY: foldY.value * q }, { scale: 1 - 0.94 * q }] };
    }
    return { opacity: Math.min(1, shown.value), transform: reduce ? [] : [{ translateY: (1 - shown.value) * 24 }, { scale: 0.95 + 0.05 * shown.value }] };
  });
  // The scene's finishing beat: it draws in to its centre and stays lit while the card carries it home.
  const stageLayer = useAnimatedStyle((): ViewStyle => {
    if (folding.value !== 1) return { transform: [{ scale: 1 }] };
    const c = Math.min(1, (1 - shown.value) / 0.4);
    const eased = 1 - (1 - c) * (1 - c);
    return { transform: [{ scale: 1 - 0.4 * eased }] };
  });
  // Words and buttons step aside quickly so the beat reads on its own.
  const wordsLayer = useAnimatedStyle((): ViewStyle => {
    if (folding.value !== 1) return { opacity: 1, transform: [{ translateY: 0 }] };
    const w = Math.min(1, (1 - shown.value) / 0.25);
    return { opacity: 1 - w, transform: [{ translateY: 6 * w }] };
  });
  const navLayer = wordsLayer;
  const buttonPop = useAnimatedStyle((): ViewStyle => ({ transform: [{ scale: bounce.value }] }));
  const catchRing = useAnimatedStyle((): ViewStyle => ({ opacity: ring.value < 1 ? 0.9 * (1 - ring.value) : 0, transform: [{ scale: 0.6 + 1.5 * ring.value }] }));

  const step = steps[Math.min(index, count - 1)];
  if (!step) return null;
  const last = index === count - 1;
  const words = (order: number) => (reduce
    ? FadeIn.duration(Motion.duration.base)
    : (direction > 0 ? FadeInDown : FadeIn).duration(Motion.duration.slow).delay(80 + order * 90).easing(Motion.ease.decelerate));

  return (
    <>
      <View ref={buttonBox} collapsable={false}>
        <Animated.View style={buttonPop}>
          <Tactile onPress={open} hitSlop={11} pressScale={0.88} haptic="select" accessibilityRole="button" accessibilityLabel={label} style={[styles.button, style]}>
            <Ionicons name="information" size={14} color={Signal.inkSoft} />
          </Tactile>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.catch, catchRing]} />
      </View>
      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={close}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" />
        </Animated.View>
        <View style={styles.center} pointerEvents="box-none">
          <Animated.View ref={cardBox} collapsable={false} style={[styles.card, card]} accessibilityViewIsModal>
            <Frosted radius={Radius.sheet} intensity={70} tint={0.62} />
            <Tactile onPress={close} hitSlop={8} pressScale={0.88} accessibilityRole="button" accessibilityLabel="Close" wrapperStyle={styles.closeWrap} style={styles.close}>
              <Ionicons name="close" size={18} color={Signal.inkSoft} />
            </Tactile>
            <View style={styles.stage}>
              <Animated.View style={[styles.group, stageLayer]} pointerEvents="none">
                {persist ? <View style={styles.group}>{persist(index)}</View> : null}
                <StepGroup key={index}>{scene(index)}</StepGroup>
              </Animated.View>
            </View>
            <Animated.View style={[styles.words, wordsLayer]} accessibilityLiveRegion="polite">
              <Animated.View key={index} exiting={FadeOut.duration(Motion.duration.fast)}>
                <Animated.Text entering={words(0)} style={styles.count}>{count > 1 ? `Step ${index + 1} of ${count}` : label}</Animated.Text>
                <Animated.Text entering={words(1)} style={styles.title} accessibilityRole="header">{step.title}</Animated.Text>
                <Animated.Text entering={words(2)} style={styles.body}>{step.body}</Animated.Text>
              </Animated.View>
            </Animated.View>
            <Animated.View style={[styles.nav, navLayer]}>
              <Tactile onPress={() => go(index - 1)} disabled={index === 0} pressScale={0.9} accessibilityRole="button" accessibilityLabel="Previous" style={[styles.round, index === 0 && styles.dim]}>
                <Ionicons name="arrow-back" size={18} color={Signal.ink} />
              </Tactile>
              <View style={styles.dots}>
                {steps.map((item, at) => (
                  <Pressable key={item.title} onPress={() => go(at)} hitSlop={{ top: 10, bottom: 10, left: 0, right: 0 }} accessibilityRole="button" accessibilityLabel={`Step ${at + 1}: ${item.title}`} accessibilityState={{ selected: at === index }} style={styles.dotHit}>
                    <View style={[styles.dot, at === index && styles.dotOn]} />
                  </Pressable>
                ))}
              </View>
              {last ? (
                <Tactile onPress={close} haptic="light" accessibilityRole="button" style={styles.done}>
                  <Text style={styles.doneText}>Got it</Text>
                </Tactile>
              ) : (
                <Tactile onPress={() => go(index + 1)} pressScale={0.9} accessibilityRole="button" accessibilityLabel="Next" style={[styles.round, styles.next]}>
                  <Ionicons name="arrow-forward" size={18} color={Signal.waveInk} />
                </Tactile>
              )}
            </Animated.View>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  button: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Glass.fillLight, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong },
  backdrop: { backgroundColor: Glass.scrimHeavy },
  catch: { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1, borderRadius: 14, borderWidth: 2, borderColor: Signal.wave },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Space.md },
  card: { width: '100%', maxWidth: 400, padding: Space.md, paddingTop: Space.sm, borderRadius: Radius.sheet, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong, backgroundColor: Glass.fillHeavy },
  // The corner placement belongs on the touch target (wrapperStyle): on the disc itself the target was 0 tall and could not be tapped.
  closeWrap: { position: 'absolute', top: 10, right: 10, zIndex: 5 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: Glass.fillLight },
  stage: { height: STAGE_H, alignItems: 'center', justifyContent: 'center', marginHorizontal: -Space.md, overflow: 'hidden' },
  group: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  part: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  words: { minHeight: 112, marginTop: Space.xs },
  count: { color: Signal.inkMuted, fontSize: 12, fontWeight: '600' },
  title: { color: Signal.ink, fontSize: 21, fontWeight: '700', marginTop: 4 },
  body: { color: Signal.inkSoft, fontSize: 14, lineHeight: 20, marginTop: 6 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space.sm },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Glass.fillLight },
  next: { backgroundColor: Signal.wave },
  dim: { opacity: 0.4 },
  dots: { flexDirection: 'row', alignItems: 'center' },
  dotHit: { width: 24, height: 28, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Glass.hairlineStrong },
  dotOn: { backgroundColor: Signal.wave, transform: [{ scale: 1.3 }] },
  done: { minWidth: 96, height: 44, paddingHorizontal: Space.md, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: Signal.wave },
  doneText: { color: Signal.waveInk, fontSize: 15, fontWeight: '700' },
});

export default InfoTour;
