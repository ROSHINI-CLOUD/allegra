# 25 — GOAL: AWS karaoke · Convex data + Google auth · Next.js · Vercel-only

Written 2026-09-21. Hackathon is over; this is the real product now. Supersedes the Render
assumptions in `CLAUDE.md` / `infra/README.md` (see Phase 5).

## End state

| Area | Target |
|---|---|
| Karaoke | AWS Batch Spot GPU → vocals + instrumental stems in private S3 → Web Audio Sing mode. **No Scarleta.** |
| User data | **Convex** is the only store: users, libraries, likes, recents, taste, shares. |
| Auth | **Convex Auth** with **Google** sign-in (+ guest). Keys supplied later; UI/UX + backend built now behind env. |
| Frontend | **Next.js App Router** (client-shell SPA), real routes for every view. |
| Hosting | **Vercel only.** Express stays at `api/index.ts`. **No Render anywhere.** All keys in Vercel env. |
| Backend | Organised by seams (ports/adapters), atomic where money or data is at stake, no dead code. |

## Rules of engagement (credit safety)

1. **No GPU job, no stack deploy, no Convex prod deploy without the owner saying "go".** Prepare, dry-run, then hand over exact commands.
2. Read-only AWS CLI (`sts`, `describe-*`, `list-*`, `service-quotas`) is fine any time.
3. Dev Batch `MaxvCpus=4` (one g4dn.xlarge). Budget alert is part of the stack. Owner runs the single end-to-end test song and reports back measured numbers; nothing in `docs/karaoke-aws-cost-benchmark.md` is filled by guess.
4. Never print secrets. Never put provider URLs/keys in `apps/web`.
5. `docs/api-contract.md` is frozen: propose → update doc → announce → adapt both sides.
6. Playback invariants and the byte-range (`206`) rule stay intact through every phase.

## Phases (each ends green: `typecheck` · `lint` · `test`, then one commit split per concern)

### Phase 1 — Karaoke on AWS (branch `fe/karaoke-aws`) — IN PROGRESS
Done: stateless provider (S3 conditional-write claim, manifest sentinel, Batch reconcile-on-read), no background polling
(serverless-safe), worker exit-code classification + strict sample alignment + baked weights, 20-concurrent = 1 job test.
Left: CFN (backend IAM policy/user, budget alert, tighter worker role), frontend drift guard + `ended` + "user still wants Sing",
docs/handoff refresh, owner-run AWS smoke test.

### Phase 2 — Backend architecture (`codebase-design` skill; branch `be/architecture`)
- npm **workspaces** so API deps are declared once (kills the root-vs-`apps/api` `ERR_MODULE_NOT_FOUND` class of bug).
- Composition root (`services.ts`) split by domain; ports for `UserStore`, `CacheStore`, `SeparationProvider`, `AuthVerifier`.
- Replace ad-hoc scans with indexed/keyed lookups and bounded caches; add request coalescing where fan-out exists.
- Atomicity: every "check then write" that costs money or duplicates data gets a single conditional write (pattern already proven in karaoke claim).
- Exit criteria: `graft`-verified no cyclic deps between domains; each seam has a fake used by tests.

### Phase 3 — Convex + Google auth (branch `be/convex-auth`)
- Convex cloud deployment (https URL) replaces in-memory guests on Vercel.
- **Convex Auth** (`@convex-dev/auth`) Google provider; API verifies Convex-issued JWTs (JWKS) instead of minting its own.
- Migrate `users.ts` to `authTables`-compatible shape; guest → account merge; remove `passwordHash` path after cutover.
- UI: sign-in sheet (Google button, guest continue), account menu, signed-out states; all copy user-facing, no provider errors.
- Needs from owner (later): Google OAuth client id/secret, authorised redirect URIs, `npx convex login`.

### Phase 4 — Next.js (branch `fe/next-app-router`, from green tip)
- Client-shell layout owns the single `<audio>`, player, MediaSession, shaders.
- Routes: `/` `/discover` `/library` `/liked` `/artist/[name]` `/album` `/playlist/[id]` `/shared/[code]`.
- **Spike first (preview deploy):** confirm root `api/index.ts` keeps serving `/api/*` in a Next.js Vercel project; if not, mount Express via a catch-all Node route handler that streams (Range/206 must survive).
- Tailwind v4 → PostCSS; `@shared` via `transpilePackages`; gate `window`/`localStorage` for SSR.

### Phase 5 — Vercel-only, no Render
- Grep and remove every Render reference (`CLAUDE.md`, `infra/README.md`, CI, docs, env names).
- One env source of truth: `apps/api/.env.example` ↔ `scripts/sync-vercel-env.mjs`; add karaoke + Convex + auth vars; dedicated `KARAOKE_AWS_*` keys (the shared `AWS_SESSION_TOKEN` expires).
- Production smoke: `/api/health`, search → play with `206`, Sing request, sign-in.

## Paste-ready `/goal`

```
/goal Allegra is fully on: (1) AWS Batch karaoke with vocals+instrumental stems and no Scarleta, (2) Convex for all user data with Google sign-in via Convex Auth, (3) a Next.js App Router frontend with real routes, (4) Vercel only — no Render, all keys in Vercel env, (5) a clean seam-based backend. Work the phases in .planning/25-GOAL-AWS-CONVEX-NEXT.md in order. Done when npm run typecheck, npm run lint and npm test are green on each branch, the Range→206 stream rule and the three playback invariants still hold, and I have run the AWS smoke test and confirmed it. Never run a GPU job, deploy a stack, or deploy Convex/Vercel to production without my explicit go.
```
