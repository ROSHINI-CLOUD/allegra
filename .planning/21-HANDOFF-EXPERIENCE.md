# 21 — HANDOFF: experience work in flight

Written 2026-09-21, mid-session, so the next person can pick this up cold.
Branch: `infra/vercel-root-build-fix` (nothing committed — see **Repo state**).

Companion doc: `.planning/20-EXPERIENCE-PLAN.md` holds the full prioritised backlog.
This file covers only what is *in flight* and the two defects found during it.

---

## ⚠️ Read first: another session is editing the same files

`git status` shows files this session did not create:

- `apps/web/src/lib/songIdentity.ts` + `songIdentity.test.ts`
- `apps/web/src/components/ArtworkBackground.tsx`
- modified `apps/web/package.json` / `package-lock.json`
- `allegra-search-tmp.json`, `allegra-sugg-tmp.json` (scratch API dumps, delete before committing)

That work already overlaps with **Defect 2** below (`songIdentity` is the dedup key) and it has
already consumed this session's audio probe — `WordsPage` now renders `ArtworkBackground` with
`audio={audio}` where it used to render `MusicFlowShader`. **Reconcile with that session before
touching search dedup or the lyrics backdrop**, or the same feature gets built twice.

---

## 1. Done this session

### 1.1 The shader now listens to the song ✅

Previously every shader got a hardcoded number (`energy={0.7}` etc.) while a perfectly good
`useAudioAnalyser` wrote its output to a single CSS variable and nothing else.

**Changed**

| File | What |
|---|---|
| `apps/web/src/lib/bands.ts` *(new)* | `createBandTracker()` — pure, no Web Audio. Normalises and shapes bass/mid/treble. |
| `apps/web/src/hooks/useAudioAnalyser.ts` | New `readBands()` on the handle; delegates the maths to the tracker. |
| `apps/web/src/components/shader/MusicFlowShader.tsx` | New `uBands` uniform + `audio?: AudioProbe` prop sampled once per frame. GLSL uses it for column height, floor bloom and flute shimmer. |
| `apps/web/src/App.tsx` | `sampleAudio()` / `audioProbe` — one reading per frame, shared by every surface. |
| `DynamicAura.tsx`, `PlayerPanel.tsx`, `WordsPage.tsx` | Pass the probe through. |

**The non-obvious part.** Raw band levels are nearly useless to animate with. Measured against a
real mix in the running app, the bass band sat at **0.77–0.84** — a 4% wander. Driving anything
with that reads as "permanently brighter", not as a beat. So each band is rescaled against its own
running floor and ceiling (snap outward to a new extreme, creep back in slowly), then shaped by an
envelope follower with a fast attack and slow release.

**Verified**

- Live in the browser: `readBands`' data source produces separated, moving values
  (bass 0.77–0.84, mid 0.31–0.52, treble 0.21–0.39 over 2 s of a real track).
- The refactored `--audio-level` path still updates at 60 fps through the new shared cache
  (0.283 → 0.292 while playing).
- No `[MusicFlowShader] compile failed` in the console, so the `uBands` GLSL links.
- `createBandTracker` driven with synthetic input under `node --import tsx`:

  | input | result |
  |---|---|
  | real mix (bass 0.805 ± 0.035) | **full 0→1 swing**, settles in ~41 frames |
  | digital silence | stays 0 ✅ |
  | flat non-zero line (how a CORS-blocked stream reads) | stays 0 ✅ |
  | loud chorus → quiet verse | quiet part regains its full range ✅ |

**Not verified:** the shader visibly reacting on screen. The Claude desktop window was
hidden/minimised for most of the session, which throttles `requestAnimationFrame` to ~3 frames in
5 s and suspends media playback. **Someone should watch it with the window in the foreground and a
song playing** before this is called done.

### 1.2 Media Session API ✅

`apps/web/src/hooks/useMediaSession.ts` *(new)*, called from `App.tsx`.

Lock screen, Windows volume flyout, macOS Now Playing, Bluetooth/headset buttons, car head units,
keyboard media keys. Metadata with artwork declared at 96–512 px, handlers for
play/pause/prev/next/stop/seekbackward/seekforward/seekto, and `setPositionState` for the OS
progress bar.

Two things to preserve if you touch it:

- Every handler routes through `requestPlayback()` / `seek()` — **playback invariant 1**. The OS is
  just another caller of the one funnel, never a second path that sets state and touches the element.
- Handlers are registered **once** and read the current callbacks from a ref. Re-registering them
  each render means calling into the platform 60×/s, and some platforms tear the OS controls down
  and rebuild them when you do.

**Not verified:** the OS-level controls actually appearing. Needs a human on a real desktop/phone.
Check `navigator.mediaSession.metadata` is populated and Windows' volume flyout shows the track.

---

## 2. Defect 1 — white border around the app

**Symptom (user):** a light rounded border frames the whole app on load; clicking anywhere outside
it makes it vanish. It should never appear.

**Root cause:** `apps/web/src/styles/app.css:149`

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 2px solid var(--focus, #111);
  outline-offset: 2px;
}
```

`App.tsx` renders `<main id="main-content" ref={mainRef} tabIndex={-1}>`. That `tabIndex={-1}` makes
it match `[tabindex]`, so when the app focuses `main` programmatically (skip-link target, restored
on route change) the browser paints a 2 px ring around the entire main region. Blurring it by
clicking elsewhere removes the ring — exactly the reported behaviour.

**Fix.** A `tabindex="-1"` element is a programmatic focus *target*, never a keyboard-tabbable
widget, so it should not carry a widget focus ring. Narrow the selector, keeping the `:not()` inside
`:where()` so specificity stays at zero:

```css
:where(a, button, input, select, textarea, [tabindex]:not([tabindex='-1'])):focus-visible {
  outline: 2px solid var(--focus, #111);
  outline-offset: 2px;
}
```

**Check before shipping:**

- Roving-tabindex components still get their ring — `CoverFlow` cards are `<button tabIndex={-1}>`
  for the off-centre ones, and the centre card is `tabIndex={0}`; both still match `button`.
- Skip-link users lose the "you have landed here" confirmation. If that matters, give
  `#main-content:focus-visible` a deliberate, quieter affordance instead of the full-page ring.
- Sweep every other `tabIndex={-1}` in the app for a focus ring that was load-bearing.

---

## 3. Defect 2 — search returns the same song twenty times

**Symptom (user):** searching "Please Please Please" returns ~20 rows of the same Sabrina Carpenter
recording, each carrying a *different* compilation cover — "Musique pour faire la cuisine",
"Chic Pop", "Summer Dinner Party", "Cozy Gaming", "Bridal Party 2026"… The official
*Short n' Sweet* release is buried at row 13. The queue then fills with 20 copies of one song.

**Root cause:** the collapsing already exists — but only on the home shelves, never on search.

- `apps/api/src/catalog/catalog.ts:217-230` — the home path builds `const seen = new Set<string>()`
  and skips anything whose `songIdentity(song)` was already used. Its own comment says the provider
  "lists the same recording several times over (one row per release)".
- `apps/api/src/catalog/catalog.ts:34-60` — `search()` returns `normalizeMany(raw, source)` with
  **no collapsing at all**.
- The key itself is `songIdentity()` at `apps/api/src/lib/normalize.ts:52`: lowercased title with
  bracketed suffixes stripped, plus sorted artist tokens. It is the right key and it already works.

`/suggestions` should be checked for the same gap — "similar songs" made of twenty identical rows
is the same bug wearing a different hat.

**What the user asked for**

1. Only the official version in the results.
2. Similar songs *of the official ones*.
3. A small "more" affordance that opens the repeated versions, rather than hiding them entirely.

### Implementation plan

**Step 1 — group instead of dedupe (API).** In `search()`, group by `songIdentity()`, elect one
canonical row per group, keep the rest as variants.

**Step 2 — electing the canonical row.** In order:

1. Highest `playCount`. On Saavn the official release dominates its compilation copies by orders of
   magnitude, and this is the one signal that needs no curation.
2. Prefer a row whose `artist` is the real primary artist over "Various Artists".
3. Prefer a row whose `album` is not shared with unrelated artists (a compilation's album name
   attaches to many different primary artists; a real album's does not). This is computable from
   the result set itself.

Resist a blocklist of playlist-sounding album names — "Chic Pop" and "Cozy Gaming" are guessable,
the next thousand are not.

**Step 3 — the contract.** `docs/api-contract.md` is frozen (hard rule 1), so this needs the doc
updated and announced *before* the code. Two options:

| | Shape | Cost |
|---|---|---|
| **A (recommended)** | Each search result gains `variants?: UnifiedSong[]` | Contract change; one round trip; UI can expand instantly |
| **B** | Collapse on the frontend only | No contract change; still ships 20 rows per song over the wire and every client re-implements the election |

**Step 4 — UI.** `SongCard` gains an optional "N other versions" chip, opening the group in a sheet
or expanding it inline. Keep it small and secondary — it is an escape hatch, not a feature.

**Step 5 — queue hygiene.** Whatever the queue is built from must use the collapsed list, or
"play all" still enqueues twenty identical tracks.

**Watch out:** do not collapse genuinely different recordings. `songIdentity` strips bracketed
suffixes, so "Song (Live)", "Song (Acoustic)" and "Song (From \"Film\")" all fold into the same key.
For *search* that is probably too aggressive — a live version is a different thing a user may want.
Consider keeping the bracketed qualifier in the key for search while leaving the home shelves as
they are.

---

## 4. Repo state

**Gates at time of writing**

```
npm run typecheck   → clean
npm run lint        → clean
npm test            → NOT RUN since these changes (api tests + infra only; apps/web has no runner)
```

`npm test` still needs running before any commit.

**Uncommitted**, and mixing this session's work with the parallel session's and with pre-existing
changes on the branch. Untangle before committing:

- *This session:* `lib/bands.ts`, `hooks/useMediaSession.ts`, `hooks/useAudioAnalyser.ts`,
  `shader/MusicFlowShader.tsx`, `App.tsx`, `DynamicAura.tsx`, `PlayerPanel.tsx`, `WordsPage.tsx`,
  `.planning/20-EXPERIENCE-PLAN.md`, this file.
- *Parallel session:* `lib/songIdentity.ts`(+test), `components/ArtworkBackground.tsx`,
  `apps/web/package.json`.
- *Pre-existing on the branch:* the `apps/api` route changes, `apps/api/src/mcp/`,
  `docs/mcp-contract.md`, `convex/_generated/`.
- *Delete:* `allegra-search-tmp.json`, `allegra-sugg-tmp.json`.

Suggested commits, on an `fe/` branch:

```
feat(web): drive the ambient shader from the live audio spectrum
feat(web): publish now playing to the OS via Media Session
fix(web): stop the skip-link target painting a focus ring round the app
```

**Environment note.** This session started a second API dev server on 8080 that collided with the
one already running, which caused a burst of 502s in the browser. It has been stopped, but the
original `npm run dev` may need restarting. Also expect a React "change in the order of Hooks"
error in the console from Fast Refresh after `useMediaSession` was added — it is an HMR artifact and
a hard reload clears it, but **confirm that with a hard reload** rather than assuming.

---

## 5. Suggested order from here

1. Defect 1 (one-line CSS fix, visible to every user on every load).
2. Defect 2, coordinated with the parallel `songIdentity` work — contract doc first.
3. Foreground verification of the audio-reactive shader and the OS media controls.
4. Then back to `.planning/20-EXPERIENCE-PLAN.md`: word-level karaoke lyrics (0.1), the immersive
   lyric stage (0.3), the shareable lyric card (0.4), PWA (1.2), and the fake-comments rule
   violation in `WordsPage.tsx`.
