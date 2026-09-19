# 04 — TEAM ROLES

## The split

You asked for 1–2 building and 2 on testing/integration. Here's that shape, adjusted for a ~30-hour window.

**One honest adjustment:** two people testing *full time* for 30 hours would idle them — there isn't enough surface to test until T+12, and manual re-testing of a 6-screen app doesn't fill two people. But two people owning **integration + quality + the entire submission package** is exactly right, because *Presentation* and *Learning & Growth* are **half the judging criteria** and there is **no live judging call** — the video and write-up are the only presentation that exists. So P3 and P4 are your two non-feature people, and their work is directly worth points.

| | Role | Primary | Also owns |
|---|---|---|---|
| **P1** | **Backend & Data** | Express API, providers, normalisation, lyrics ladder, DynamoDB | Defends the data layer in the video |
| **P2** | **Frontend & Motion** ⭐ | React app, the motion system, player, lyrics UI | The Best UI track outcome |
| **P3** | **Infra & Integration** | AWS (Amplify, App Runner, DynamoDB, SSM), CI, env, **the live URL** | Contract tests, wiring FE↔BE, Ship It track |
| **P4** | **QA & Submission** | Test matrix, bug triage, device/responsive checks | **Demo video, README, write-up, AI disclosure, learning log** |

## P1 — Backend & Data

**Owns:** `apps/api/`

- Provider clients: Saavn (L1) → Gaana (L2), iTunes artwork, LRCLIB lyrics
- `UnifiedSong` normalisation — HTML entity decode, dual artist shape, playCount parsing
- The lyrics ladder + LRC parser + candidate scoring
- DynamoDB access layer with TTL caching
- ★ Bedrock endpoint, if we reach the stretch

**Must be able to explain on camera:** why Gaana only fires on *zero results* rather than on error; why lyrics fall back to interpolated timestamps instead of showing nothing.

**Never:** put a provider URL or token in the frontend.

## P2 — Frontend & Motion ⭐

**Owns:** `apps/web/`

- Replace every mock with real API calls (against the mock server until the API is live — **never blocked**)
- Real `<audio>` playback, the three playback invariants (`06-FRONTEND-PLAN.md` §3)
- The motion system in `07-MOTION-DESIGN-SYSTEM.md` — this is the Best UI track
- Lyrics panel driven by real `LyricLine[]`
- Every loading, empty, error and long-text state

**Must be able to explain on camera:** the shared-element transition from card to full player; why everything animates on `transform`/`opacity` only.

**This person does not do AWS, does not write backend code, does not edit the video.** Protect their hours — the Best UI track is where our differentiation lives.

## P3 — Infra & Integration

**Owns:** `infra/`, CI, and the **live URL**

- Amplify Hosting for the SPA · App Runner for the API · DynamoDB tables · SSM parameters
- GitHub Actions: typecheck + lint + test on every PR
- **Writes `docs/api-contract.md` in hour one** with P1 and P2 in the room
- Owns the **mock server** so P2 is never waiting on P1
- Contract tests: does the API actually return what the contract promises?
- **Deploys something on day one and keeps it deployed.** A URL that has been live since T+6 is worth more than a perfect one that appears at T+29.

**Must be able to explain on camera:** the architecture diagram, and why App Runner over Lambda for an audio proxy.

**The escalation rule:** P3 is the first responder for "it works on my machine." Integration failures are P3's to diagnose, then route.

## P4 — QA & Submission

**Owns:** `tests/`, `.planning/LEARNING-LOG.md`, and the entire submission package

**First half (T+0 → T+16) — build the safety net**
- Test matrix in `09-QA-TEST-PLAN.md`
- **The `206` seek test — automate this first.** It's our highest-risk failure and it fails *silently*
- Responsive sweep: 360 / 768 / 1280 / 1920
- Long-text fixtures: 60-char titles, 8 artists, Devanagari + Tamil script, missing artwork, zero lyrics
- Keep the learning log **daily** — it is directly scored and cannot be reconstructed honestly at the end

**Second half (T+16 → T+30) — the submission is the product**
- **Demo video, under 3 minutes** — shot list in `10-SUBMISSION-CHECKLIST.md`. Start filming at **T+22**, not T+29.
- README a judge can actually follow to run it
- Write-up, including the **AI coding tools disclosure**
- Final pass: every checkbox in `01-GOAL.md`

> P4 has the most under-rated job on the team. Two of four judging criteria are theirs, and a great build with a rushed 3-minute video loses to a good build with a great one.

## The integration contract

**Interfaces are agreed in hour one and frozen.**

1. `docs/api-contract.md` — every endpoint, request, response, error shape
2. `packages/shared/types.ts` — `UnifiedSong`, `LyricLine`, `ApiResponse<T>`, imported by **both** sides
3. **The mock server** — P3 stands up MSW or a JSON server from the contract at T+2. P2 develops against it all the way through and flips one env var when the real API is live.

**When the contract must change:** propose it in the channel → update the doc → both sides adapt. Never a silent shape change. A silent rename of one field at hour 20 is how teams lose a night.

## Escalation

| Situation | Do this |
|---|---|
| Blocked > 45 min | Say so in the channel. Don't grind silently. |
| Blocked at two consecutive checkpoints | It gets cut or re-scoped. No exceptions. |
| `main` is red | **Everyone stops.** A red `main` blocks deploys, which risks Ship It. |
| Live URL is down | P3 drops everything. This is the one true emergency. |
| Disagreement on scope | `11-RISK-REGISTER.md` cut list decides. We agreed it while calm — honour it. |
