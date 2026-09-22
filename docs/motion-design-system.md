# 07 — MOTION & CINEMATIC UI SYSTEM (P2 owns)

> **This document is the Best UI track.** Everything else on the project is built to *sufficient*; this is built to *exceptional*.

## How to use your skills alongside this doc

Invoke these in your Allegra repo session — they carry the full craft guidance, and this document is the project-specific application of it:

```
/cinematic-ui-motion        → depth, tactile controls, coordinated animation
/motion-animate-ux-stack    → transition intent, continuity, choreography, tech choice
/frontend-design-fidelity   → responsive, long text, loading, errors, exports
/curiosity-driven-ux        → clear choices, meaningful progress, personalisation
```

Order matters: **`curiosity-driven-ux` before you design a flow, `cinematic-ui-motion` + `motion-animate-ux-stack` while you build it, `frontend-design-fidelity` before you call it done.** The tokens and specs below are the contract those skills' output must conform to, so the four of you ship one system rather than four styles.

---

## 1 · The principle

> **Motion exists to explain where things came from and where they went.** If an animation doesn't answer that, it's decoration, and decoration at 30 fps is worse than no animation at all.

Allegra is a music player. Music is time, rhythm and anticipation — so the interface should feel **played**, not clicked. Three consequences:

1. **Continuity over cuts.** Elements transform into each other. They don't disappear and reappear somewhere else.
2. **Tactility.** Controls respond to *pressure*, not just clicks — scale down on press, spring back on release.
3. **Depth is earned.** Blur, shadow and parallax indicate layer, never mood.

### Visual continuity rule — cool blue studio

The current visual direction is a deep ocean canvas carrying a family of soft-black, rounded panels with electric-blue light fields and dotted/noise texture. The same surface language must carry through the hero feature, mood tiles, catalog, queue, lyrics, and player sheet. A section should feel like another panel in the same instrument, not a new editorial “slide.”

- Keep the canvas `#06101a`; use `#050b13` / `#0d1b2b` for product panels.
- Keep panel radii in the shared 20–30 px family and borders thin blue/translucent.
- Use cool blue for active playback and cobalt/blue-violet light fields for signal depth.
- Prefer sans-serif display text and compact mono metadata; avoid mixing in a separate serif-led hierarchy.
- Let only `transform` and `opacity` animate. Gradient, border, and color changes can be state changes, but never animated properties.
- The shared blue atmosphere is implemented as composited shader-inspired layers: a perspective grid, light orbs, scanline, and grain. Pointer response updates CSS variables for parallax; reduced motion freezes the layers.

---

## 2 · Tokens — the only numbers allowed

`src/styles/tokens.css`. **No ad-hoc durations anywhere in the codebase.** If a component needs a number that isn't here, add it here first.

```css
:root {
  /* Duration — scaled to perceived distance */
  --d-instant: 100ms;   /* state flip: toggle, checkbox           */
  --d-fast:    160ms;   /* hover, press, tooltip                  */
  --d-base:    240ms;   /* most transitions — the default         */
  --d-slow:    400ms;   /* panels, sheets, drawers                */
  --d-cine:    700ms;   /* the hero transition. Used ONCE.        */

  /* Easing */
  --e-standard:   cubic-bezier(0.4, 0.0, 0.2, 1);   /* moves within view   */
  --e-decelerate: cubic-bezier(0.0, 0.0, 0.2, 1);   /* enters the view     */
  --e-accelerate: cubic-bezier(0.4, 0.0, 1.0, 1);   /* exits the view      */
  --e-emphasis:   cubic-bezier(0.2, 0.0, 0.0, 1.0); /* the hero moment     */

  --stagger: 40ms;      /* between siblings; cap the cascade at 8 items    */

  /* Depth — elevation is blur + shadow + scale, moving together */
  --z-base:  0px;
  --z-raise: 4px;
  --z-float: 16px;
  --z-modal: 32px;
}
```

**Springs** (Framer Motion) — for anything a finger touches:
```ts
export const spring = {
  tactile: { type: 'spring', stiffness: 400, damping: 30 },  // buttons
  sheet:   { type: 'spring', stiffness: 300, damping: 34 },  // panels
  hero:    { type: 'spring', stiffness: 220, damping: 30 },  // the transition
} as const;
```

**Rule of thumb:** the further a thing travels, the longer it takes — but never linearly. Doubling the distance adds ~40% to the duration, not 100%.

---

## 3 · Choreography

Things that belong together move together; things that don't, don't.

**Stagger, don't sync.** A grid of cards entering at once reads as a page load. The same cards at 40 ms apart read as a deal being dealt.
```tsx
const container = { animate: { transition: { staggerChildren: 0.04 } } };
const item = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.24, ease: [0.4,0,0.2,1] } },
};
```
**Cap the cascade at 8.** Beyond that, later items feel broken rather than choreographed — items 9+ share item 8's delay.

**Lead and follow.** In a composite transition, one element leads and the rest follow ~80 ms behind. In the hero transition, **artwork leads; text, controls and lyrics follow.** The eye tracks one object; everything else is peripheral.

**Exit faster than enter.** Exits use `--d-fast` and `--e-accelerate`. Nobody wants to watch something they dismissed leave slowly.

---

## 4 · The hero transition ⭐⭐ — card → full-screen player

**The single most important 700 ms in the project.** It is the centrepiece of the demo video and the strongest single argument for the Best UI track.

The whole trick: the album artwork **never unmounts**. It is one element that changes size and position, and everything else composes around it.

```tsx
// MusicCard.tsx
<motion.img layoutId={`art-${song.id}`} src={song.artwork} />

// FullPlayer.tsx  — same layoutId, different size/position
<motion.img layoutId={`art-${song.id}`} src={song.artwork} />
```
Wrap both in `<AnimatePresence mode="wait">` and give the shared element `transition={spring.hero}`.

**The beat sheet** (total ~700 ms):

| t | What | Why |
|---|---|---|
| 0 ms | Artwork begins travelling + scaling to hero position | The anchor. The eye locks on. |
| 0 ms | Background blooms to the artwork's dominant colour | The room changes around the object |
| 80 ms | Grid behind blurs (`blur(0→20px)`) and scales to 0.96 | Establishes depth — we moved *forward*, not sideways |
| 180 ms | Title + artist rise in (`y: 16→0`, opacity) | Follows the leader |
| 260 ms | Transport controls spring in, 40 ms stagger | The instrument assembles |
| 340 ms | Lyrics panel slides up from below the fold | Last, because it's the deepest layer |
| 700 ms | Settled | |

**Reverse is not a replay.** Exit runs at `--d-slow` (400 ms) with `--e-accelerate`, and the lyrics leave first — reverse order, faster. A time-reversed entrance feels sluggish.

**Dominant colour:** draw the artwork to a 1×1 offscreen canvas and read the pixel. That's your ambient tint — one line, no library. Requires the image be CORS-clean, which our proxy already handles. Cache per song id.

---

## 5 · Tactile controls

**Transport buttons** — pressure, not clicks:
```tsx
<motion.button
  whileHover={{ scale: 1.06 }}
  whileTap={{ scale: 0.92 }}
  transition={spring.tactile}
/>
```

**Play/pause is a morph, not a swap.** Animate the SVG path from triangle to bars. A crossfade between two icons reads as a bug; a morph reads as craft. ~160 ms.

**The scrubber** is the highest-value control on the screen — build it with pointer events, never `<input type=range>`:
- Idle: 3 px track
- Hover: grows to 6 px, thumb fades in (`--d-fast`)
- Dragging: 8 px, thumb scales 1.4×, **elapsed time detaches and follows the thumb**
- Release: springs back, **and the audio seeks** (invariant 3 in `06-FRONTEND-PLAN.md` — resume if it was playing)

Optimistic UI: the thumb follows the finger *immediately*; the audio catches up. Never let a network round-trip gate a drag.

**Haptics** on touch devices where supported: `navigator.vibrate?.(8)` on seek commit. Guard it — it's not everywhere.

---

## 6 · Lyrics motion

The most-watched surface in the demo. Get this right.

- **Active line**: scales to 1.04, opacity 1, full colour.
- **Neighbours**: opacity 0.45. **Two lines out**: 0.2 + `blur(1px)`. This focal falloff is what makes it feel cinematic rather than like a transcript.
- **Scroll**: the active line eases to the optical centre (≈42% from top, not 50% — the eye reads slightly high) at `--d-base` with `--e-standard`.
- **Word-level glow** (stretch): a gradient sweep across the active line timed to its duration. High effort, high reward on camera.
- `[INSTRUMENTAL]`: a slowly pulsing glyph, **never the literal string**.
- **Click a line → seek to it.** Cheap to build, demos beautifully, and it's the kind of "oh, you thought about it" detail Best UI rewards.
- **Interpolated (unsynced) lyrics use the identical path.** Nothing in this section knows the difference — that's why the backend interpolates instead of returning nothing.

---

## 7 · Depth

Three layers, and only three:

| Layer | Blur behind | Scale behind | Use |
|---|---|---|---|
| **Base** | — | 1.0 | Pages |
| **Float** | 12 px | 0.98 | Sheets, queue, panels |
| **Modal** | 20 px | 0.96 | Full player, dialogs |

Glassmorphism (`backdrop-filter`) is **expensive**. Use it on at most **two** simultaneous surfaces, and never on a scrolling list — it recomposites every frame and will tank you to 30 fps on a mid-range Android.

---

## 8 · Curiosity & progress *(from `curiosity-driven-ux`)*

Motion makes it feel good; this makes people keep using it.

- **Clear next choice.** Every screen answers "what now?" — the player suggests the next track *before* the current one ends.
- **Visible progress.** "12 songs · 48 min" on a library. A ring around the artwork showing track position. Progress that is *seen* is progress that feels earned.
- **Personalisation that's honest.** "Because you played X" is a real reason and takes one call to `/suggestions`. "Made For You" with a static list is a lie the judge will click on.
- **One surprise.** A single moment of unexpected delight — the ambient colour bloom, or the queue cards dealing like a hand. **One.** Two is a theme park.

---

## 9 · Performance — the non-negotiables

| Rule | Why |
|---|---|
| Animate **`transform` / `opacity` only** | Everything else triggers layout or paint. `width`, `top`, `height`, `box-shadow` are banned in transitions. |
| `will-change` on the animating element only, **removed after** | A permanent `will-change` is a permanent memory cost |
| `AnimatePresence mode="wait"` for route changes | Two full screens animating at once drops frames on every mid-range phone |
| Virtualise lists > 50 items | |
| Cap concurrent animated elements at ~12 | Stagger beyond that instead |
| **Profile on a real mid-range Android, not a MacBook** | Your laptop will lie to you until the demo |

Target: **60 fps** on the hero transition on a real phone. Check it in DevTools → Performance before you call F6 done.

---

## 10 · Reduced motion — do this, don't skip it

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```
In Framer Motion, `useReducedMotion()` → swap every transform variant for opacity-only. **The shared-element transition becomes a crossfade**, not a disabled feature. The app must remain fully usable, and it's a genuine accessibility answer if a judge asks.

---

## 11 · Definition of done

- [ ] Every duration/easing comes from a token
- [ ] Hero transition holds 60 fps on a real mid-range phone
- [ ] `prefers-reduced-motion` fully honoured
- [ ] Every async surface has loading / empty / error states
- [ ] 60-char titles and 8-artist strings don't break any layout
- [ ] Devanagari and Tamil render without clipping (line-height, not just width)
- [ ] Missing artwork shows a designed fallback
- [ ] Keyboard: Space, ←, →, Tab all work with visible focus
- [ ] Lighthouse ≥ 90 performance on the deployed URL
- [ ] 360 / 768 / 1280 / 1920 all correct on a real device
