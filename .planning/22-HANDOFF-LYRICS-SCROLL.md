# 22 — Handoff: Lyrics scroll / seek / reopen bug

**Date:** 2026-09-21  
**Status:** INCOMPLETE — interrupted mid-fix. Next agent should finish and verify in browser.  
**Do not restart from scratch.** Most of the scroll rewrite is already in `LyricsPanel.tsx`.

---

## User request (exact intent)

On the dedicated Words / lyrics stage (`#words`):

1. **Must be able to scroll lyrics** (currently felt impossible / stuck).
2. Scroll must feel **smooth**.
3. **Click any line → seek there and start playing** from that line.
4. **Reopen bug:** close Words stage and reopen → sometimes lyrics only show from the *next* line onward (earlier/current lines missing or unreachable). Find and fix if still present.

Preferred UX (user declined a picker; use this):  
**Free scroll + auto-follow resumes ~2s after the user stops** (Apple Music style).

---

## Root cause already diagnosed

Old soft-focus implementation used:

- `overflow: hidden` on `.ytm-lyrics__stage`
- `transform: translate3d(0, focusOffset, 0)` on `.ytm-lyrics__focus-track`
- `focusOffset` accumulated via `setFocusOffset(current => current + delta)`

Effects:

- Past lines were clipped above the viewport and **not reachable** → “can’t scroll”.
- On remount/reopen, transform math / mid-song `activeIndex` made it look like lyrics started from the “next” line.

---

## What is already done

### `apps/web/src/components/LyricsPanel.tsx` (rewritten, on disk)

- Soft-focus now uses a **single native scroll container** (`.ytm-lyrics__scroll` / `.ytm-lyrics__scroll--soft`).
- Auto-follow scrolls active line to ~40% with `scrollTo({ behavior: 'smooth' })`.
- User wheel/touch/scroll **pauses follow** for `FOLLOW_RESUME_MS = 2200`, then resumes.
- Programmatic scrolls are gated with `programmaticScrollRef` so they don’t trip pause.
- New optional prop: `onActivateLine?: (timestamp: number) => void`.
- Line click calls `onActivateLine` if provided, else `onSeek`.
- Song/lyric-set change resets scroll + follow via `songKey`.

### `apps/web/src/styles/components.css` (partially updated)

Already present:

- `.ytm-lyrics__scroll` → `overflow-y: auto`, smooth scroll, touch scrolling
- `.ytm-lyrics__scroll--soft` → taller padding + `scroll-padding-block`
- `.ytm-lyrics.is-user-scrolling .ytm-lyrics__scroll` → `scroll-behavior: auto`
- `.ytm-lyrics--nobackdrop .ytm-lyrics__scroll` → flex fill
- Stage chrome hidden when `hideBackdrop` (Words stage owns transport/translate)

**Still leftover / dead CSS** (safe to delete once confirmed unused):

- `.ytm-lyrics__stage`
- `.ytm-lyrics__focus-track`

Around `components.css` ~2262–2277.

---

## What is NOT done (finish these)

### 1. Wire “tap line → seek + play”

`LyricsPanel` supports `onActivateLine`, but **call sites are not wired**.

**Words stage** — `apps/web/src/components/WordsPage.tsx`  
Currently only passes `onSeek={onSeek}` into `LyricsPanel`. Add:

```tsx
onActivateLine={(time) => {
  onSeek(time);
  onToggle?.(); // BAD if already playing — see below
}}
```

Better: add an explicit prop from App, e.g. `onActivateLine`, that does:

```ts
await audio.seek(time);
await audio.requestPlayback(true); // always start (or resume) from that line
```

Respect playback invariants in `CLAUDE.md`:

- One funnel: use `requestPlayback(true)`, not raw `audio.play()` + `setIsPlaying`.
- Seek already pauses-then-resumes if it *was* playing; for “tap line starts playback”, always call `requestPlayback(true)` after seek.

**Also wire:**

- `App.tsx` WordsPage call site (`<WordsPage ... />`) — pass `onActivateLine`.
- Discover teaser `LyricsPanel` in `App.tsx` (`#words` teaser section) — same behavior if softFocus there.
- `PlayerPanel` lyrics path if it uses `LyricsPanel` with seek only.

### 2. Confirm reopen bug is gone

Repro:

1. Play a song, open `#words`, let lyrics advance several lines.
2. Leave Words (`Back` / `#discover`).
3. Re-enter `#words` without changing track.
4. Confirm: active line visible near center, **earlier lines scrollable above**, not clipped away.

If still broken, check:

- `songKey` may be identical on reopen (same lines) so scroll reset is skipped — on remount `scrollTop` starts at 0, then auto-follow should jump to `activeIndex`. If follow is paused or layout height is 0 on first frame, follow may miss. Fix: after mount, `requestAnimationFrame` (or double rAF) call `scrollActiveIntoView('auto')` once when `lines.length > 0`.

### 3. Cleanup dead CSS

Remove unused `.ytm-lyrics__stage` / `.ytm-lyrics__focus-track` blocks if nothing references them (`rg` first).

### 4. Verify parent overflow chain

Words stage must actually allow the scroll child to shrink:

- `.ytm-stage-tab-content`, `.ytm-stage-right`, `.ytm-lyrics--nobackdrop` need `min-height: 0` + flex column (mostly already true).
- If scroll still doesn’t move, inspect computed `overflow` / height on `.ytm-lyrics__scroll` in DevTools.

### 5. Browser verification (required)

Use gstack browse (`browse.exe` on this machine) or equivalent:

1. `#discover` → play a track → `location.hash = '#words'` (hash change keeps React audio state; full `goto #words` may lose it).
2. **Scroll** lyrics with wheel/touch — must move; past lines reachable.
3. Stop scrolling → after ~2s auto-follow resumes.
4. **Click a past/future line** → audio seeks there **and plays**.
5. Leave Words, reopen → full lyric list reachable; not “from next line only”.
6. Desktop **and** mobile (390×844).
7. `npm --prefix apps/web run typecheck` + lint.

---

## Related recent work (context, don’t redo)

Already shipped earlier in this session (leave alone unless regressing):

| Area | Files | Notes |
|------|--------|------|
| Ambient lyrics backdrop | `DynamicLyricsBackground.tsx`, `app.css` `.music-background` | No blur, 2 gradient layers, transform-only |
| Words stage transport UI | `WordsPage.tsx`, `App.tsx` props, `components.css` | Play/pause/seek/prev/next on stage |
| Mobile stage layout | `components.css` `@media (max-width: 1024px)` | Art 112px + transport grid |

Ambient motion / stage chrome are **not** this ticket unless they block scrolling.

---

## Constraints (Allegra rules)

- Animate only `transform` / `opacity` for motion chrome; native scroll is fine.
- No WebGL on Words backdrop.
- Duration always seconds.
- No `any`.
- Don’t silently change `docs/api-contract.md`.
- Verify before claiming done.

---

## Suggested first commands for next agent

```bash
# Confirm current LyricsPanel API
rg -n "onActivateLine|scrollActiveIntoView|FOLLOW_RESUME" apps/web/src

# Find unwired call sites
rg -n "<LyricsPanel|<WordsPage" apps/web/src

# Dead CSS?
rg -n "ytm-lyrics__stage|ytm-lyrics__focus-track" apps/web/src
```

Then: wire `onActivateLine` → typecheck → browser repro for scroll + tap-play + reopen.

---

## Acceptance checklist

- [ ] Words stage lyrics scroll smoothly (wheel + touch)
- [ ] Past and future lines are reachable (not clipped)
- [ ] Auto-follow resumes ~2s after user scroll
- [ ] Tap any line seeks to that timestamp and plays
- [ ] Close/reopen Words mid-song: active line visible; earlier lines still scrollable
- [ ] No regression to stage transport / ambient backdrop
- [ ] `npm --prefix apps/web run typecheck` and lint green
- [ ] Browser verified desktop + mobile

---

## Screenshot refs (prior UI, optional)

- `docs/reference-assets/lyrics-ui-after.png`
- `docs/reference-assets/lyrics-ui-after-mobile.png`
- `docs/reference-assets/lyrics-ambient-moving.png`
