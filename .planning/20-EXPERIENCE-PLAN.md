# 20 — EXPERIENCE PLAN

Post-hackathon productionisation list. Target: the lyrics stage becomes the thing people screenshot,
and the rest of the app behaves like a shipped product — Apple Music's craft, YT Music's density.

Everything here was checked against the code on 2026-09-21. The `file:line` references are real.

Still binding: `docs/api-contract.md` is frozen (hard rule 1), transform/opacity only (rule 5),
tokens only (rule 6), reduced-motion collapses but never disables (rule 7), no `any` (rule 8).

---

## Tier 0 — signature moments (the "nobody has seen this" work)

### 0.1 Word-level karaoke lyrics ⭐ the headline

**Now:** `KaraokeLine` (`apps/web/src/components/LyricsPanel.tsx:283`) fakes a karaoke sweep by
scaling one span across the whole line, driven by `activeLineProgress()` — linear interpolation
between two line timestamps. It is line-level dressed as word-level, and it is off by default
(`karaokeProgress = false`).

**Ship:**

- `LyricLine` gains `words?: readonly { t: number; d: number; text: string }[]`
  (`packages/shared/types.ts:15`). Optional and additive — **still a contract change. Update
  `docs/api-contract.md` and announce before writing code.**
- Backend (`apps/api/src/services/lyrics.ts`): when a provider returns Enhanced LRC / LRC A2
  (inline `<mm:ss.xx>` word tags) or TTML, parse the syllable timings instead of discarding them.
  LRCLIB is line-level only; BetterLyrics and some mirrors are not.
- Fallback when no word timings exist: distribute the line duration across words weighted by
  syllable count (vowel-group heuristic), not character count. Tag the payload
  `wordTiming: 'exact' | 'estimated'` so the UI stays honest and the demo can pick exact tracks.
- Render: one `motion.span` per word — opacity, scale and colour from `motionTokens` springs, a
  soft gradient wipe across the active word, a longer settle on held syllables. `initial={false}`,
  no layout animation.

### 0.2 Make the shader actually listen

**Now:** `useAudioAnalyser` is real and correct — and its output goes nowhere but a CSS variable
(`App.tsx:699` sets `--audio-level`). Every shader gets a **hardcoded** number:
`WordsPage energy={0.7}` (`App.tsx:976`), `DynamicAura energy={0.55}` (`App.tsx:873`),
hero banner `0.55` (`App.tsx:980`), onboarding `0.58`.

**Ship:**

- Feed `analyser.readLevel()` into a ref-driven energy value. The shader already smooths
  (`displayEnergy += (target - displayEnergy) * 0.06`, `MusicFlowShader.tsx:482`), so this costs
  zero React re-renders.
- Split `readSpectrum()` into three bands → new `uBass` / `uMid` / `uTreble` uniforms. Bass drives
  bloom radius, treble drives rib shimmer. That is the whole difference between "nice gradient" and
  "the room is reacting to the song".
- Respect the hook's own rule: a flat signal means *no data*, so fall back to the current constant,
  never to a dead black screen.

### 0.3 Immersive lyric stage

Full-bleed mode: chrome fades out, the cover shrinks to a floating disc, one line at giant type with
neighbours as depth-blurred ghosts, backdrop palette re-derived per section. `LyricsPanel` already
has the soft-focus track (`ytm-lyrics__focus-track`) — this is a presentation layer over it, plus an
`F` shortcut and a Fullscreen API call.

### 0.4 Shareable lyric card

Select 1–4 lines → render a 1080×1350 canvas: cover, palette gradient (`lib/palette.ts` already
extracts it), the lines in the app's type, artist, small wordmark → Web Share API with a download
fallback. Highest virality-per-hour of anything on this list.

### 0.5 Spatial cover art

Pointer and `deviceorientation` parallax on the now-playing cover with a specular sweep. The
CoverFlow shelf (`components/CoverFlow.tsx`) already proves the 3D stage works and is its natural
home.

---

## Tier 1 — production standard (currently missing outright)

### 1.1 Media Session API — **absent**

No `navigator.mediaSession` anywhere in `apps/web`. That means no lock-screen art, no Windows
volume-flyout controls, no Bluetooth or headset buttons, no car head unit, no keyboard media keys.

- `MediaMetadata` with 512×512 artwork (Chrome Android's target size; 256×256 on low-end devices).
- Handlers: `play`, `pause`, `previoustrack`, `nexttrack`, `seekto`, `seekbackward`, `seekforward`, `stop`.
- `setPositionState({ duration, playbackRate, position })` on `timeupdate` and `ratechange`;
  `null` on stop.
- Every handler routes through `requestPlayback()` — playback invariant 1 applies to the OS too.

### 1.2 PWA — **absent**

No `manifest.webmanifest`, no service worker, no maskable icons (`apps/web/public` holds three
files). Installable app, offline shell, cached fonts and artwork, splash screen.
**Never cache `/api/stream`** — a partial `206` sitting in a SW cache is exactly the silent failure
the byte-range rule exists to prevent.

### 1.3 Link previews — **absent, and it breaks a shipped feature**

`apps/web/index.html` has no `og:*` or `twitter:*` tags. `shareLibrary()` (`lib/api.ts:365`) hands
people a link that unfurls as a blank card in WhatsApp, iMessage and Discord. Needs a
server-rendered meta response for the shared-playlist path carrying the playlist cover, name and
owner.

### 1.4 Gapless / crossfade

Two `<audio>` elements plus a gain ramp on the existing `AudioContext`; 0–12 s user setting.

### 1.5 Sleep timer · playback speed · EQ

The audio graph already exists (`__allegraGraph`), so a `BiquadFilterNode` chain is nearly free.
"Stop at end of track" is the Apple Music detail people notice.

### 1.6 Queue management

`PlayerPanel` renders the queue read-only (`components/PlayerPanel.tsx:248`). Needs drag-to-reorder,
play-next, swipe-to-remove and persistence.

### 1.7 Resume where you left off

Persist song id, position and queue; restore paused on load.

### 1.8 Network resilience

Offline banner, backoff retry on a `403` stream (the API re-resolves — the UI should say so), and a
"reconnecting" scrubber state.

### 1.9 Keyboard layer + `?` sheet

Some handlers exist (`App.tsx:378`, `App.tsx:398`). Complete the set (space, ←/→, J/K/L, M, S, R, L,
F) and add a discoverable shortcut overlay.

---

## Tier 2 — depth

- **Autoplay radio** when the queue empties, using the existing `/suggestions` endpoint plus the AI
  reasoning already fetched as a "why this song" line.
- **Palette theming across the whole shell**, not only the hero — crossfade the tokens.
- **Listening stats page.** `recordRecentlyPlayed` and `sendListenSignal` already write the data.
- **Search polish:** top-result card, recent searches, instant results (abort handling exists).
- **Command palette as a real launcher** — actions, not just search (`components/CommandPalette.tsx`).
- **Artist page:** discography grouped into albums / singles / appears-on.
- **CoverFlow on `AlbumPage`** for consistency with the collection hero.

### Rule violation to fix first

`INITIAL_COMMENTS` (`components/WordsPage.tsx:26`) is three hardcoded fake users with fake like
counts, rendered as though real. CLAUDE.md: *"Don't ship a control that does nothing and present it
as a feature."* Either back it with Convex or label it a demo, the way Karaoke and Premium are.

---

## Tier 3 — hardening

- Code-split the WebGL shader and the lyrics stage (`React.lazy`). `MusicFlowShader` is 572 lines of
  WebGL loaded on every route today.
- Virtualise long track lists.
- Artwork `srcset` / AVIF through the proxy, with LQIP blur-up from the extracted palette.
- Error boundary per route, Web Vitals reported to CloudWatch.
- Shader guards: DPR cap, downgrade to a CSS gradient on low-end or battery-saver, reduced-motion path.
- Accessibility sweep: live region on track change, focus return on dialog close, glass contrast.
- Playwright smoke test: search → play → **206 seek**, plus a Lighthouse budget in CI.

---

## If only seven things get done

1. Word-level karaoke lyrics (0.1)
2. Audio-reactive shader (0.2)
3. Media Session (1.1)
4. Immersive lyric stage (0.3)
5. Shareable lyric card (0.4)
6. PWA and install (1.2)
7. Fix the fake comments (Tier 2)

Items 1, 2 and 4 are one continuous piece of work on one screen — and that screen is the one the app
gets judged on.
