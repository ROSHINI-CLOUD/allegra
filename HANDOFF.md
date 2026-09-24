# Allegra — agent handoff

## Status update (2026-09-24, second session)

- **Dependencies repaired:** root `node_modules` was half-deleted; `npm ci` from the lockfile fixed it (lockfile untouched).
- **Baseline green:** `packages/shared/types.ts` regained `MotionArtwork` (shape from `docs/api-contract.md`). typecheck, lint, tests all pass (API 148, web 54, infra 10). The API had 190 tests before the incident; the missing ones were in the lost files.
- **Env files recreated from the templates:** `apps/api/.env` (from `.env.example`; `JWT_SECRET` is still the placeholder, so set a real one) and `apps/web/.env.local` (blank = same-origin API, guest-only). No Convex or provider secrets were recovered: the replayed `.env` was an older LLM-era file with no Convex values.
- **Recovery replay:** output saved to `.planning/recovery/replayed/` (17 `.ts` files, **not** applied to `src`). The MOD files are fragments (24 edits did not apply) and would break the build. The NEW files (`animatedArtwork`, `youtubeMusic`, `youtubeRelated`, `songRelations`, `plays`, `services/canvas.ts`) are usable as a starting point for rebuilding `/api/canvas` and the relations-based recommendations. **Still missing server-side:** `GET /api/canvas` and `GET /api/lyrics/alternatives`. The web app calls both; it degrades quietly (no motion art; "Other lyrics" shows an error).
- **Task A (karaoke mix): done.** See `lib/karaokeMix.ts`, `components/KaraokeMixSheet.tsx`, worker/session/player changes. Tested in the browser: gestures, basic-mode lock, Escape/outside press, and that playback survives. **Not tested:** the AI two-stem path end to end (needs the ~750 MB model download).
- **Task B (settings page): done.** `/settings`, `lib/settings.ts` (`allegra-settings-v1`), `hooks/useSettings.ts`, `components/SettingsPage.tsx`, `app/Telemetry.tsx`.

---

Written at the end of a long session. Read this top to bottom before touching anything.
Project rules live in `CLAUDE.md` and `docs/architecture.md`; this file only covers what is
new, broken, or unfinished. Branch: `feat/browser-live-karaoke`, remote: `fork`.

---

## 0. READ FIRST — data-loss incident (needs a human decision)

While verifying my commit I created a temporary git worktree and junction-linked its
`node_modules` folders to the real ones. Removing that worktree with
`git worktree remove --force` followed the junctions (npm workspace links) and **deleted
files in the real repo**:

| Lost | State now |
|---|---|
| everything in `apps/api/` (incl. **uncommitted** edits and **untracked** files) | tracked files restored from `HEAD` (`87cdae0`+); uncommitted WIP is gone |
| `packages/shared/` incl. uncommitted `types.ts` edits | restored from `HEAD`; WIP gone |
| `apps/api/.env`, `apps/web/.env.local` | **gone** — not in git |
| `apps/web/.env.example`, `apps/web/.gitignore` | restored from git |
| `apps/web/src`, `convex/`, everything else | **untouched** |

Then `npm install` was run (repairs `node_modules`; it briefly rewrote `package-lock.json`,
which was reset with `git checkout -- package-lock.json`).

### Files that existed as uncommitted WIP in `apps/api` before the incident
(from the `git status` at the start of the session)

Modified: `.env.example`, `app.routes.test.ts`, `app.ts`, `auth/auth.ts`, `config.test.ts`,
`config.ts`, `createAppFromEnv.ts`, `db/convex.test.ts`, `db/convex.ts`, `providers/itunes.ts`,
`routes/lyrics.ts`, `routes/user.ts`, `services.ts`, `services/lyrics.ts`,
`services/recommendationContext.ts`, `services/recommendations.test.ts`,
`services/recommendations.ts`, `types.ts`, `user/store.ts`, plus `packages/shared/types.ts`.

Untracked: `providers/animatedArtwork(.test).ts`, `providers/appleMusicCanvas(.test).ts`,
`providers/unison(.test).ts`, `providers/youlyplus(.test).ts`, `providers/youtubeMusic(.test).ts`,
`routes/canvas.ts`, `services/canvas.ts`, `services/songRelations(.test).ts`,
`services/youtubeRelated(.test).ts`, `user/plays(.test).ts`.

### Recovery already attempted
- Recycle Bin, VS Code / Windsurf / Cursor local history, shadow copies: **nothing** (no `allegra` entries).
- No recovery tool installed (no `winfr`, Recuva, PhotoRec), single `C:` drive.
- **Transcript replay (not applied).** Earlier Claude Code sessions logged every `Write`/`Edit`
  in `C:\Users\nithy\.claude\projects\C--Users-nithy-Desktop--website-production-allegra-aws\*.jsonl`.
  A replay script is saved at `.planning/recovery/replay.py`
  (`python .planning/recovery/replay.py` is a dry run that only prints; add `--apply` to write).
  Dry run said it can restore ~18 files: `animatedArtwork(.test)`, `youtubeMusic(.test)`,
  `songRelations(.test)`, `youtubeRelated(.test)`, `plays(.test)`, `services/canvas.ts`,
  the API `.env`, and partial edits to `db/convex.ts`, `routes/user.ts`, `services.ts`,
  `recommendationContext.ts`, `recommendations.ts`, `user/store.ts`.
  **Applying was blocked by the permission classifier** (overwrite of existing files) and I did
  not work around it. If you run it, run the dry run first and review; it is a *partial*
  reconstruction (edits made by Codex, in an editor, or via Bash are not in the transcripts,
  and `unison`, `youlyplus`, `appleMusicCanvas`, `routes/canvas.ts` were never written by Claude).
  After applying: `npm run typecheck && npm run lint && npm test` — expect gaps.
- A disk-wide search for other copies of `animatedArtwork.ts` (Desktop/Documents/Downloads/.claude) found none.
  The `graft/` folder in the repo has small per-file summary cards (e.g. `graft/apps/api/src/providers/animatedArtwork.md`, ~1.4 KB)
  that list exported symbols/spans — useful as a spec when rewriting lost files, not as source.
- Best remaining hope: another copy of the project (zip, other clone, OneDrive, phone backup,
  Codex working folder) or a file-recovery tool run **before** much more is written to `C:`.

### Secrets to recreate
`apps/api/.env` (see `apps/api/.env.example`) and `apps/web/.env.local` (`NEXT_PUBLIC_*` only).
Values live in the Convex dashboard, Vercel project env, and each provider's dashboard.
Without them the app still runs guest-only with in-memory data (see `CLAUDE.md`).

### Lesson for whoever continues
Never junction/symlink `node_modules` into a scratch worktree and then `--force` remove it.
To verify a commit in isolation: `git worktree add` → run a real `npm ci` in it (slow but safe),
or just typecheck the staged tree another way.

---

## 1. What is already shipped (pushed, commit `6315682` on `fork/feat/browser-live-karaoke`)

Only my hunks were committed; none of the user's other WIP. Verified in a clean HEAD copy:
`tsc` and `eslint` clean.

1. **Lyrics sync nudge** — `apps/web/src/components/LyricsPanel.tsx`
   `syncOffset` state (seconds, ±5, 0.1 steps). `syncedTime = currentTime - syncOffset` drives
   `findActiveLine` / karaoke line progress. `+` delays lyrics, `−` shows them earlier.
   Tapping the value resets it. Resets on song change (`songKey` effect). Seeking from a line
   goes to `timestamp + syncOffset`. Frosted pill = `.lyrics-sync` in `styles/app.css`
   (hidden when `compact`).
2. **Fog fix** — `styles/app.css` (end of file). Top fog height 34% → 18%, blur 12 → 5px, fog
   starts 40px below the panel top, and everything above the lyric list
   (`.ytm-lyrics--nobackdrop > :not(.ytm-lyrics__scroll):not(.ytm-lyrics__edge):not(.lyrics-sync):not(.ytm-lyrics__state)`)
   gets `position: relative; z-index: 4` so buttons / source-match row are in front of the fog.
   Desktop `≥961px`: `.player-sidepanel` capped to `calc(100dvh - 132px)` because the
   now-playing column can be taller than a 800px-high window, which stretches the shared grid row.
3. **Karaoke WebGPU → WASM recovery** — `lib/liveKaraoke/roformer/separate.ts`
   (`recoverWithWasm`) and `separatorWorker.ts` (retry once per chunk). Reason: ORT built the
   WebGPU session but `session.run` failed ("WebGPU validation failed"), and the old code
   only fell back to WASM if *session creation* failed, so it dropped straight to mid-side.
   **Not tested against a real WebGPU failure**; WASM is slow and may still trip the
   existing "too slow → mid-side" check (`useLiveKaraoke.ts`, `TOO_SLOW`).
4. **Karaoke status UI** — `PlayerPanel.tsx` `KaraokeStatus`: short line + ⓘ popover
   (Escape / outside press closes). Styles `.np-info-*` at the end of `styles/components.css`.
5. **Vercel Analytics + Speed Insights** — `apps/web/app/layout.tsx`, deps in `apps/web/package.json`
   and root `package-lock.json`. Only produce data once deployed.

Checks at the time: `npm run typecheck`, `npm run lint`, `npm test` were green
(190 + 35 + 10 tests) **before** the deletion incident.

---

## 2. TASK A — double-tap Karaoke → two sliders (Vocals / Bass & instruments) — NOT STARTED (design only)

User request: double-tapping the Karaoke button opens a panel with two sliders, one for
vocals and one for bass+instruments, adjustable live.

### What exists (read these first)
- `apps/web/src/hooks/useLiveKaraoke.ts` — controller: `toggle()`, `active`, `busy`, `backend`
  (`'roformer' | 'midside'`), owns `LiveKaraokeStream` via `streamRef`.
- `lib/liveKaraoke/streamSession.ts` — `LiveKaraokeStream`; stores `segments` (instrumental PCM
  per segment) + `tails` for crossfades.
- `lib/liveKaraoke/streamPlayer.ts` — `KaraokeStreamPlayer`: schedules instrumental
  `AudioBufferSourceNode`s → `wet` gain → `volume` → `graph.bus`. The element's own signal is
  `graph.dry` and is muted where a segment plays.
- `lib/audioGraph.ts` — `ElementGraph { context, source, dry, bus }`.
- `roformer/separatorWorker.ts` posts **only the instrumental** (`mix − vocals`) per chunk.
- Karaoke entry points in `components/PlayerPanel.tsx`: the big `np-live-karaoke-btn`
  (~line 477), the dock `IconButton` (~line 446, phone lyrics view), and `LyricsPanel`'s own
  Karaoke button (`onToggleKaraoke` prop, ~line 518). The `.np-live-karaoke` block is
  `display:none` in lyrics/panel views, so **one shared handler + one shared panel** is needed.
- `CLAUDE.md`: "Karaoke sliders are real: they mix two genuinely separated stems locally."
  Don't ship sliders that do nothing.

### Recommended design (alignment-safe)
Keep **both stems** and mix them in Web Audio; do **not** approximate vocals as
`dry − instrumental` with negative gains (element clock and buffer clock are not sample-aligned,
you'd get comb filtering at intermediate settings).

1. **Worker** (`separatorWorker.ts`): keep the sliced mix chunk, compute
   `vocals = mixChunk − instrumental` after `separateChunk`, post `vocalLeft/vocalRight`
   (add to `SeparatorResponse['chunk']`, transfer the buffers).
2. **Client** (`separatorClient.ts`): `onChunk(index, instrumental, vocals, ms, residualPass)`.
3. **Session** (`streamSession.ts`): store vocal segments/tails with the same
   `assembleSegment` / `crossfadeHead` / `chunkTail` logic (segment becomes
   `{ inst, vocals, blended }`, tails `{ inst, vocals }`). Memory doubles (~170 MB for a 4-min
   song at 44.1 kHz stereo) — acceptable, mention it.
4. **Player** (`streamPlayer.ts`): `getSegment` returns `{inst, vocals}`; per segment create two
   `AudioBufferSourceNode`s → `instGain` / `vocalGain` (persistent nodes) → `wet`. Expose
   `setMix({ vocals: 0..1, instruments: 0..1 })`; use `setTargetAtTime(v, now, 0.02)` for
   click-free changes. Defaults: vocals **0**, instruments **1** (that *is* karaoke).
   Where a segment isn't ready the dry original keeps playing (unchanged behaviour).
5. **Hook** (`useLiveKaraoke.ts`): `mix` state + `setMix`, `supportsMix = backend === 'roformer'`,
   push to `streamRef.current.stream.setMix(...)` on change and on stream creation. Persist in
   `localStorage` (`allegra-karaoke-mix`, try/catch like `allegra-theme` in `App.tsx`).
   Add both to `LiveKaraokeController`.
6. **Mid-side fallback** has no stems → panel shows sliders disabled with a one-line reason
   ("Vocal mix needs the on-device AI model") rather than fake sliders.
7. **UI**: one `KaraokeMixSheet` rendered once in `PlayerPanel`, frosted glass (match
   `.np-info-pop` / `.lyrics-sync`), fixed position (desktop bottom-right above the player bar;
   mobile centred, `env(safe-area-inset-bottom)`), two labelled `input[type=range]` with
   percentage readout, Escape/outside-press closes, `role="dialog"`.
   **Double-tap detection** (one shared handler used by all three entry points):
   - `now - lastTap < 300ms` → open panel, cancel any pending single-tap, `lastTap = 0`.
   - else `lastTap = now`; if karaoke is **off** → toggle immediately; if **on** → delay the
     toggle ~260 ms so a second tap can cancel it (otherwise double-tap turns it off).
   - Discoverability/a11y: also add a small sliders icon button next to Karaoke when active
     (touch + keyboard have no double-tap), and mention "Double-tap for mix" in the hint.
8. Tests: unit-test the tap-timing helper and a pure `mixToGains` clamp function; the worker
   change can be tested by extracting `subtract` (already in `separate.ts`) — vocals+inst must
   equal the mix within float epsilon.
9. Rules to respect: animate `transform`/`opacity` only, durations from
   `apps/web/src/motion/index.ts`, `prefers-reduced-motion`, no `console.log`, no `any`,
   `requestPlayback` funnel untouched (this feature must not call `.play()`).

---

## 3. TASK B — Settings page — NOT STARTED (spec only)

The user said they can't find any settings and wants a page. Nothing exists today besides a
theme toggle in the command palette (`CommandPalette.tsx`, `id: 'theme'`) persisted in
`localStorage['allegra-theme']` (`App.tsx` ~line 136).

### Where it plugs in
- Routes: `apps/web/src/lib/routes.ts` (`paths`, `parseRoute`) — add `settings: '/settings'`.
  `apps/web/app/[[...slug]]/page.tsx` returns `null`; the persistent shell in `App.tsx`
  chooses the view from `parseRoute(pathname)` (long ternary chain ~line 1106). Add
  `view === 'settings'` → `<SettingsPage … />`, add a nav item (sidebar `nav-link`, bottom nav,
  command palette entry "Open settings").
- Storage: guests are in-memory only (`docs/architecture.md`). Persist device-local prefs in
  `localStorage` with try/catch (pattern above). Signed-in prefs *could* go to Convex
  (`convex/profiles.ts` — contract change ⇒ update `docs/api-contract.md` first, hard rule 1),
  but **v1 should be local-only**.
- Create one `useSettings()` hook (typed, versioned key `allegra-settings-v1`, `useSyncExternalStore`
  or context) so the player, lyrics and karaoke read the same source. Don't scatter keys.

### Recommended sections and settings (priority order)
**Playback:** audio quality (data saver / normal / high, only if the API exposes it — check
`docs/api-contract.md` first, otherwise omit), crossfade (off/3/6/9 s), normalise volume,
autoplay similar songs when queue ends. *(Respect the three playback invariants in `CLAUDE.md`.)*

**Lyrics:** default sync offset per song (extend the nudge from §1 — persist by `songId`),
lyric text size (S/M/L), translate by default, preferred lyric source order
(providers in `docs/provider-integration.md`), "show source/match info".

**Karaoke:** processing mode (Auto / AI only / Basic only), default vocal & instrument levels
(from Task A), vocal-reduction strength for mid-side, "clear model cache" (OPFS/cache via
`roformer/modelCache.ts`), show device capability (WebGPU yes/no, backend in use).

**Appearance:** theme (dark/light/system), reduce motion (override; the OS setting must still
force it), animated backgrounds on/off (perf), compact vs comfortable density.

**Account & privacy:** signed-in identity (Google via Convex), sign out, export my data,
delete my data / account, analytics opt-out (Vercel Analytics is cookie-less but an opt-out
is good practice — gate `<Analytics />`/`<SpeedInsights />` in `app/layout.tsx` behind a
client wrapper that reads the setting), clear listening history.

**About / help:** app version, provider status (`/api/health`), keyboard shortcuts list,
"Report a problem", credits/licences (the karaoke model licence: see `roformer/MODEL.md`).

Explicitly **do not** add: payments or Premium (it's a labelled UI demo), controls that do
nothing, or any secret/provider URL in the frontend (hard rule 2).

### Acceptance
Page reachable from nav + palette + `/settings` deep link; every control works and persists
across reload; `prefers-reduced-motion` respected; checked at 360 / 768 / 1280 / 1920; both
themes; keyboard operable with visible focus; `npm run typecheck && npm run lint && npm test` green.

---

## 4. Known issues / caveats spotted this session

- `useLiveKaraoke` / `LyricsPanel` layout: at a 1280×800 window the now-playing column
  (art 380 + meta 78 + controls 308) is taller than the viewport; my `max-height` cap on the side
  panel is a mitigation, not a fix of the underlying row sizing.
- The in-app browser pane in Claude desktop throttles rendering (screenshots time out,
  `document.visibilityState === 'hidden'`); animations freeze mid-way. Trust DOM measurements
  (`getBoundingClientRect`, `elementFromPoint`, computed styles) over screenshots there.
- A 401 burst on first load (`/api/me/*`, `/api/auth/me`) precedes `/api/auth/anon` 200 — existing
  guest-bootstrap behaviour, not introduced here.
- Web dev server (:5173) and API (:8080) were running from the user's terminal; the web one died
  during the incident and was restarted via `preview_start`. Restart the API after `apps/api`
  is restored (`.env` change needs a restart).
- `_build-log.txt`, `.mcp.json`, `mobile allegra.png`, `.vercelignore` are untracked at the repo
  root — check for secrets before ever committing them.
- Commit rules: conventional commits, **no AI attribution footers** (`CLAUDE.md`), small PRs,
  don't push WIP that isn't yours. Partial-commit trick used this session: rebuild the file from
  `git show HEAD:path` + your hunks, `git hash-object -w --path=<file>`, `git update-index --cacheinfo`.

## 5. Suggested order of work
1. Human: decide on recovery (§0). Recreate `.env` files. Get `apps/api` running again.
2. `npm run typecheck && npm run lint && npm test` to see the true baseline.
3. Task A (karaoke sliders) — self-contained, web only.
4. Task B (settings page) — v1 local-only.
5. Open a PR from `feat/browser-live-karaoke` (https://github.com/peterish8/allegra/pull/new/feat/browser-live-karaoke).
