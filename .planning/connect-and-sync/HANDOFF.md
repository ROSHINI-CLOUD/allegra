# Handoff — Connect + library sync (read this first)

Updated 2026-09-30, end of the session that shipped library sync and the backend clean-up.
The plan is [`PLAN.md`](./PLAN.md) (§3 modules, §4 Connect behaviour, §5 phases, §6 error copy).
This file is where things stand, what is left, and what bites.

## Where things are

| Place | State |
|---|---|
| Repo | `C:\dev\allegra`, branch **`feat/connect-and-sync`** |
| `peterish8/allegra` `main` | Same commit as the branch. **Vercel production deploys from it** (allegravibe.vercel.app) |
| `peterish8/allegra` `feat/connect-and-sync` | Same commit |
| `ROSHINI-CLOUD/allegra` `feat/connect-and-sync` | Pushed; the owner wants it kept. Its `main` is older (`47da803`) |
| Convex prod `neighborly-ocelot-786` | Deployed 2026-09-30 with everything in `convex/` (library tables, `profiles.version`, three live-row indexes, `profiles:update`) |
| Convex dev `charming-jaguar-140` | Not redeployed since; `npx convex dev --once` before local work against it |
| APK | Every push to `main` or `feat/connect-and-sync` publishes `apk-latest` on `peterish8/allegra` (`.github/workflows/mobile-apk.yml`). The app's updater reads that release |

Pushing needs a token with the `workflow` scope (it is in the owner's user `GITHUB_TOKEN`; the shell
may hold an older one: read it with `[Environment]::GetEnvironmentVariable('GITHUB_TOKEN','User')`).

## Gates (all green at handoff)

```bash
npm run typecheck && npm run lint && npm test     # root: api (183), web, shared, infra, convex
npx tsc --noEmit -p convex                        # convex/ is NOT in the root typecheck
npm run mobile:check                              # phone: secrets, lint, typecheck, 503 tests
```

## Done

- **Phase 0–2:** repo move, `songRef` identity, Google sign-in on the phone (Settings → Allegra account).
- **Phase 7 (library backend):** `LibraryStore` seam, Convex rows, `/api/me/library/ops` + `/changes`,
  web reloads likes/playlists when `library:myRev` moves (`apps/web/app/ConvexSignInProvider.tsx`).
- **Phase 8 (phone sync), mostly:** like ≠ download (`liked_online_songs`), `LibrarySync` outbox + pull
  (`apps/mobile/src/services/sync/`), online songs in Liked/playlists that stream on play
  (`sync/onlineSongs.ts`), the first-sign-in choice (in Settings → Allegra account, not a separate sheet).
- **Backend clean-up (this session):**
  - `ListenerActions` (`apps/api/src/user/actions.ts`): one module for likes, playlists, sharing and plays; routes and MCP tools call it
  - profile writes are compare-and-set (`UserStore.update`, `profiles:update`)
  - `ConvexGateway` puts a 15 s timeout on every Convex call
  - config passes straight through to `createServices`
  - the profile copy reads only live rows, newest first

## Left to do, in order

### 1. Finish Phase 8 (small, do first)
- **Phone plays never reach the account.** `LibrarySync.recordPlay(ref, seconds)` exists but nothing
  calls it. Call it from the player when a catalog song stops or changes (seconds actually heard). This
  feeds the web's Recently played and Quick picks.
- **Account Quick picks on the phone:** `allegraApi.getRecommendations` is unused. Add a "Quick picks for
  you" shelf to the Stream home when signed in (PLAN §5 Phase 8 step 4).
- **Gaana songs don't show on the website.** They sync into Convex rows, but the profile copy
  (`toProfileLibrary` in `packages/shared/library.ts`) keeps Saavn ids only, and the web hydrates liked and
  playlist songs by Saavn id. Fix: have the web read the rows' `song` snapshots (or resolve Gaana refs by
  `matchKey` through search) instead of dropping them.
- First-sign-in choice: the plan also wants the **account's** counts ("87 in your account"); it shows
  the phone's only.
- Guest-merge ops (`opsForGuestMerge` in `apps/api/src/user/libraryOps.ts`) carry no song snapshots;
  pass the catalog details like `ListenerActions.saveSharedCopy` does.

### 2. Phase 3 — Connect backend (`convex/connect.ts`)
PLAN §3 M2 and §5 Phase 3. Read `convex/_generated/ai/guidelines.md` first. It changes the plan:
- device presence via **`@convex-dev/presence`**, the command cap via **`@convex-dev/rate-limiter`**
- no `Date.now()` in queries; bounded `.take()`
- never take `userId` as an argument: derive it with `getAuthUserId` (Connect is called by clients
  directly, unlike the library functions, which the API calls with the server secret)
- tests with **`convex-test` + `vitest` + `@edge-runtime/vm`** inside `convex/`. No such setup exists yet;
  `tests/convex/*.test.ts` only covers pure helpers. Setting it up also lets you test `convex/library.ts`
  and `profiles:update`, which today are only typechecked.

Write `docs/connect-contract.md` first. **Deploying replaces every function**: prod deploys are the
owner's call (`npx convex deploy`, they run it themselves).

### 3. Phase 4 — `packages/connect`
`createConnectSession({ transport, player, device, clock })`, `MemoryTransport`, `FakePlayerPort`, and
the behaviour tests listed in PLAN §5 Phase 4. **Pure TypeScript with no npm imports** (`tests/infra`
enforces it), or Metro bundles a second React.

### 4. Phase 5 — web
`WebPlayerPort` over `useAudioPlayer`, a `ConvexTransport` on the existing `ConvexReactClient`, a
device picker in `PlayerPanel`, remote mode, "Playing on …" and "Tap to play here" bars, and the
`?connectDevice=b` two-tab harness. The `<audio>` element in the layout must never remount, and the
three playback invariants in the root `CLAUDE.md` hold.

### 5. Phase 6 — phone
`MobilePlayerPort` over `playerStore` (respect `beginAudioLoad`/`endAudioLoad`, call
`prepareNextInQueue()` after queue changes), `songMatcher` (PLAN M7), a device sheet in the player, remote
mode with lyrics fed by `livePosition()`, and the Listen Together guard. Follow `apps/mobile/CLAUDE.md`
(motion primitives, no shadows on Now Playing, `requestPlayback` only).

### 6. Phase 9 — hardening
The error copy in PLAN §6, rate limits, telemetry, and docs: `docs/architecture.md` Connect section,
`apps/mobile/CLAUDE.md` file map, README "real vs demo".

## Things that bite

- **Deploy order: Convex first, then the API/web.** The API names every Convex function it calls in
  `apps/api/src/db/convexGateway.ts`, and a test checks each is exported by `convex/`. If the API goes
  live before Convex, the new calls fail. Pushing to `peterish8/allegra` `main` **is** a production
  deploy.
- **No AI attribution footers** in commits (root and `apps/mobile` `CLAUDE.md`), even if a tool asks for them.
- **The working folder is shared with other Claude sessions.** Stage explicit paths; never `git add -A`.
  `.mcp.json` and `mobile allegra.png` in the root are untracked on purpose.
- **Nothing ignored is backed up.** Env files: `apps/api/.env`, `apps/web/.env.local`, `apps/mobile/.env`,
  plus `android/app/debug.keystore` and `local.properties`.
- **`apps/mobile/android` is checked in**, so Expo config plugins never run. A new native Expo package
  must be added by hand to `ExpoModulesPackageList.kt` (`src/nativeModuleList.test.ts` fails otherwise).
  `@convex-dev/presence` on the phone is JS only, so it needs no native step.
- **Metro and the root `node_modules`:** code in `packages/` imports no npm packages.
- **The API can't import `packages/shared`** (rootDir). `npm run sync:shared` copies `songRef.ts` and
  `library.ts` into `apps/api/src/shared/`; `tests/infra` fails when a copy drifts.
- **Only Saavn songs appear in the profile copy** (see "Gaana songs" above). The rows are complete.
- **The web's library copy is capped** (4000 likes, 300 playlists, 8000 playlist songs, newest kept;
  `convex/library.ts`). The phone reads the rows and is not capped.
- **Mobile Jest DB tests mock `./db`** despite the "real SQLite" rule; a real-SQLite harness is still owed.
- LuvLyrics bug reports (`apps/mobile/src/services/feedback.ts`) call `feedbacks:send` on dev Convex,
  which is deployed nowhere, so they fail (`apps/mobile/docs/convex-feedbacks.md`).
- `gh` and `git push` from Bash: build the auth header from the user token
  (`git -c "http.extraheader=AUTHORIZATION: basic <base64 x-access-token:TOKEN>" push …`).
