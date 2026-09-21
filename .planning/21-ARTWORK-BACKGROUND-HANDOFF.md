# 21 — Artwork Background Handoff

Written 2026-09-21, handing off mid-build because the current session is out of budget.
**Nothing below has been run in a browser yet.** It was written against PixiJS's type
declarations and the existing codebase's patterns, not verified live. Treat it as a strong
first draft, not working code, until someone loads `/#words` with a song playing and looks.

## ⚠️ Read this first: another agent is editing this repo concurrently

Partway through this session, files started changing on disk that nobody in this
conversation touched — `App.tsx`, `DynamicAura.tsx`, `PlayerPanel.tsx`,
`MusicFlowShader.tsx`, `useAudioAnalyser.ts` gained a full audio-band system
(`readBands()`, `AudioProbe`, `uBands` uniform) that this session did not write. New files
appeared too: `useMediaSession.ts`, `lib/bands.ts`, `lib/songIdentity.ts` (+ test), and
`.planning/20-EXPERIENCE-PLAN.md` — a broader roadmap for this same "lyrics screen" area,
written by that other agent. **Before touching anything below, run `git status` and
`git diff` and actually read what's there now.** This document describes state as of this
session's last look; it may already be stale.

`.planning/20-EXPERIENCE-PLAN.md` §0.2 ("Make the shader actually listen") is that other
agent's version of the audio-reactivity work — it looks materially done already
(`WordsPage.tsx` passes `audio={audioProbe}` down to the shader, bands feed `uBands` in
`MusicFlowShader.tsx`). Don't redo it. This handoff is scoped to the **artwork-texture
background pipeline**, which is a separate, additive piece: `ArtworkBackground.tsx` is a
new component that *replaces* the old `MusicFlowShader` call specifically on the words
stage (`WordsPage.tsx`), not the shared shader used elsewhere (hero banner, `DynamicAura`,
`PlayerPanel`) — those still run the procedural glass-flute shader and are untouched.

## Why this exists

User asked to enhance the lyrics-stage background. Mid-conversation they pasted a detailed
reverse-engineering writeup of Apple Music Web's fullscreen lyrics background (source:
aadishv.dev/music) and asked for the full pipeline: **not** gradient blobs from 3 extracted
colours, but the actual cover art, duplicated at multiple scales, rotated/orbited very
slowly, twisted, heavily blurred and saturated until no artwork detail survives — only
colour relationships. Reference implementation: PixiJS + pixi-filters (twist, Kawase blur,
adjustment/saturation). The reference OSS project (AMLL) is AGPL-3.0 — **do not copy its
code**, it was reference-only for behavior, not a dependency or source.

## What's done

1. **Dependencies added** (`apps/web/package.json`, already `npm install`ed):
   - `pixi.js@^8.21.0`
   - `pixi-filters@^6.1.5`
   Both confirmed compatible (`pixi-filters` v6 peer-requires `pixi.js >=8.0.0-0`).

2. **New component**: `apps/web/src/components/ArtworkBackground.tsx`
   - Props: `artworkUrl: string | null`, `audio?: AudioProbe` (imported from
     `./shader/MusicFlowShader` — that type is already exported there by the other agent's
     work), `palette?: Palette | null`, `light?: boolean`, `className?: string`.
   - 4 sprite layers per scene at ratios `1.25 / 0.8 / 0.5 / 0.25` × `max(viewportW,
     viewportH)`, each with a slow independent rotation speed (0.026–0.07 rad/s); the two
     smaller layers (0.5, 0.25) also orbit the centre at small radii with opposite phase.
   - Filters on one shared `stageContainer` (composite-then-distort, matching the spec's
     pipeline order): `TwistFilter` (primary, angle ≈ −3.2 rad) + a second weaker
     `TwistFilter` (angle ≈ 0.85 rad, different offset) for the "two distortion fields"
     enhancement the user's spec explicitly asked for → `AdjustmentFilter` (saturation
     ≈2.3, contrast ≈1.07) → `KawaseBlurFilter` (strength scaled by viewport, quality 4,
     clamp true). `filterArea` is set explicitly to a padded rectangle covering the
     viewport, because the sprites intentionally extend past it and Pixi's default
     filter-bounds auto-detection would otherwise clip them.
   - Track crossfade: on `artworkUrl` change, loads the new texture (`new Image()` +
     `crossOrigin='anonymous'` + `.decode()`, same pattern as `lib/palette.ts`'s
     `extractPalette`), builds a second "incoming" scene, fades it in / fades the old one
     out over 1.1s with an ease-out-cubic curve, then destroys the old scene's
     container+texture. If a second song arrives mid-crossfade, the in-flight "incoming"
     scene is promoted to "current" instantly rather than stacking a third scene.
   - Audio reactivity: tiny (≤5%) modulation of saturation and primary-twist radius from
     `audio.bass`, eased — per the user's pasted spec's explicit instruction ("users should
     feel it, not see it bounce").
   - `prefers-reduced-motion`: rotation/orbit stops advancing (checked before the clock
     accumulator increments); crossfade still runs (it's an opacity fade, which is exactly
     what CLAUDE.md rule 7 wants reduced motion to collapse to, not disable).
   - Visibility handling: `IntersectionObserver` + `document.visibilitychange`, mirroring
     `MusicFlowShader.tsx`'s existing pattern — ticker work is skipped, not torn down,
     when hidden.
   - FPS cap via `app.ticker.maxFPS` (18 mobile / 28 desktop) and `resolution` scaled down
     further on mobile, per the spec's 24–30fps-desktop / 15–24fps-mobile target (the
     60fps UI is untouched — this only throttles the Pixi ticker).
   - Cleanup: `app.destroy(true, { children: true, texture: true })` and explicit
     `texture.destroy(true)` on scene teardown, to avoid the GPU-memory leak the spec
     explicitly calls out under rapid song switching.
   - Failure path: if the image fails to decode (CORS, 404, etc.), `loadTexture` catches
     and returns `null`; the component silently keeps whatever scene it already has (or
     none), and the CSS fallback layer underneath (see below) keeps the stage from going
     blank.

3. **Wiring**: `WordsPage.tsx` — removed the `MusicFlowShader` import/usage in the
   `.ytm-stage-container` block, replaced with
   `<ArtworkBackground artworkUrl={song.artwork} audio={audio} palette={palette} light={light} />`.
   Also removed the now-dead `energy` prop from `WordsPageProps` and its destructuring
   (was only ever used by the old shader call), and removed the matching `energy={0.7}`
   from the `<WordsPage>` call site in `App.tsx`. **Nothing else in `App.tsx` touches
   `ArtworkBackground`** — hero banner, `DynamicAura`, `PlayerPanel` still render the old
   `MusicFlowShader`/glass-flute background untouched, by design (user chose "replace on
   the lyrics screen" specifically, not app-wide).

4. **CSS** (`apps/web/src/styles/app.css`, new section right after the existing
   `.app-shell[data-theme='light'] .ytm-stage-veil` block, search for "Words stage
   backdrop"):
   - `.artwork-bg` — the wrapper (`position:absolute; inset:0; z-index:0;
     pointer-events:none; overflow:hidden`), same slot the old `.ytm-stage-shader` filled.
   - `.artwork-bg-fallback` — flat colour floor (`color-mix` of the palette primary),
     visible before the first texture decodes or on total failure. Reads
     `--artwork-bg-fallback`, set inline from `palette.primary`.
   - `.artwork-bg-canvas` — hosts the Pixi canvas (`display:block; width/height:100%`).
   - `.artwork-bg-veil` — flat dark scrim, opacity adaptive to artwork luminance (computed
     client-side in the component from `palette.primary`'s hex, no new dependency).
   - `.artwork-bg-vignette` — edge darkening.
   - Light-theme variants for all three, mirroring the existing
     `.app-shell[data-theme='light'] .ytm-stage-veil` treatment (light tint instead of
     black).
   - **Did not touch** `.ytm-stage-shader canvas { filter: saturate(1.38) ... }` — that
     rule still exists in `app.css` but no longer applies to anything (the new component
     doesn't use the `ytm-stage-shader` class, deliberately, to avoid double-saturating on
     top of the GLSL/Pixi-side `AdjustmentFilter`). It's dead CSS now if the old shader
     truly isn't used anywhere else with that class — **verify this**, and delete the rule
     if so, rather than leaving orphaned CSS.

5. **`useAudioAnalyser.ts`**: exported `AnalyserHandle` (was a private interface) — small,
   harmless, done early in the session before the concurrent-editing was discovered. Not
   currently imported anywhere new by this session's own work (the audio-band system the
   other agent built uses its own `AudioBands`/`AudioProbe` types instead), so double-check
   this export is still needed or revert it if unused.

6. **Unrelated but shipped this session**: fixed a real responsive bug in
   `.words-ytm-bar` (the immersive-stage header) that had zero CSS anywhere and broke
   badly on mobile — see `app.css`, search "Words stage top bar". Verified working at
   390/700/1440px via screenshots. This is done and unrelated to the artwork work; no
   action needed.

## What's NOT done / must happen next, in order

1. **Run it.** Start the dev server (`npm run dev` in `apps/web`), start the API
   (`apps/api`) or accept it'll 500 and just check the layout/console doesn't explode,
   navigate to `#words` with a song loaded, and look. Expect Pixi/TypeScript issues on
   first compile — this was never built end-to-end. Check the browser console for shader
   compile errors from `pixi-filters` and for CORS errors on the artwork `<img>`-equivalent
   texture load (the app's other `<img>` tags already use `crossOrigin="anonymous"`
   successfully, per `lib/palette.ts`'s working `extractPalette`, so the artwork host is
   very likely CORS-clean — but confirm, don't assume).

2. **`npm run typecheck` / `npm run lint`** in `apps/web` — both were clean as of this
   session's last run, but the concurrent agent may have since touched shared files
   (`MusicFlowShader.tsx` exports `AudioProbe`/`AudioReading` that `ArtworkBackground.tsx`
   depends on — if those get renamed/removed, this breaks). Re-run before doing anything
   else.

3. **Visual tuning.** Every numeric constant in `ArtworkBackground.tsx` (rotation speeds,
   orbit radii, twist angle/radius, saturation, contrast, blur strength, veil opacity
   curve) is a first guess from the user's pasted spec's "starting values" section, not
   tuned against real album art. Test with: bright cover, dark cover, monochrome cover,
   highly saturated cover, near-white cover — the spec explicitly lists these as the
   acceptance test. Likely needs iteration; don't treat the current numbers as final.

4. **Performance check on real hardware**, especially mobile. `resolution` and `maxFPS`
   are throttled but untested. Watch for GPU stalls, dropped frames on the 60fps lyric UI
   sitting on top of the 20-30fps Pixi background.

5. **Reduced motion**: verify the static-composition path actually looks intentional
   (not just "frozen mid-rotation at an arbitrary angle") — the spec wants "one beautiful
   static blurred/distorted composition", which may need `layoutScene` called once at a
   fixed nice-looking `elapsed` value (e.g. 0) rather than whatever `clockSeconds` happens
   to be paused at.

6. **Rapid song-switching stress test** — spec explicitly calls this out. Skip through
   5-10 songs fast and confirm no stacked scenes, no GPU memory growth (check via
   `performance.memory` or DevTools), no visual pop/flash.

7. **Delete the dead `.ytm-stage-shader canvas` filter rule** in `app.css` if confirmed
   unused (see item 4 above under "What's done").

8. **Cross-reference `.planning/20-EXPERIENCE-PLAN.md`** before starting new work — it's a
   fuller roadmap for this same screen (word-level karaoke lyrics, Media Session API,
   shareable lyric cards, etc.) written by the other concurrent agent. Don't duplicate
   effort; §0.2 there is already largely built.

## Explicitly deferred / decided against this session

- **Full PixiJS pipeline app-wide**: scoped to the words/lyrics stage only, per the user's
  own chosen option. Hero banner, `DynamicAura`, `PlayerPanel` keep the existing procedural
  shader.
- **Lyric-line-sync flash on the new background**: considered, dropped. The user's pasted
  spec is explicit that this should read as calm/ambient, not reactive to every event
  ("never scale the entire background on bass hits" / "not a music visualizer") — a
  per-line flash would fight that aesthetic. If wanted later, it belongs on the lyric text
  itself (already has karaoke/opacity tiers in `LyricsPanel.tsx`), not the backdrop.
- **Karaoke mode toggle** (`LyricsPanel`'s existing `karaokeProgress` prop, currently
  `false` by default and not passed by `WordsPage.tsx`): discussed as a quick creative win
  earlier in the session but **not applied** — got superseded by the bigger artwork-pipeline
  ask before it landed. Still a good, nearly-free next step:
  `<LyricsPanel ... karaokeProgress />` in `WordsPage.tsx`. Note `.planning/20-EXPERIENCE-PLAN.md`
  §0.1 wants to go further (real word-level timing from the backend, a contract change) —
  turning on the existing line-level version is a much smaller, immediately-available
  interim step, not a replacement for that larger item.
- **Palette-colored `.art-playing-glow`**: found this CSS uses a hardcoded cyan
  (`rgba(56, 189, 248, 0.5)`, `components.css` search "art-playing-glow") instead of the
  song's actual palette — same hardcoded-cyan bug also present in
  `.ytm-lyrics__line.is-active`'s `text-shadow` (`components.css` search "ytm-lyrics__line.is-active").
  Both are one-line fixes (swap to `var(--art-primary, ...)`), identified but **not
  applied** — deprioritized in favor of the artwork pipeline. Good quick win for whoever
  picks this up next.
- **Active-lyric-line typography vs. the user's pasted spec**: the soft-focus stage
  override (`components.css`, search "Soft-focus lyrics") currently does
  `.ytm-lyrics__line.is-active { transform: none !important; text-shadow: none !important; }`
  — it strips the nice active-line treatment that exists in the base rule just above it.
  The user's spec wants active-line weight 650-750 and a subtle scale (1.01-1.025). Noted,
  not fixed.

## Files touched this session (for `git diff` reference)

- `apps/web/package.json`, `apps/web/package-lock.json` — pixi deps
- `apps/web/src/components/ArtworkBackground.tsx` — new, untracked
- `apps/web/src/components/WordsPage.tsx` — swapped shader for `ArtworkBackground`,
  removed dead `energy` prop
- `apps/web/src/styles/app.css` — new `.artwork-bg*` rules, plus the earlier (unrelated,
  done) `.words-ytm-bar` responsive fix
- `apps/web/src/hooks/useAudioAnalyser.ts` — exported `AnalyserHandle` (verify still
  needed, see above)
- `apps/web/src/App.tsx` — one-line edit (dropped `energy={0.7}` from the `WordsPage` call)
  on top of whatever the concurrent agent already changed there — **re-diff before
  trusting this file's state**
