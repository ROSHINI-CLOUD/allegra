# 06 — FRONTEND IMPLEMENTATION PLAN (P2)

> Motion spec lives in `07-MOTION-DESIGN-SYSTEM.md`. Read it before writing animation code.

## Stack
React 19 · TypeScript · Vite · Tailwind v4 · **Framer Motion** (`motion/react`) · `lucide-react` · `react-router-dom` v7.

## Visual direction — cool blue studio system

The landing page and player surfaces share one visual language, based on the approved reference direction: a deep ocean canvas with soft-black rounded panels, electric blue light fields, dotted/noise textures, thin blue borders, and compact sans-serif UI typography. The product should read as one designed system from the first viewport through search, queue, lyrics, and playback.

- **Canvas:** `#06101a` deep blue with a restrained cool-blue dot texture; do not alternate into the old light or cream/editorial theme.
- **Surfaces:** `#050b13` / `#0d1b2b` soft-black panels for the hero feature, queue, catalog, lyrics, and player. Use a 20–30 px radius family and thin blue borders.
- **Signals:** `#62b4ff` is the playback/selected accent; deeper cobalt and blue-violet identify depth and artwork temperature. Glows belong inside panels, while the fixed aura provides a restrained sense of space.
- **Type:** DM Sans for all product and display text; DM Mono for tiny metadata. Strong, tight, sans-serif headings replace the previous serif-led hierarchy.
- **Composition:** long-form studio landing rhythm: one rounded hero window, deliberate bento panels, glow-led feature cards, and repeated section headers. Avoid mixing a standalone editorial “slide” into a dashboard-like section.
- **Interaction:** keep the shared-element artwork transition, real audio controls, keyboard support, loading/error/empty states, and reduced-motion behavior. Motion remains limited to `transform` and `opacity`.

The source of truth for these values is `apps/web/src/styles/tokens.css`; all sections consume the same tokens instead of inventing local palettes.

### Current slice — cool-blue fidelity and accessibility hardening

`DynamicAura` supplies the shared shader-inspired atmosphere with blue light fields, perspective grid, scanline, grain, and pointer parallax. Movement is limited to `transform` and `opacity`, and the aura becomes static under `prefers-reduced-motion`. The Discover, Library, and Words routes use the same tokens and surface treatment.

The keyboard/screen-reader pass now includes a skip link, focusable route landmarks with focus-on-route-change, active navigation semantics, live search/now-playing updates, an Escape-closeable player dialog, and touch targets at least 44 px. Loading, empty, error, offline, missing-artwork, long-title, and lyrics states remain first-class UI states.

### Current slice — personal listening room

The first inner page uses the frozen API contract rather than local sample state. `#library` is a native hash route so the SPA does not need a new router dependency: it loads `/api/me/liked` and `/api/me/recently-played` after the anonymous session is ready, renders loading/error/empty states in the cool-blue system, and optimistically updates likes with rollback when persistence fails. Choosing a track records a recently-played event and keeps the existing player surface open, preserving the same focal object across the route boundary.

The Words route follows the same contract: `#words` keeps the selected song/player alive, renders the pre-parsed `/api/lyrics` response in the shared synchronized lyric component, and hydrates a “Next words” continuation from `/api/songs/:id/suggestions`. Suggestion loading, failure/retry, no-song, and empty-result states are part of the page rather than deferred to a spinner or a broken panel.

All already in Allegra's `package.json`. Two things to remove:
- **`@google/genai`** — unused, and a Google AI dependency in an AWS hackathon works against us. Delete it; if we ship the AI feature it's Bedrock, called server-side.
- **`express`** — unused in the SPA. It moves to `apps/api`.

## Ticket list, in build order

### F1 · Tokens & motion primitives — 1.5 h
Before any component. `src/styles/tokens.css` + `src/motion/index.ts`. Signal-grid palette, surface/radius/shadow tokens, durations, easings, springs, stagger, `prefers-reduced-motion` wrapper. **Every later ticket imports from here — no ad-hoc `duration: 0.3` anywhere in the codebase.**

### F2 · API client + mock — 45 min
`src/lib/api.ts`, typed against `packages/shared`. `VITE_API_BASE_URL` points at the mock server until the real API is live, then flips. **One env var is the entire integration.**
Add TanStack Query if you want caching/retry for free, or hand-roll — but do not scatter raw `fetch` through components.

### F3 · Kill the mock data layer — 1 h
- Delete `sampleData.ts` usage
- `AppContext` keeps UI state (theme, modals, karaoke toggle); **server state moves to the API client**
- **Scrub the hardcoded plaintext credentials** in `AppContext.tsx` (`Password@123`) and `Pages.tsx` (`allegra@pass2025`, `guest-session-pass`). The repo goes public — rotate them if they're real anywhere.
- Auth screen → "Continue" issues an **anonymous JWT**. Keep the screen as an onboarding moment, drop the fake validation.

### F4 · Real audio ⭐ — 2 h
Delete the `setInterval` that fakes `currentTime`. One `<audio>` element at app root, never remounted.

**The three invariants.** Each of these was a real production bug in the reference implementation. Don't rediscover them at 3 AM:

**1. One funnel for play/pause.** Every control calls a single `requestPlayback(playing)`. Never `setIsPlaying(...)` *and* `audio.play()` from a component. The raw setter is reserved for syncing **from** the element's own events.

**2. Load effects must never depend on `isPlaying`.** A `useEffect` listing `isPlaying` in deps that calls `.play()` re-fires on the user's own pause and instantly resumes — **pause appears to do nothing.** Read play state imperatively inside the effect instead.

**3. Seek pauses. Always resume.**
```ts
const wasPlaying = !audio.paused;
audio.currentTime = t;
if (wasPlaying) await audio.play();
```

Also: auto-next on `ended`, plus a "within 0.35 s of duration" fallback that **only fires when state says playing** — otherwise pausing near the end auto-advances.

**DoD:** play, pause, seek, next, and end-of-track all behave. No phantom resume.

### F5 · Search — 1.5 h
Debounced input (250 ms), staggered result grid, recent searches. Skeletons while loading. **Empty state that suggests something**, never a bare "no results."

### F6 · The hero transition ⭐⭐ — 2.5 h
Card → full-screen player as **one continuous shared element** (`layoutId` on the artwork). This is the Best UI money shot and the centrepiece of the demo video. Spec in `07-MOTION-DESIGN-SYSTEM.md` §4. Budget properly — it's worth more than three ordinary features.

### F7 · Player surface — 2 h
Scrubber with real drag physics (pointer events, not `<input type=range>`), spring-loaded transport buttons, ambient background from the artwork's dominant colour, queue sheet.

### F8 · Lyrics panel ⭐ — 1.5 h
Server returns parsed `LyricLine[]`, so this is just: binary-search the last line with `timestamp <= currentTime`, highlight it, smooth-scroll it to the optical centre.
- **Synced and interpolated lyrics use the same render path** — that's the whole point of the interpolation fallback.
- `[INSTRUMENTAL]` renders as a pulsing glyph, not the literal text.
- Click a line → seek to it. Cheap, and it demos beautifully.

### F9 · States & fidelity — 2 h
The unglamorous ticket that wins Best UI. For **every** async surface:
- **Loading** — skeletons shaped like the real content, never a spinner in the middle of a page
- **Empty** — says what to do next
- **Error** — friendly copy + a retry that actually retries
- **Long text** — 60-char titles, 8 artists, Devanagari/Tamil. Clamp with `line-clamp`, marquee **only** the now-playing title, never the grid
- **Missing artwork** — a designed fallback (gradient from the title hash), never a broken-image icon
- **Offline** — a toast, not a crash

### F10 · Responsive — 1.5 h
360 / 768 / 1280 / 1920. Player is a **bottom sheet** on mobile, a **side panel** on desktop. Touch targets ≥ 44 px. Test on a real phone — devtools lies about scroll and safe-area.

### F11 · A11y & reduced motion — 1 h
`prefers-reduced-motion` collapses everything to opacity-only. Keyboard: Space = play/pause, ←/→ = seek 5 s. Visible focus rings. `aria-live` on the now-playing announcement. **Judges do check this, and it's fast.**

### F12 · Perf — 1 h
- Animate **`transform` and `opacity` only**. Never `width`/`top`/`left`/`box-shadow`.
- `will-change` only on the actively animating element, removed after.
- Virtualise any list over ~50 items.
- Lighthouse ≥ 90 performance on the deployed URL.

### F13 · Fonts — 15 min
Story Script, Jim Nightshade, Great Vibes, Average Sans are referenced in `fontFamily` but **never imported** — the branding is currently falling back to system fonts. Add the Google Fonts link with `display=swap` and `preconnect`, or self-host. Check any custom face is actually licensed for the demo.

## Honest note on karaoke mode
The vocal/instrumental sliders are cosmetic and **real stem separation cannot happen client-side** — it needs Demucs/Spleeter on a GPU, 10–60 s per track. Either relabel it a **visual mode** or cut it. Do not ship a slider that does nothing and present it as a feature; a judge who moves it and hears no change has learned something bad about the whole project.
