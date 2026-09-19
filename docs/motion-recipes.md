# MOTION RECIPES — copy-paste, then tune

Spec and rationale: `.planning/07-MOTION-DESIGN-SYSTEM.md`. This file is the code.
Stack: Framer Motion (`motion/react`), already in `package.json`.

## 0 · Primitives — `src/motion/index.ts`

```ts
export const D = { instant: 0.1, fast: 0.16, base: 0.24, slow: 0.4, cine: 0.7 } as const;

export const E = {
  standard:   [0.4, 0.0, 0.2, 1],
  decelerate: [0.0, 0.0, 0.2, 1],
  accelerate: [0.4, 0.0, 1.0, 1],
  emphasis:   [0.2, 0.0, 0.0, 1.0],
} as const;

export const spring = {
  tactile: { type: 'spring', stiffness: 400, damping: 30 },
  sheet:   { type: 'spring', stiffness: 300, damping: 34 },
  hero:    { type: 'spring', stiffness: 220, damping: 30 },
} as const;

export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: D.base, ease: E.decelerate } },
  exit:    { opacity: 0, y: -8, transition: { duration: D.fast, ease: E.accelerate } },
};

// Cap the cascade at 8 — beyond that later items read as broken, not choreographed
export const stagger = (n = 0.04, cap = 8) => ({
  animate: { transition: { staggerChildren: n, delayChildren: 0 } },
  custom: (i: number) => ({ delay: Math.min(i, cap) * n }),
});
```

## 1 · Reduced motion — wire this before anything else

```tsx
import { useReducedMotion } from 'motion/react';

export function useMotionSafe<T>(full: T, reduced: T): T {
  return useReducedMotion() ? reduced : full;
}

// usage
const variants = useMotionSafe(fadeUp, {
  initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 },
});
```
Reduced motion **collapses to opacity**. It never disables a feature.

## 2 · Staggered grid

```tsx
<motion.div initial="initial" animate="animate" variants={stagger().animate && {}}>
  {songs.map((s, i) => (
    <motion.div
      key={s.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: D.base, ease: E.decelerate, delay: Math.min(i, 8) * 0.04 }}
    >
      <MusicCard song={s} />
    </motion.div>
  ))}
</motion.div>
```

## 3 · The hero transition ⭐⭐

The artwork **never unmounts**. One element, two positions.

```tsx
// MusicCard.tsx
<motion.img
  layoutId={`art-${song.id}`}
  src={song.artwork}
  transition={spring.hero}
  className="rounded-xl w-full aspect-square object-cover"
/>

// FullPlayer.tsx — SAME layoutId
<AnimatePresence mode="wait">
  {isOpen && (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: D.base }}
      className="fixed inset-0 z-50"
    >
      <motion.img layoutId={`art-${song.id}`} src={song.artwork} transition={spring.hero} />

      <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                 transition={{ duration: D.base, delay: 0.18, ease: E.decelerate }}>
        {song.title}
      </motion.h1>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: D.base, delay: 0.26, ease: E.decelerate }}>
        <TransportControls />
      </motion.div>

      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }}
                  transition={{ ...spring.sheet, delay: 0.34 }}>
        <LyricsPanel />
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
```

The layer behind, blurring back:
```tsx
<motion.div
  animate={isOpen ? { filter: 'blur(20px)', scale: 0.96 } : { filter: 'blur(0px)', scale: 1 }}
  transition={{ duration: D.base, delay: isOpen ? 0.08 : 0, ease: E.standard }}
/>
```

> `filter` is not a compositor-only property. Budget it: **one** blurring surface, and profile it on a real phone. If it janks, blur a static snapshot instead of the live tree.

## 4 · Dominant colour — one function, no library

```ts
export async function dominantColor(src: string): Promise<string> {
  const img = new Image();
  img.crossOrigin = 'anonymous';           // our proxy sets the CORS headers
  img.src = src;
  await img.decode();

  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, 1, 1);          // 1x1 = the average pixel
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r} ${g} ${b})`;
}
```
Cache per song id. Feed it into a CSS variable and let the ambient background transition at `D.cine`.

## 5 · Play / pause morph

```tsx
<motion.svg viewBox="0 0 24 24">
  <motion.path
    animate={{ d: isPlaying ? 'M8 5h3v14H8z' : 'M8 5l11 7-11 7z' }}
    transition={{ duration: D.fast, ease: E.standard }}
  />
</motion.svg>
```
Both paths need the same command count to interpolate cleanly. A crossfade between two icons reads as a bug; a morph reads as craft.

## 6 · Scrubber with drag physics

```tsx
function Scrubber({ duration, current, onSeek }) {
  const [dragging, setDragging] = useState(false);
  const [local, setLocal] = useState(current);
  const pct = ((dragging ? local : current) / duration) * 100;

  return (
    <motion.div
      className="relative h-8 flex items-center cursor-pointer touch-none"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
      onPointerMove={e => {
        if (!dragging) return;
        const r = e.currentTarget.getBoundingClientRect();
        setLocal(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
      }}
      onPointerUp={() => {
        setDragging(false);
        onSeek(local);                       // audio catches up AFTER the finger
        navigator.vibrate?.(8);
      }}
    >
      <motion.div className="h-full bg-white rounded-full"
        animate={{ height: dragging ? 8 : 3 }} transition={spring.tactile}
        style={{ width: `${pct}%` }} />
      <motion.div className="absolute w-3 h-3 bg-white rounded-full"
        animate={{ scale: dragging ? 1.4 : 1, opacity: dragging ? 1 : 0 }}
        transition={spring.tactile} style={{ left: `${pct}%` }} />
    </motion.div>
  );
}
```
**Optimistic:** the thumb follows the finger immediately; the audio seeks on release. And `onSeek` must honour invariant 3 — resume if it was playing.

## 7 · Lyric line focal falloff

```tsx
const dist = Math.abs(index - activeIndex);
<motion.p
  animate={{
    opacity: dist === 0 ? 1 : dist === 1 ? 0.45 : 0.2,
    scale:   dist === 0 ? 1.04 : 1,
    filter:  dist >= 2 ? 'blur(1px)' : 'blur(0px)',
  }}
  transition={{ duration: D.base, ease: E.standard }}
  onClick={() => onSeek(line.timestamp)}
/>
```
Scroll the active line to **42% from the top**, not 50% — the eye reads slightly high, and dead-centre feels low.

## 8 · Skeletons — shaped like the content

```tsx
<div className="animate-pulse">
  <div className="aspect-square rounded-xl bg-white/10" />
  <div className="h-4 w-3/4 mt-3 rounded bg-white/10" />
  <div className="h-3 w-1/2 mt-2 rounded bg-white/5" />
</div>
```
Never a spinner in the middle of an empty page. A skeleton shaped like the result makes the wait feel shorter than it is.

## Performance rules — no exceptions
- `transform` and `opacity` only. `width`, `top`, `height`, `box-shadow` are **banned** in transitions.
- `will-change` only while animating, removed after.
- `AnimatePresence mode="wait"` on routes — never two full screens at once.
- Max ~12 concurrently animating elements; stagger beyond that.
- **Profile on a real mid-range Android.** Your laptop will lie to you right up until the demo.
