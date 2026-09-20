# 13 — COMPLETION PLAN

Written 2026-09-20 after a full read of the repo. Everything else in `.planning/` still stands.

> **Revised same day:** an earlier version of this plan dropped AWS hosting entirely (Render + Vercel)
> to save time. That would have scored **zero on Ship It** — `01-GOAL.md` requires a live AWS URL, and
> it's a hard gate, not a nice-to-have. Corrected path: keep Convex (already built, decisions 1–4 below
> still stand), but host on **AWS Amplify (web) + AWS App Runner (API)** instead of Vercel/Render. See
> `infra/README.md` for the Console-only runbook — no AWS CLI needed.

## Where we were (audit)

| Area | Before | Evidence |
|---|---|---|
| Backend spine: search, songs, home, suggestions, stream (206 preserved), artwork, lyrics ladder, anon auth, likes/recents/libraries/settings | ~92% | 53 API tests green, typecheck clean, 206 tests present |
| Frontend: Discover, Library (likes+recents), Words, player, lyrics, aura, visualizer, states, reduced motion | ~85% | Full cool-blue system, but only ArrowLeft/Right seek; no Space; no playlists UI |
| Persistence + hosting | ~25% for the new target | DynamoDB, Amplify, App Runner, ECR are all AWS-shaped |
| QA | ~55% | API tests only; web has none; 1 lint error on main |
| Submission (README, learning log, demo) | ~25% | README has `<url>` and `<tool>` placeholders; log is empty |
| **Overall** | **~70%** | |

The whole diff (3.9k lines of UI work) was uncommitted on `main`.

## Decisions

1. **Convex replaces DynamoDB** for user data (likes, recents, playlists, settings). The Express API stays the only thing the browser talks to, so `docs/api-contract.md` is untouched.
2. **Convex cannot replace the API.** The audio proxy needs long-lived HTTP with byte-range streaming; Convex functions are not built for that. API runs on AWS App Runner (source-deploy, no Docker/ECR needed), web on AWS Amplify Hosting.
3. Convex functions are public URLs, so every function checks a shared secret (`CONVEX_SERVER_SECRET`) held only by the API.
4. With `CONVEX_URL` unset the API falls back to the in-memory store, so local dev needs no account.
5. **Cut, per the risk register**: Bedrock "Set the mood" (AWS-only), Karaoke sliders and Premium page (never built; README no longer claims them).

## Work list

| # | Task | Done when |
|---|---|---|
| 1 | Fix lint error on `main` (unused `origin`) | `npm run lint` exit 0 |
| 2 | `convex/` schema + functions, secret-guarded | Deployable with `npx convex deploy` |
| 3 | `ConvexUserStore` behind the `UserStore` seam, unit-tested with a fake client | Tests green, memory fallback kept |
| 4 | Delete dead DynamoDB code + AWS SDK deps (App Runner/Amplify replace them, not remove AWS) | No `dynamo`/`@aws-sdk` references — done, verified |
| 5 | Web: recover from a stale/unknown session token (401 → new anon session) | Restarting the API never leaves Library stuck on an error |
| 6 | Web: Space play/pause, playlists (create, add current song, remove, delete) in Library | Uses existing `/api/libraries` endpoints |
| 7 | `amplify.yml`, App Runner source-deploy config, CI rewritten, root `npm run dev` | CI covers web build too |
| 8 | README rewritten for the real stack; honest demo/real table; AI tools named | No placeholders left except the live URL |
| 9 | Verify: typecheck, lint, tests, builds, then run API + web and exercise search → play → seek | Evidence in the final report |

## Needs a human (cannot be done from this session)

- Log in to Convex, create the deployment, set `CONVEX_SERVER_SECRET`, run `npx convex deploy` (optional — the API runs fine with no Convex configured).
- AWS Console (no CLI needed): create the App Runner service, then the Amplify app, following `infra/README.md` step by step. Paste the env vars, close the CORS loop, and put the live Amplify URL in the README.
- Commit and push this work to `main` — Amplify and App Runner both build from GitHub, so nothing deploys until it's pushed.
- Learning log entries and the demo video — those are the team's own words.
