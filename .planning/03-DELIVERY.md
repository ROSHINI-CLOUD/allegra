# 03 — DELIVERY

All times are **T+hours from your start**, not wall-clock, so this survives whatever the confirmed deadline turns out to be. If you start at 08:00 on 19 Sept, T+30 lands around 14:00 on 20 Sept.

> **Reserve the last 4 hours for submission. Non-negotiable.** T+26 is a hard feature freeze. Every team that ignores this ships a rushed video, and the video is scored.

## Gantt

```
        P1 Backend        P2 Frontend       P3 Infra/Integr.   P4 QA/Submission
T+0  ┌──────────────── PHASE 0 · ALL FOUR · contract + skeleton ─────────────┐
T+2  │ providers        design tokens     mock server +       test harness   │
     │ saavn+gaana      motion primitives AWS accounts        fixtures       │
T+6  ├──── PHASE 1 · SPINE ──────────────────────────────────────────────────┤
     │ /search + norm   search UI +       Amplify live ✅     206 seek test  │
     │ /stream proxy    real <audio>      App Runner live ✅  responsive     │
T+12 ├──── GATE 1: search → play → seek, ON THE DEPLOYED URL ────────────────┤
     │ /artwork         ⭐ cinematic       DynamoDB           bug triage     │
     │ /lyrics ladder      player + motion CI green           long-text      │
T+18 ├──── GATE 2: lyrics sync + the hero transition ────────────────────────┤
     │ ★ Bedrock        polish, states    persistence         video script   │
T+22 ├──── GATE 3: FEATURE COMPLETE · P4 starts filming ─────────────────────┤
     │ harden, cache    a11y, reduced-    monitoring,         🎬 FILM        │
     │                  motion, perf      final deploy        README+writeup │
T+26 ├──── 🛑 FEATURE FREEZE · bugfix only ──────────────────────────────────┤
T+30 └──── SUBMIT ───────────────────────────────────────────────────────────┘
```

---

## PHASE 0 · Foundation — T+0 → T+2 · everyone, together

**Do this in one room (or one call). Nobody writes feature code yet.**

| # | Task | Who | Done when |
|---|---|---|---|
| 0.1 | **Write `docs/api-contract.md`** — every endpoint, request, response, error | All 4 | Everyone has read it and agrees. This is the most valuable 45 minutes of the hackathon. |
| 0.2 | Monorepo skeleton: `apps/web`, `apps/api`, `packages/shared` | P3 | `npm i` and `npm run dev` work for both apps |
| 0.3 | `packages/shared/types.ts` — `UnifiedSong`, `LyricLine`, `ApiResponse<T>` | P1 | Both apps import it and typecheck |
| 0.4 | AWS accounts, Builder Center profiles, enrollment verified, credits applied | P3 + all | Everyone can log in. **Do this first — verification can take time.** |
| 0.5 | `CLAUDE.md` + `AGENTS.md` at repo root | P4 | Committed |
| 0.6 | Mock server from the contract | P3 | P2 can `npm run mock` and get realistic JSON |
| 0.7 | GitHub repo public, branch protection on `main`, CI skeleton | P3 | A PR runs typecheck + lint |

**🚩 Gate 0:** *Four people can work for the next four hours without waiting on each other.*

---

## PHASE 1 · The Spine — T+2 → T+12

The whole point: **search → play → seek, live on AWS.** Nothing else matters until this is true.

### P1 — Backend
- `providers/saavn.ts` — search, song-by-id, suggestions. `BROWSER_HEADERS`, 25 s timeout
- `providers/gaana.ts` — L2, fires only on **zero** results
- `lib/normalize.ts` — → `UnifiedSong`. HTML entity decode, dual artist shape, playCount strip, best-quality pick, drop results with no URL
- `GET /api/search`
- **`GET /api/stream/:songId`** ← the hard one. Forward `Range`, preserve `206`, re-resolve on 403/404
- `GET /api/health` (App Runner needs it)

### P2 — Frontend
- Design tokens + motion primitives from `07-MOTION-DESIGN-SYSTEM.md`
- Search page against the mock server
- **Rip out `setInterval` fake playback.** Real `<audio ref>`, `timeupdate`, the three invariants
- Card grid with stagger-in

### P3 — Infra
- **Amplify Hosting connected and deploying on push** — get a URL live by T+6 even if it renders "hello"
- **App Runner running the API** with `/api/health` green
- SSM parameters, env wiring, `VITE_API_BASE_URL` pointed at App Runner
- CORS allowlist: App Runner accepts the Amplify origin

### P4 — QA
- **The `206` seek test, automated.** Highest-risk silent failure on the project
- Fixtures: long titles, many artists, Devanagari/Tamil, missing art, zero lyrics
- Responsive sweep harness at 360 / 768 / 1280 / 1920
- Start `LEARNING-LOG.md` — an entry per person per checkpoint

### 🚩 GATE 1 (T+12) — hard gate
On the **deployed Amplify URL**, not localhost:
1. Search a song → results with artwork
2. Click → audio plays within 2 s
3. **Drag the scrubber → it seeks.** Verify `206 Partial Content` in DevTools → Network
4. Pause/play behaves (no phantom resume)

**If Gate 1 fails, the whole team converges on it.** No one starts lyrics or polish until it passes. An app that plays music badly beats an app that shows lyrics for music it can't play.

---

## PHASE 2 · Depth & Delight — T+12 → T+22

### P1
- `catalog/catalog.ts` — keep provider cascade, normalization, ranking, and cache coordination behind one deep module
- `lib/streamResolver.ts` — keep URL refresh, Range forwarding, and `206` preservation out of the route
- DynamoDB caching with TTL, including the **negative cache**, behind the `CacheStore` seam (memory locally, DynamoDB in production)
- `GET /api/artwork` — iTunes two-pass, `100x100bb` → `1000x1000bb`
- `GET /api/lyrics` — LRCLIB `/get` → `/search` → interpolated-plain. Return **pre-parsed `LyricLine[]`**
- `GET /api/home`, `GET /api/songs/:id/suggestions`

P1's architecture-aware order is `B6 → B9 → B7 → B8` after the Phase 1 search spine. See `.planning/12-BACKEND-ARCHITECTURE-PLAN.md` for the seam-level verification plan.

### P2 ⭐ — the Best UI window. Protect these hours.
- **The hero transition**: card → full-screen player via shared-element `layoutId`
- Dominant-colour extraction from artwork → ambient background bloom
- Lyrics panel: active-line highlight, smooth scroll, `[INSTRUMENTAL]` as a pulse
- Tactile controls: scrubber with real drag physics, spring-loaded buttons
- Every loading skeleton, empty state, error state

### P3
- DynamoDB tables + TTL
- CI green: typecheck, lint, test on every PR
- CloudWatch log group + a simple dashboard (cheap Ship It points)
- **Re-deploy continuously.** The URL is never stale.

### P4
- Bug triage. File with repro steps, not "it's broken"
- Device sweep on **real phones**, not just devtools
- Draft the video script + shot list
- Start the README

### 🚩 GATE 2 (T+18)
Lyrics scroll in time with audio on the deployed URL, and the card→player transition is smooth at 60 fps.

### 🚩 GATE 3 (T+22) — **FEATURE COMPLETE**
**P4 starts filming.** Anything not working now is cut, not fixed.

---

## PHASE 3 · Harden & Submit — T+22 → T+30

| Who | Does |
|---|---|
| **P1** | Cache tuning, circuit breaker, friendly error copy. **No new endpoints.** |
| **P2** | `prefers-reduced-motion`, keyboard nav, focus states, perf pass. **No new features.** |
| **P3** | Final deploy, monitoring, verify the URL from a phone on mobile data (not office wifi) |
| **P4** | 🎬 **Film, edit, ship.** README. Write-up. AI disclosure. Every box in `01-GOAL.md` |

**🛑 T+26 — FEATURE FREEZE. Bugfix only.** A PR that adds a feature after T+26 gets closed, however small it looks.

### Final 60 minutes — all four, together
- [ ] Live URL works from a phone on mobile data
- [ ] Repo is **public**
- [ ] README runs clean on a fresh clone (**P4 actually tries it**)
- [ ] Video is **under 3:00** — check the actual file
- [ ] Write-up names the AI tools
- [ ] Learning log is committed
- [ ] Submitted, with time to spare

---

## If you are behind

Cut in this order — decided now, while calm:

1. ★ Bedrock feature
2. Library persistence → keep in-memory
3. `/api/home` → one hardcoded curated playlist ID
4. Gaana fallback → Saavn only
5. Lyrics → LRCLIB `/get` only, no `/search`, no interpolation

**Never cut:** the deployed URL, audio playback + seek, or the motion polish on the *one* screen the video features. Those are the three tracks.
