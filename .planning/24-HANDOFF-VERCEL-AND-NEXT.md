# 24 — HANDOFF: Vercel serverless + env sync → Next.js next

Written 2026-09-21 for a cold pickup. Companion plan (session): phased **Vercel-first, Next.js second**.

---

## Copy-paste starter prompt (give this to the next agent)

```
You are continuing Allegra (music streaming web app, First Commit hackathon).

READ FIRST (in order):
1. CLAUDE.md + Agents.md (hard rules: api-contract frozen, no secrets in web, Range→206, playback invariants)
2. .planning/24-HANDOFF-VERCEL-AND-NEXT.md  ← this file (authoritative for current deploy + next work)
3. .planning/23-HANDOFF-KARAOKE.md (karaoke history; Scarleta path is being replaced by AWS Batch on fe/karaoke-aws)
4. infra/README.md (Vercel-only deploy notes)

CURRENT REALITY (do not assume Render):
- Live site is PURE Vercel serverless: static SPA + Express as api/index.ts
- Production: https://allegravibe.vercel.app (alias https://allegra-green.vercel.app → redirects)
- Health verified: GET /api/health → {"ok":true,"version":"0.1.0"}
- Search + stream Range verified: 206 Partial Content with Content-Range
- VITE_API_BASE_URL is blank on Vercel → same-origin /api via vercel.json rewrite
- ALLEGRA_ORIGIN=https://allegravibe.vercel.app
- Do NOT set custom NODE_ENV on Vercel (breaks web npm ci / tsc)
- CONVEX_URL is NOT on Vercel (local was http://127.0.0.1 — production rejects non-https). Users are in-memory until a real https Convex URL is set.
- AWS_SESSION_TOKEN on Vercel will expire; Bedrock may die when it rotates.

BRANCH STATE (verify with git status — it drifts):
- Experience / search-identity / mobile polish landed on tip shared by main + infra/vercel-root-build-fix @ 08d3af7
- Parallel karaoke AWS work is on fe/karaoke-aws (dirty WIP: Scarleta provider removed, aws-batch.provider.ts added, workers/, infra/aws/karaoke-batch.yaml)
- Vercel root-deps + sync script may exist as uncommitted files on whichever branch you open — check package.json for @aws-sdk/* + @modelcontextprotocol/sdk at ROOT, and scripts/sync-vercel-env.mjs

WHAT TO DO NEXT (priority):
1) If on fe/karaoke-aws: finish/commit AWS Batch karaoke OR stash and switch — do not mix Next.js into that branch.
2) Phase B (approved plan): Vite → Next.js App Router on a NEW branch fe/next-app-router from green tip (main / infra/vercel-root-build-fix @ 08d3af7 + any uncommitted Vercel infra fixes first).
   - Client shell layout owns single <audio>, player, MediaSession, shaders
   - Map hash views → real routes: / /discover /library /liked /artist/[name] /album /playlist/[id] /shared/[code]
   - Keep Express at api/index.ts (do NOT rewrite into Next route handlers — Range/206 already works)
   - Tailwind v4: leave Vite plugin → PostCSS; alias @shared via transpilePackages
3) Optional: node scripts/sync-vercel-env.mjs after editing apps/api/.env (never prints secrets; skips localhost CONVEX_URL)

VERIFY BEFORE CLAIMING DONE:
- curl https://allegravibe.vercel.app/api/health
- search → play → Range request stays 206
- npm run typecheck && npm run lint && npm test
- Never put provider URLs/tokens in apps/web
```

---

## 1. What is live on Vercel (Phase A — DONE)

| Piece | State |
|---|---|
| Project | `pratzys-projects/allegra` (`prj_qdhoWdbUIqiZOnLaLnTdzNEUGOhv`) |
| Linked locally | `.vercel/project.json` (projectName `allegra`) |
| CLI user | `pratss` |
| Production URLs | `https://allegravibe.vercel.app` · `https://allegra-green.vercel.app` (307 → vibe) · `https://allegra-pratzys-projects.vercel.app` |
| Serverless entry | Root `api/index.ts` → `createAppFromEnv(process.env)` |
| Rewrite | `vercel.json`: `/api/(.*)` → `/api` |
| Web build | Root install + `npm --prefix apps/web run build` → `apps/web/dist` |

### Env on Vercel (names only — Production / Preview / Development)

**Must-have / core:** `JWT_SECRET`, `ALLEGRA_ORIGIN`, `SAAVN_API_URL`, `GAANA_API_URL`, `LRCLIB_API_URL`, `VITE_API_BASE_URL` (blank = same-origin)

**AI:** `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`, `GROQ_MODEL`, `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `OPENROUTER_MODEL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `AWS_REGION`, `BEDROCK_MODEL_ID`, `AI_PRIMARY`

**Other:** `APP_VERSION`, `S3_COVERS_BUCKET`, `S3_COVERS_PUBLIC_BASE_URL`, `S3_COVERS_REGION`

**Intentionally absent:** `CONVEX_URL`, `CONVEX_SERVER_SECRET` (local was `http://127.0.0.1` — would crash prod with `CONVEX_URL must be an https URL`). Guest data = in-memory until cloud Convex is wired.

**Never set:** custom `NODE_ENV`

### Sync script

```bash
node scripts/sync-vercel-env.mjs
```

- Reads `apps/api/.env`
- Forces `ALLEGRA_ORIGIN=https://allegravibe.vercel.app`, blank `VITE_API_BASE_URL`
- Skips `NODE_ENV`, `PORT`, localhost Convex
- Upserts Production + Preview (`--sensitive`) + Development (no `--sensitive`)
- Prints **key names + ok/FAIL only** — never values

### Root deps (load-bearing)

Vercel resolves function `node_modules` from **repo root**, not `apps/api`. Root `package.json` must include API runtime deps, including:

- `@aws-sdk/client-batch`
- `@aws-sdk/client-s3`
- `@modelcontextprotocol/sdk`
- express, cors, helmet, etc.

Missing those caused production `FUNCTION_INVOCATION_FAILED` / `ERR_MODULE_NOT_FOUND`. Function bundle size after fix ≈ **2.2MB**.

### Verified on production (2026-09-21)

```
GET /api/health → 200 {"ok":true,"version":"0.1.0"}
GET /api/search?q=kesariya&limit=1 → success, song id present
GET /api/stream/:id  Range: bytes=0-1023 → 206 + Content-Range + Accept-Ranges
```

Preview deploys may hit **Vercel Deployment Protection (SSO)** — curl gets 302 to vercel.com/login. Prefer verifying against **production aliases**.

---

## 2. Earlier product work already on tip `08d3af7`

(on `main` / `infra/vercel-root-build-fix` — do not rebuild)

- Search recording collapse + official-single election (`electCanonical`, near-tie, compilation demotion, home cache `home:default:v2`)
- Radio mode (skip remasters / similar vibe)
- Lyrics sheet title→album / artist→artist, YT-style slide
- Focus ring fix (`tabindex=-1` excluded)
- Mobile polish: Home/Browse/Library icons, safe-area, gutters, player tabs
- Media session + audio bands / shader wiring (human eye-check still useful in foreground window)

Handoff for that era: `.planning/21-HANDOFF-EXPERIENCE.md`

---

## 3. Parallel track — karaoke AWS (`fe/karaoke-aws`)

**Do not delete this branch.** AWS karaoke is intentional parallel work.

| | |
|---|---|
| Base commit | `d6561af` Scarleta karaoke |
| Direction | Replace Scarleta with **AWS Batch** HTDemucs stems |
| New / dirty | `aws-batch.provider.ts`, `workers/`, `infra/aws/karaoke-batch.yaml`, `docs/karaoke-aws-*.md`, Scarleta provider deleted in working tree |
| Contract | Still `docs/api-contract.md` karaoke section — update only with propose→doc→announce |
| Old handoff | `.planning/23-HANDOFF-KARAOKE.md` (Scarleta — partially superseded) |

If you need a clean Next.js branch: stash or commit karaoke WIP first, then branch from `main` @ `08d3af7` (plus cherry-pick/commit the Vercel root-deps + sync script if they are not on that tip yet).

---

## 4. Phase B — Vite → Next.js (APPROVED, NOT STARTED)

**Approach:** client shell SPA inside App Router — not an RSC rewrite.

1. Branch `fe/next-app-router` from green tip
2. Root client layout owns: `<audio>`, `useAudioPlayer`, MediaSession, analyser, shaders, mini-player / immersive sheet
3. Routes replace hash views (`#home` → `/`, etc.)
4. Keep `api/index.ts` Express function
5. Tailwind v4 tooling swap; `@shared` alias; gate `window`/`localStorage` for SSR
6. Env: keep same-origin blank base (or `NEXT_PUBLIC_*` only if required)

**Out of scope for B:** moving catalog into Next route handlers; deleting karaoke AWS work.

**Acceptance:** shareable paths for all 8 views; playback invariants intact; 360/390 mobile still good; typecheck/lint/test green; preview/prod on Vercel.

---

## 5. Gotchas (will burn hours if ignored)

1. **`CONVEX_URL` must be `https://` in production** — never sync `http://127.0.0.1`.
2. **Root vs `apps/api` deps** — new API imports need root `package.json` too or cold start 500s.
3. **`NODE_ENV` custom on Vercel** → web build loses `tsc` / vite.
4. **Preview SSO** — public curl may lie; use production aliases.
5. **Byte-range rule** — stream must preserve `206` / `Content-Range` (already verified on Vercel Node).
6. **Playback invariants** — one `requestPlayback` funnel; load effects must not depend on `isPlaying`; seek pause+resume.
7. **`AWS_SESSION_TOKEN`** on Vercel expires — Bedrock/AI may silently degrade.
8. **api-contract.md is frozen** — propose before shape changes.

---

## 6. Useful commands

```bash
# Who / which project
vercel whoami
vercel env ls

# Sync keys from apps/api/.env (no secret echo)
node scripts/sync-vercel-env.mjs

# Preview (may be SSO-locked)
vercel deploy -y

# Production (only when asked)
vercel deploy --prod -y

# Smoke
curl.exe -s https://allegravibe.vercel.app/api/health
curl.exe -sI -H "Range: bytes=0-1023" "https://allegravibe.vercel.app/api/stream/<songId>"

# Quality gate
npm run typecheck
npm run lint
npm test
```

---

## 7. Suggested next commit split (when human asks to commit)

1. `chore(infra): root AWS/MCP deps + vercel env sync script` (on `infra/vercel-root-build-fix` or main PR)
2. Keep `fe/karaoke-aws` commits separate: `feat(api): AWS Batch karaoke stems` etc.
3. Later: `feat(web): migrate SPA to Next.js App Router` on `fe/next-app-router`

Do **not** squash karaoke + Next + Vercel into one commit.
