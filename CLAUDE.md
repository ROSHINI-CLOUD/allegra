# Allegra — project rules for AI agents

Music-streaming web app, now a real product rather than a hackathon entry.

**Before doing anything:** read [`docs/architecture.md`](docs/architecture.md) — how the system works
and the rules that are not negotiable. Then [`.planning/ROADMAP.md`](.planning/ROADMAP.md) for where
things stand, and the doc for your area from [`docs/README.md`](docs/README.md).

## Repo

```
apps/web          Next.js 16 App Router · React 19 · Tailwind v4 · Motion
apps/api          Node 22 · Express · TypeScript — ships as one Vercel Function
packages/shared   types imported by BOTH — the integration seam
convex/           auth (Google) + listener data: profiles, shares
docs/             architecture, contract, workflows, setup guides
.planning/        PRD and roadmap
tests/            contract + infra
```

npm workspaces: **one `npm install` at the root, one lockfile.** Never add a per-app lockfile — Vercel
resolves function dependencies from the root, so a split lockfile lets a package exist locally and be
missing in production.

## Hard rules

1. **`docs/api-contract.md` is the contract.** Changing a response shape breaks the other half
   silently. Propose → update the doc → announce → both sides adapt. Never a silent rename.
2. **No provider URLs, tokens or secrets in the frontend.** `NEXT_PUBLIC_*` is inlined into the public
   bundle. Everything provider-side is server-side; secrets live in the host's environment.
3. **Duration is always seconds.** Every provider, every type, every component.
4. **`{ success, data, error? }` on every API response.** `error` is user-facing copy — never a raw
   provider error.
5. **Animate `transform` and `opacity` only.** `width`, `top`, `height`, `box-shadow` are banned in
   transitions.
6. **Every duration and easing comes from a token** (`apps/web/src/motion/index.ts`). No ad-hoc numbers.
7. **`prefers-reduced-motion` collapses to opacity.** It never disables a feature.
8. **TypeScript strict. No `any`.** Provider responses get narrow interfaces covering consumed fields.
9. **Every outbound call** gets an `AbortController` timeout and its own try/catch returning empty —
   never throwing. That is what keeps the provider cascade alive.
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

## Commits

Conventional commits: `feat(api):`, `fix(web):`, `chore(infra):`. Short imperative subject; body only
when the *why* needs explaining. **No AI attribution footers.**

## Branching

`main` is always deployable and always green. Work on `feat/`, `fix/`, `chore/`, `docs/` branches.
Small PRs, squash-merge, reviewed by a non-author.

## What is real vs demo

The **Premium page is a UI demo** — no payments, labelled as such in the UI and the README. Karaoke
sliders are **real**: they mix two genuinely separated stems locally. Don't ship a control that does
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
