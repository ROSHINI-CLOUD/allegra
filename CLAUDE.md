# Allegra — project rules for AI agents

Music-streaming web app, now a real product rather than a hackathon entry.

**Start with [the current codebase map](docs/current-codebase.md).** It links to the current owner,
entry point, and reference for each task. Use the [audit core brief](audit/CODEBASE-KNOWLEDGE.md)
to orient, then load the relevant section and verify the cited path before changing it. Use
[the docs index](docs/README.md) for contracts and [the backlog](audit/FIX-BACKLOG.md) for known
findings. The audit describes its captured checkout. Recheck the live diff when playback is in progress.

## Repo

```
apps/web          Next.js 16 App Router · React 19 · Tailwind v4 · Motion
apps/api          Node 22 · Express · TypeScript — ships as one Vercel Function
apps/mobile       LuvLyrics — Expo · React Native (Android). NOT a root workspace: own
                  lockfile, `npm install` inside it. Rules in apps/mobile/CLAUDE.md
apps/desktop      Allegra for Windows — Rust + WebView2 window around the live site.
                  NOT a workspace: `cargo build --release` inside it. See its README
packages/shared   DTOs and pure cross-client rules; named API copies via sync:shared
packages/connect  playback routing, session, transport and queue staging for web/mobile
convex/           Google auth, listener data, Connect, LuvLink, Blend, Spotify and retention
docs/             current codebase map, architecture, contracts, workflows and setup
audit/            dated implementation reference and fix backlog
.planning/        plans, handoffs and historical verification records
tests/            contract, infra, Convex, browser e2e and performance
```

npm workspaces: **one `npm install` at the root, one lockfile.** Never add a per-app lockfile — Vercel
resolves function dependencies from the root, so a split lockfile lets a package exist locally and be
missing in production.

## Mobile frontend

For V6 mobile work, read `apps/mobile/DESIGN.md`, `apps/mobile/CLAUDE.md` and
`apps/mobile/src/ui/AGENTS.md`. Use the shared tokens/components and preserve the existing
Android audio owner. GitHub Actions owns release APK builds; `apk-latest` publishes only from
main after checks and emulator launch pass. Physical-phone evidence is tracked separately in
`.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md`.

## Run it (don't go searching)

```bash
npm install                     # once, at the root only
npm run dev                     # API on :8080 (tsx watch) + web on :5173 (next dev) — Ctrl+C stops both
npm run dev --prefix apps/api   # API alone
npm run dev --prefix apps/web   # web alone
npm run mock                    # fake API on :9090 (MOCK_PORT), no upstream providers
```

- **Open the app at http://localhost:5173.** Next rewrites same-origin `/api/*` to `127.0.0.1:8080`
  (`apps/web/next.config.ts`), so there is no CORS setup. Health check: http://localhost:8080/api/health.
- **Port 8080 or 5173 already in use = it is probably already running.** Hit `/api/health` or open
  :5173 before starting a second copy. Both dev servers hot-reload; you don't need to restart after edits.
  An `.env` change does need a restart.
- **Agents in Claude Code:** `.claude/launch.json` defines `api`, `web` and `web-next` (:5174) for
  `preview_start`.
- **Env files:** `apps/api/.env` (server secrets and provider URLs; template `apps/api/.env.example`)
  and `apps/web/.env.local` (`NEXT_PUBLIC_*` only). Nothing is required: without Convex the app runs
  guest-only with in-memory data.
- **Test browser behaviour (media, video, audio) on :5173, never on an :8080 URL.** The API sends a
  strict CSP (`default-src 'self'`), so a `<video>` from another origin fails there with `MEDIA_ERR 4`
  even though it works in the real app.
- **Single test file:** `cd apps/api && node --import tsx --test src/providers/lastfm.test.ts`.
- More: [`docs/workflows.md`](docs/workflows.md) covers proving the Range rule, `vercel build`, and shipping.

## Hard rules

1. **`docs/api-contract.md` is the contract.** Changing a response shape breaks the other half
   silently. Propose → update the doc → announce → both sides adapt. Never a silent rename.
2. **No provider URLs, tokens or secrets in the frontend.** `NEXT_PUBLIC_*` is inlined into the public
   bundle. Everything provider-side is server-side; secrets live in the host's environment.
3. **Duration is always seconds.** Every provider, every type, every component.
4. **Use `{ success, data, error? }` on normal JSON data routes.** Keep the documented health,
   media, OAuth, MCP and empty-response shapes. `error` is user-facing copy. Map provider failures
   server-side before returning them.
5. **Animate `transform` and `opacity` only.** `width`, `top`, `height`, `box-shadow` are banned in
   transitions.
6. **Every duration and easing comes from a token** (`apps/web/src/motion/index.ts`). No ad-hoc numbers.
7. **`prefers-reduced-motion` collapses to opacity.** It never disables a feature.
8. **TypeScript strict. No `any`.** Provider responses get narrow interfaces covering consumed fields.
9. **Bound outbound work and isolate provider failures.** A deadline for buffered responses must
   cover the body as well as headers. Preserve the streaming response lifecycle and byte-range rule.
   Catch provider failures at the cascade boundary so the next provider can still run.
10. **No `console.log` in production paths.** Use the logger, or guard on `NODE_ENV`.

## The three playback invariants

Each was a real production bug. Do not regress them.

1. **One funnel.** All play/pause goes through `requestPlayback(playing)`. Never `setIsPlaying(...)`
   *and* `audio.play()` from a component. The raw setter is only for syncing **from** the audio
   element's events.
2. **Load effects must never depend on `isPlaying`.** An effect listing it in deps that calls `.play()`
   re-fires on the user's own pause and instantly resumes — pause appears to do nothing. Read play
   state imperatively inside the effect.
3. **Seek pauses. Always resume.** Capture `wasPlaying`, set `currentTime`, resume if it was playing.

The single `<audio>` element lives in the App Router layout so it survives navigation. If a change
remounts it, music stops on every route change — check before shipping.

## The byte-range rule ⭐

`GET /api/stream/:songId` forwards the client's `Range` header and **preserves the upstream status**.
A `206` must stay a `206`, with `Content-Range` and `Accept-Ranges` passed through. Collapse it to
`200` and audio plays perfectly while seeking silently does nothing — the highest-risk failure,
because it looks fine.

## Two things that break invisibly

- **The `/api` rewrite in `vercel.json` must precede Next's catch-all.** Otherwise the site renders
  and every API call 404s, which reads as a frontend bug. Run `vercel build` and inspect
  `.vercel/output/config.json` when touching routing.
- **Karaoke stays in the browser.** It never creates an API job, uploads track audio, or depends on
  server process memory. Model and audio-resource failures must leave playback usable via its local
  fallback or a clear capability message.

## Before you call it done

Each of these shipped once looking finished; the stories are in `.planning/LEARNING-LOG.md`
(2026-10-05), the resulting choices in `docs/decisions.md`.

- **New Express router:** mount it in `apps/api/src/app.ts` and add one supertest through
  `createApp` that hits a route. Unit tests on the service will not notice a 404.
- **Edited `packages/shared`:** run `npm run sync:shared`; the API compiles its own copies.
- **Edited `convex/`:** `npx convex dev --once` pushes the dev deployment and regenerates
  `convex/_generated`. Never hand-edit `_generated`. Production deploys from the Vercel build.
- **Changed a matcher or scorer:** bump its cache key version, or old results outlive the fix.
- **Generated playlist IDs:** exercise `parseLibraryOps` in `apps/api/src/services/spotifyTransfer.test.ts`; direct store writes can bypass its alphabet (learning log item 17).
- **Invite parser fixtures:** use a valid code with the production generator's length and alphabet in `apps/mobile/src/hooks/useDeepLinks.test.ts` (item 19).
- **Convex timeout failures:** rerun `npm.cmd run convex:test` without overlapping `npm.cmd run mobile:check` before increasing timeouts (item 20).
- **Third-party API:** check its current shape against a working client before trusting docs or
  memory (Spotify 2026: playlist lists lack track totals, item pages have no `snapshot_id`,
  development mode returns 403 for playlists you don't own).
- **No hard-coded production URLs** in redirects; derive them from config.
- **Sign-in from a deep page** passes `redirectTo` with the current path.
- **`motion` `animate` writes inline styles:** a target opacity in `animate` beats CSS. Put the value
  you want in `animate`, not in the stylesheet.
- **A user reports a failure:** read `vercel logs` for the route before theorising.
- **Then prove it live:** request the route on the deployment, open the page, use the build.

## Verifying

```
npm run typecheck    # exit 0
npm run lint         # exit 0
npm test             # all green
```

All three before opening a PR. Frontend work also gets checked at 360 / 768 / 1280 / 1920, and the
hero transition is profiled on a **real phone**, not a laptop. See
[`docs/workflows.md`](docs/workflows.md) for how to prove the Range rule and playback survival.

## Deployment

**Vercel only** — one deployment serves the Next.js app and the Express function. No Render, no App
Runner, container deploy, or AWS runtime. Karaoke separation runs on the listener's device; Convex
owns identity and listener data.

Three apps ship from this repo (table in `README.md`): the website (Vercel), Allegra for Windows
(`.github/workflows/desktop.yml` → the `desktop-latest` release, which installed copies update from)
and LuvLyrics for Android (`mobile-apk.yml` → `apk-latest`). The desktop app wraps the live site:
put features in the website, not in `apps/desktop`, unless only a native window can do them.

## Phone update copy

Release notes in LuvLyrics (Stream or About -> Updates) are listener-facing. Use short, specific, everyday
English that explains what changed or what someone can now do. Keep implementation names, conventional-commit
prefixes, PR numbers, build details, and engineering jargon out of phone copy. Describe a fix by its visible
result. Keep `apps/mobile/update-history.json` in version order, newest first, with up to four releases. CI
publishes this copy with `apk-latest`; it does not put commit subjects in the phone.

## Commits

Conventional commits: `feat(api):`, `fix(web):`, `chore(infra):`. Short imperative subject; body only
when the *why* needs explaining. **No AI attribution footers.**

**New phone build = new version number.** Anything reaching `main` that rebuilds the APK
(see the paths in [mobile-apk.yml](.github/workflows/mobile-apk.yml)) bumps `expo.version` in
`apps/mobile/app.json` in the same change. Use patch for fixes and minor for features. About → Updates
displays that version. The updater also uses build commit and timestamp to determine eligibility.
See [the mobile rules](apps/mobile/CLAUDE.md) for signing and installer behavior.

**New desktop build = new version number.** A change under `apps/desktop/` bumps `version` in
`apps/desktop/Cargo.toml` (patch for fixes, minor for features). Installed apps update only to a
higher version, so without a bump the new build never reaches them.

## Branching

`main` is always deployable and always green. Work on `feat/`, `fix/`, `chore/`, `docs/` branches.
Small PRs, squash-merge, reviewed by a non-author.

## What is real vs demo

Allegra is free and has no payments. Karaoke sliders are **real**: they mix two genuinely separated stems locally. Don't ship a control that does
nothing and present it as a feature.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Privacy instrumentation

Session replay stays off on web and mobile. Do not add replay SDKs or Sentry replay integrations
unless a separate explicit consent flow and reviewed policy change have been approved. Crash and
performance reporting do not authorise screen recording.
