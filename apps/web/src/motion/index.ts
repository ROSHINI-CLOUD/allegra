import type { Transition, Variants } from 'motion/react';

export const motionTokens = {
  duration: {
    instant: 0.1,
    fast: 0.16,
    base: 0.24,
    panel: 0.24,
    slow: 0.4,
    cinematic: 0.7
  },
  ease: {
    standard: [0.4, 0, 0.2, 1] as const,
    decelerate: [0, 0, 0.2, 1] as const,
    accelerate: [0.4, 0, 1, 1] as const,
    emphasis: [0.2, 0, 0, 1] as const,
    tactile: [0.2, 0, 0, 1] as const
  },
  stagger: 0.04
} as const;

export const spring = {
  tactile: { type: 'spring', stiffness: 400, damping: 30 } as const,
  sheet: { type: 'spring', stiffness: 300, damping: 34 } as const,
  hero: { type: 'spring', stiffness: 220, damping: 30 } as const
};

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: motionTokens.duration.base,
      ease: motionTokens.ease.decelerate,
      staggerChildren: motionTokens.stagger
    }
  }
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTokens.duration.base, ease: motionTokens.ease.decelerate }
  }
};

export const reducedTransition: Transition = {
  duration: motionTokens.duration.instant,
  ease: motionTokens.ease.standard
};

export function transitionForReducedMotion(reduced: boolean, transition: Transition): Transition {
  return reduced ? reducedTransition : transition;
}
