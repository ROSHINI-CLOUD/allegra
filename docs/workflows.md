# Workflows — develop, verify, ship

## Local development

```bash
npm install          # once, at the root: one lockfile covers every workspace
npm run dev          # API on :8080, web on :5173
```

`npm run dev` starts both. The web app calls same-origin `/api`, which Next rewrites to the API in
development — so there is no CORS setup and no `localhost` vs `127.0.0.1` trap.

Nothing needs credentials to run. With no Convex the app is guest-only and user data is in memory.
Karaoke runs on the listener's device, so it has no API or cloud configuration.

### Connect and account sync

Connect, account library sync, and cross-device recommendations require Convex Auth and the same
Convex deployment in the web, API, and phone environments. Set `NEXT_PUBLIC_CONVEX_URL` in
`apps/web/.env.local`, and `CONVEX_URL` plus `CONVEX_SERVER_SECRET` in `apps/api/.env`. Set the
mobile app's Convex URL to the same development deployment before building it. Deploy additive
Convex changes to the selected **development** deployment with `npx convex dev --once`; check the
deployment name printed by the CLI first. The production deployment is a separate owner-controlled
step.

The two-tab harness tests the complete web command path without a phone:

1. Start the API and web app, sign in to the same account in two tabs, and leave tab A on the normal
   URL. Open tab B at `http://localhost:5173/?connectDevice=b` (development only).
2. Start a song in either tab. Open **Playback devices** and transfer to the other tab.
3. Check pause/play, seek, next/previous, volume, shuffle, repeat, queueing a song while the other
   tab is active, and transfer back. If a fresh tab blocks autoplay, its picker must offer **Tap to
   play here** and continue at the transferred position.
4. Change a like and a playlist item in one tab; the other tab should refresh from the Convex
   library revision. The `<audio>` element remains the same DOM node across route changes.

For phone coverage, sign in on a dev Android build with the same Google account. Transfer in both
directions, then test web-to-phone song selection and phone-to-web library edits. Like a streamed song
without downloading it; toggle a like and edit a playlist while offline, reconnect, and confirm the
outbox catches up. Listen to a few tracks, then confirm **Quick picks for you** uses that account's
listening history. Confirm downloads remain available offline and are not removed by library sync.

### Local Connect traces (development opt-in)

In a development web build, open `http://localhost:5173/?connectTrace=1` before signing in.
For a second sender tab, use `?connectDevice=b&connectTrace=1`. On a development mobile build,
set `EXPO_PUBLIC_CONNECT_TRACE=1` in the local mobile environment and restart Metro after that
environment change. Release mobile builds ignore this flag; production web builds ignore the
query parameter. Neither enables production telemetry.

The local debugger can inspect `allegraConnectTrace.snapshot()` and clear it with
`allegraConnectTrace.clear()`. It exists only for an opted-in signed-in session. Account change,
sign-out or session cleanup erases and disposes that buffer. At most 250 entries are retained
by default (hard limit 500); export each short scenario before it rotates out.

Record sender `input.confirmed.durationMs` on the sender's monotonic clock separately from
receiver `receiver.completed.durationMs` and player-port `adapter.ready` events. Player-port
completion is intent/readiness confirmation, not a measurement of first audible samples.
Catalog events count actual adapter lookup calls and their overlap. Mobile renderer events count
the existing remote-view interval callbacks. Do not infer browser/native paint or battery cost.

`query.delivered` for `devices_query`, `state_query`, and `commands_query` counts client watcher
callbacks. `watch` is the assembled session snapshot and can repeat cached data from the other
queries; do not sum its bytes with per-query bytes as network traffic. Byte values estimate UTF-8
JSON application payloads, excluding Convex framing/compression. Backend executions/reads require
separate development backend evidence; these counters are not billed usage.

For every comparable baseline/final capture record sample count, p50/p95 method, queue length,
network, visibility, device state and cache state. Warm controls, warm transfers and cold transfers
are separate scenarios. Never subtract uncalibrated sender/receiver wall clocks. Physical Android
audible/native/background acceptance remains required even when deterministic traces pass.

| Want | Add to `apps/api/.env` |
|---|---|
| Durable user data + Google sign-in | `CONVEX_URL`, `CONVEX_SERVER_SECRET` (+ `NEXT_PUBLIC_CONVEX_URL` in `apps/web/.env.local`) — see [auth-convex-google.md](./auth-convex-google.md) |
| Recommendations, lyric translation | No key. Recommendations use catalog + listener taste; MyMemory translates lyrics. Set `LIBRETRANSLATE_API_URL` only for a self-hosted fallback. |

### The phone app (LuvLyrics, `apps/mobile`)

`apps/mobile` is Expo / React Native and is **not** a root workspace: it has its own lockfile and
pins React for React Native, so it installs separately.

```bash
npm ci --prefix apps/mobile     # once, and after its package-lock.json changes
npm run dev:mobile              # Metro for a dev build on a phone or emulator
npm run mobile:check            # the app's own gate: secrets, lint, typecheck, tests
```

- A first native build: `cd apps/mobile/android && ./gradlew assembleDebug` (JDK 17 in `JAVA_HOME`,
  `apps/mobile/android/local.properties` pointing at the Android SDK). Keep the checkout on a short
  path without spaces (for example `C:\dev\allegra`): Windows CMake builds of Skia and Reanimated fail
  on long paths.
- Gradle's release build uses the signing config named `debug`. The APK workflow provisions the
  configured signing material when available and can fall back to Expo's template keystore.
  Verify the actual signer of a candidate APK before publishing. Android requires signing
  continuity for upgrades. See [the APK workflow](../.github/workflows/mobile-apk.yml) and
  [the signing finding](../audit/FIX-BACKLOG.md).
- Shared code comes from `packages/` through the `@shared/*` alias (tsconfig, `metro.config.js`,
  `jest.config.js`). Code in `packages/` imports no npm packages: Metro would otherwise resolve them
  from the root `node_modules` and bundle a second React.
- CI: `.github/workflows/mobile-ci.yml` (checks), `mobile-apk.yml` (publishes `apk-latest`, which
  the app's updater reads), `mobile-smoke.yml` (emulator walk-through).
- App rules live in [`apps/mobile/CLAUDE.md`](../apps/mobile/CLAUDE.md).

## The gate

```bash
npm run typecheck    # exit 0
npm run lint         # exit 0
npm test             # all green
```

All three before opening a PR. They run across every workspace from the root.

Frontend work is also checked at 360 / 768 / 1280 / 1920, and the hero transition is profiled on a
**real phone**, not a laptop.

## Verifying a change end to end

The two things worth proving by hand, because both fail invisibly:

**Range requests still return 206.** Collapse it to 200 and audio plays perfectly while seeking does
nothing.

```bash
curl -s -D - -o /dev/null -H "Range: bytes=0-1023" http://localhost:5173/api/stream/<songId>
# expect: HTTP/1.1 206 Partial Content + content-range + accept-ranges
```

**Playback survives navigation.** The single `<audio>` element lives in the layout; if a change
remounts it, music stops on every route change. In the browser console, after pressing play:

```js
document.querySelector('audio').__probe = 1;
document.querySelector('a[href="/library"]').click();
// after navigating: the same element must still be there and still playing
document.querySelector('audio').__probe === 1 && !document.querySelector('audio').paused;
```

## Inspecting a Vercel build without deploying

With local Vercel project settings linked, run a preview-mode `vercel build` to inspect route
output after routing changes. Production mode invokes the Convex deploy path. Use preview mode
for a read-only routing investigation.

```bash
vercel build
node -e "require('./.vercel/output/config.json').routes.forEach((r,i)=>console.log(i, r.handle||r.src||''))"
```

The `/api` rewrite must appear **before** Next's `[[...slug]]` catch-all. If it does not, every API
call will 404 in production while the site still renders.

## Dependency updates

`.github/dependabot.yml` opens version-update pull requests on Mondays at 03:00 (Asia/Kolkata). It has one
entry per manifest: the root `package-lock.json`, `apps/mobile/package-lock.json`, the Gradle build in
`apps/mobile/android`, the Cargo lock in `apps/desktop`, and the workflow files.

- **Grouping.** Minor and patch updates for an ecosystem arrive as one pull request. Major updates arrive one
  per dependency, so each gets its own review.
- **Cooldown.** A new release waits 7 days before Dependabot proposes it, and 14 days for a major version in
  npm and Cargo. Gradle waits 14 days for every update. The cooldown applies to version updates only, so
  security updates are not held back.
- **Expo and React Native.** The mobile entry ignores `expo`, `expo-*`, `@expo/*`, `react`, `react-native` and
  `react-native-*`. Expo ties these packages to one SDK, so upgrade them together with `npx expo install --fix`,
  not one package at a time.
- **Media3.** The Gradle entry ignores `androidx.media3:*`. The app's Media3 version must equal the version
  expo-video and expo-audio are built for, which `apps/mobile/src/media3Version.test.ts` checks. Change it by
  hand, together with those packages.
- **`needs-version-bump`.** This label marks a pull request that changes an APK or desktop path. Add the
  `expo.version` (`apps/mobile/app.json`) or `apps/desktop/Cargo.toml` version bump commit before merging. The
  bot cannot make that bump, so the label is the reminder.
- **One lockfile.** The root entry only ever changes the root `package-lock.json`. Each other entry changes only
  its own manifest or lockfile. No entry adds a lockfile.
- **Labels.** Dependabot ignores a label the repo does not define. `dependencies` and `needs-version-bump` must
  exist, or the version-bump reminder is silently lost.
- **Gradle.** `apps/mobile/android/settings.gradle` loads the React Native and Expo Gradle plugins from
  `node_modules`. The Dependabot job may not have those installed, so it can fail to resolve them. If
  Dependabot reports an error for the Gradle entry, remove that entry. Do not add an install step to the
  update job.

## Branching and commits

`main` is always deployable and always green. Work on `feat/`, `fix/`, `chore/`, `docs/` branches.
Keep PRs small. Merge only after all required CI checks pass, using a regular merge commit; do not
squash-merge. Passing required CI is the project merge gate; a separate review is not required.

Conventional commits: `feat(api):`, `fix(web):`, `chore(infra):`. Short imperative subject; a body
only when the *why* needs explaining.

## Shipping

```bash
vercel deploy            # preview
vercel deploy --prod     # production — only when asked
npx convex deploy        # Convex functions and schema
node scripts/sync-vercel-env.mjs   # push apps/api/.env to Vercel (prints names only)
```

A production Vercel build runs `scripts/vercel-build.mjs` with `convex deploy --cmd …`. The
locked Convex CLI runs the web build command before pushing Convex. Vercel waits for the combined
command to succeed before publishing. It needs `CONVEX_DEPLOY_KEY` (Convex dashboard → Settings → Deploy keys, production) in Vercel's
**Production** environment and stops the build without it. Preview builds only build the website,
against whichever Convex deployment their env points at. Convex changes must stay additive: an
older phone build keeps calling the same functions after the new ones ship.

Smoke the production alias afterwards:

```bash
curl -s https://allegravibe.vercel.app/api/health
curl -sI -H "Range: bytes=0-1023" https://allegravibe.vercel.app/api/stream/<songId>
```

Preview deployments sit behind Vercel's SSO protection, so a public `curl` against one returns a
login redirect rather than your app. Verify against the production alias.

## Scope

Anything that ships a control which does nothing is out. Allegra is free and has no payments. Karaoke is real: it separates locally in a browser worker, with a mid-side fallback
when the model cannot run on the current device.

## Code scanning

`.github/workflows/codeql.yml` runs CodeQL on every pull request, on pushes to `main` and every Monday at 02:17 UTC. It
scans three languages without a build: TypeScript/JavaScript, the workflow files (`actions`) and the Rust desktop shell.
The job has `contents: read` and `security-events: write` only. `.github/codeql/codeql-config.yml` skips dependencies,
generated Convex code, build output and the planning folders.

- **Reading alerts.** Open the repository's Security tab, then Code scanning. A pull request that adds an alert shows it
  as a check annotation. Fix it, or dismiss it with a written reason, before merging.
- **Kotlin.** The Android code is not scanned. CodeQL needs a Gradle build for Kotlin, which takes minutes. Add a weekly
  manual-build job only if a Kotlin review needs it.
- **Pins.** The workflow's actions are pinned to full commit SHAs like every other workflow, so
  `tests/infra/workflow-pins.test.mjs` covers it. Dependabot updates the pins.
