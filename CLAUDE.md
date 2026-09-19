# Allegra — project rules for AI agents

Music-streaming web app. Built for **First Commit** (Bharat Builds Tour, WeMakeDevs × AWS), 17–20 Sept 2026. Team of 4, ~30 hours.

**Before doing anything:** read `.planning/03-DELIVERY.md` for where we are, then the plan for your area (`05-BACKEND-PLAN.md`, `06-FRONTEND-PLAN.md`, `07-MOTION-DESIGN-SYSTEM.md`, `08-AWS-DEPLOYMENT.md`, `09-QA-TEST-PLAN.md`).

## Repo
```
apps/web      React 19 · Vite · Tailwind v4 · Framer Motion   (P2)
apps/api      Node 20 · Express · TypeScript                  (P1)
packages/shared   types imported by BOTH — the integration seam
infra/        AWS config, CI                                  (P3)
tests/        contract + integration                          (P4)
.planning/    GSD docs — the plan
docs/         reference, API contract, agent briefings
```

## Hard rules

1. **`docs/api-contract.md` is frozen.** Changing a response shape breaks the other half of the team silently. Propose → update the doc → announce → both sides adapt. Never a silent rename.
2. **No provider URLs, tokens or secrets in the frontend.** Vite inlines `VITE_*` into the public bundle. Everything provider-side is server-side. Secrets come from SSM at boot.
3. **Duration is always seconds.** Every provider, every type, every component.
4. **`{ success, data, error? }` on every API response.** `error` is user-facing copy — never a raw provider error.
5. **Animate `transform` and `opacity` only.** `width`, `top`, `height`, `box-shadow` are banned in transitions.
6. **Every duration and easing comes from a token** (`src/motion/index.ts`). No ad-hoc numbers.
7. **`prefers-reduced-motion` collapses to opacity.** It never disables a feature.
8. **TypeScript strict. No `any`.** Provider responses get narrow interfaces covering only consumed fields.
9. **Every outbound call** gets an `AbortController` timeout and its own try/catch returning empty — never throwing. That's what keeps the provider cascade alive.
10. **No `console.log` in production paths.** Wrap in `if (import.meta.env.DEV)` or use the logger.

## The three playback invariants
Each was a real production bug in the reference implementation. Do not regress them.

1. **One funnel.** All play/pause goes through `requestPlayback(playing)`. Never `setIsPlaying(...)` *and* `audio.play()` from a component. The raw setter is only for syncing **from** the audio element's events.
2. **Load effects must never depend on `isPlaying`.** An effect listing it in deps that calls `.play()` re-fires on the user's own pause and instantly resumes — pause appears to do nothing. Read play state imperatively inside the effect.
3. **Seek pauses. Always resume.** Capture `wasPlaying`, set `currentTime`, resume if it was playing.

## The byte-range rule ⭐
`GET /api/stream/:songId` forwards the client's `Range` header and **preserves the upstream status**. A `206` must stay a `206`, with `Content-Range` and `Accept-Ranges` passed through. Collapse it to `200` and audio plays perfectly while seeking silently does nothing — our highest-risk failure, because it looks fine.

## Commits
Conventional commits: `feat(api):`, `fix(web):`, `chore(infra):`. Short imperative subject; body only when the *why* needs explaining. **No AI attribution footers** — these look like normal human commits.

## Branching
`main` is always deployable and always green. Work on `be/`, `fe/`, `infra/`, `qa/` branches. Small PRs, squash-merge, reviewed by a non-author. **A red `main` stops the whole team** — it blocks deploys, which risks the Ship It track.

## Verifying
```
npm run typecheck    # exit 0
npm run lint         # exit 0
npm test             # all green
```
Run all three before opening a PR. Frontend work also gets checked at 360 / 768 / 1280 / 1920, and the hero transition gets profiled on a **real phone**, not a laptop.

## Scope
`.planning/11-RISK-REGISTER.md` holds the cut list, agreed while we were calm. Anything not on the must-ship list in `.planning/01-GOAL.md` is a no. **Feature freeze at T+26**, bugfix only.

## What's real vs demo
Karaoke sliders are a **visual mode** — real stem separation needs GPU processing and is out of scope. The Premium page is a **UI demo**, no payments. Both are labelled as such in the UI and the README. Don't ship a control that does nothing and present it as a feature.
