# Handoff — Connect + library sync (read this first)

Written 2026-09-30 at the end of the session that did Phases 0–2. The plan is
[`PLAN.md`](./PLAN.md); this file is where things stand and what bites.

## Where things are

- Repo: `C:\dev\allegra` (moved from `...\Desktop\.website-production\allegra aws`). Branch
  **`feat/connect-and-sync`**, stacked on `chore/import-luvlyrics-mobile`. Nothing pushed, no PR.
- `apps/mobile` = LuvLyrics (Expo/React Native, Android), copied from
  `C:\Users\nithy\Desktop\apps\LuvLyricsApp\LuvLyrics` @ `0c2beac` (that repo stays as the archive).
  Not a root workspace: own lockfile, `npm ci --prefix apps/mobile`.
- Commits: `465a4b3` Phase 0 (root mobile CI, `@shared/*` alias, dev scripts) · `5482e46` Phase 1
  (`packages/shared/songRef.ts`, phone `origin_id`) · `3a20795` Phase 2 (phone Google sign-in).
- `chore/import-luvlyrics-mobile` also carries two lyric commits from another session
  (`af1bb43`, `47da803`) — rename or split that branch before merging.

## Gates (all green at handoff)

```bash
npm run typecheck && npm run lint && npm test     # root: api, web, shared, infra, convex
npm run mobile:check                              # phone: secrets, lint, typecheck, 494 tests
cd apps/mobile/android && ./gradlew assembleDebug # native build (JDK 17 via JAVA_HOME), ~2 min incremental
```

## Waiting on the owner

1. **Convex deploy of `convex/auth.ts`** (the `lyricflow://auth` redirect). Checked 2026-09-30: dev
   (`charming-jaguar-140`) and prod (`neighborly-ocelot-786`) both run exactly this repo's 25
   functions, so a deploy adds only that rule. Dev: `npx convex dev --once`. Prod: `npx convex deploy`.
2. **Device check of sign-in** (Settings → Allegra account). Release/dev builds default to **prod**
   (`apps/mobile/src/services/account/config.ts`), so test after the prod deploy.

## Next: Phase 3 — Connect backend (see PLAN.md §3 M2 and §5 Phase 3)

- Read `convex/_generated/ai/guidelines.md` first (repo rule). It changed the plan: device presence
  via **`@convex-dev/presence`**, command cap via **`@convex-dev/rate-limiter`**, no `Date.now()` in
  queries, bounded `.take()`, never accept `userId` as an argument (derive it with Convex Auth's
  `getAuthUserId`), tests with **`convex-test` + `vitest` + `@edge-runtime/vm`** in `convex/`.
- No convex-test setup exists yet; `tests/convex/*.test.ts` (node:test via `npm run convex:test`)
  only covers pure helpers.
- Write code and tests locally; **do not deploy** without asking — a deploy replaces every function.
- Then Phase 4 (`packages/connect`, pure TS, no npm imports — `tests/infra` enforces it).

## Things that bite

- **The working folder is shared with other Claude sessions.** Branch switches and commits land for
  everyone. Stage explicit paths only; never `git add -A`.
- **Nothing ignored is backed up.** A botched folder move on 2026-09-30 deleted the untracked/ignored
  files; git restored the rest. Env files were rebuilt: `apps/api/.env` (template + fresh
  `JWT_SECRET`; Convex values blank because dev has no `CONVEX_SERVER_SECRET`, so the local API is
  memory-only), `apps/web/.env.local`, `apps/mobile/.env` + `android/app/debug.keystore` +
  `local.properties` (copied from the LuvLyrics folder). Optional provider keys once in the old API
  `.env` are gone.
- **`apps/mobile/android` is checked in**, so Expo config plugins never run. A new Expo package with
  native code must be added by hand to `android/app/src/main/java/expo/modules/ExpoModulesPackageList.kt`
  (`src/nativeModuleList.test.ts` fails otherwise), and any manifest change a plugin would make must be
  made by hand in `AndroidManifest.xml`.
- **Metro and the root `node_modules`:** code in `packages/` must import no npm packages, or Metro
  bundles the web's React (19.3) next to the phone's (19.1.0). To prove a bundle is clean:
  `npx expo export --platform android --dump-sourcemap`, then only `19.1.0` should appear.
- **Two Convex deployments:** the live site uses prod `neighborly-ocelot-786`; `.env.local` points at
  dev `charming-jaguar-140`. LuvLyrics' bug reports (`apps/mobile/src/services/feedback.ts`) point at
  **dev** and call `feedbacks:send`, which is deployed **nowhere** — bug reports currently fail.
  (`apps/mobile/docs/convex-feedbacks.md` has the table + function to add.)
- The phone's Jest DB tests mock `./db` despite the "real SQLite" rule — Phase 8 needs a real harness.
- Commits: conventional, **no AI attribution footers** (repo CLAUDE.md).
