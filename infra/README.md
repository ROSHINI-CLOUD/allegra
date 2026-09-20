# Deployment

**Live right now:** everything — static frontend and the whole Express API — on one Vercel
project. `api/index.ts` wraps the existing app (`createAppFromEnv`, shared with the App Runner
entrypoint below) as a serverless function; `vercel.json` rewrites `/api/(.*)` to it. Verified
live, including the one behavior that's supposed to be the hard part:
`GET /api/stream/:id` with a `Range` header returns real `206 Partial Content` with correct
`Content-Range`/`Accept-Ranges` on Vercel's Node runtime.

**Still needed before the actual hackathon submission:** Ship It (`.planning/01-GOAL.md`)
requires a live **AWS** URL, and this Vercel-only deploy doesn't touch AWS at all. The plan is
to move the API from Vercel functions to AWS App Runner (steps below) before submitting —
today's Vercel deploy was to get something fully working fast, not the final architecture.

```
Today, live:     Vercel (static SPA + /api/* serverless functions) -> Convex (user data)
Before submit:   Vercel (static SPA) -> AWS App Runner (Express API) -> Convex (user data)
                                              |-> JioSaavn / Gaana / iTunes / LRCLIB
```

Convex is the user-data store (likes/recents/playlists/settings) — already built and tested
(`apps/api/src/db/convex.ts`, `convex/`). The app runs fine with **no Convex configured at
all**: `CONVEX_URL` unset means guest data lives in memory, so a broken Convex deployment never
takes the API down.

## Today's Vercel-only setup (already done, for reference)

- Root `vercel.json`: `installCommand: npm install && npm --prefix apps/web ci`,
  `buildCommand: npm --prefix apps/web run build`, `outputDirectory: apps/web/dist`, plus the
  `/api/(.*)` → `/api` rewrite.
- Root `package.json` carries the API's runtime dependencies (express, cors, helmet, etc.) —
  duplicated from `apps/api/package.json` on purpose, because Vercel Functions resolve
  `node_modules` from the **project root**, not `apps/api/`, and this repo has no npm
  workspaces to hoist them automatically. Keep both in sync if a backend dependency changes.
- Env vars set directly via `vercel env add` (CLI): `ALLEGRA_ORIGIN`, `JWT_SECRET`,
  `SAAVN_API_URL`, `GAANA_API_URL`, `LRCLIB_API_URL`, `VITE_API_BASE_URL` (all pointing at the
  deployment's own URL, since frontend and API are same-origin here). **Do not** set `NODE_ENV`
  as a custom Vercel env var — Vercel sets it automatically at function runtime, and a custom
  one also leaks into the *build* step, which makes `npm ci` skip devDependencies
  (`typescript`, `vite`) and breaks the web build with `tsc: command not found`.
- `CONVEX_URL`/`CONVEX_SERVER_SECRET` not set yet — in-memory fallback is live instead.

## Moving the API to AWS App Runner (do this before submitting)

No AWS CLI needed — everything below is Console-only, from GitHub source, no Docker/ECR.

Console → **App Runner** → **Create service**.

1. **Source**: *Source code repository* → connect GitHub → select this repo, branch `main`.
2. **Deployment trigger**: Automatic (redeploys whenever `main` moves).
3. **Source directory**: `apps/api` — App Runner's monorepo support builds/runs from this
   subfolder, and `apps/api` is fully self-contained (own `package.json`, no workspace
   dependency), so no root `apprunner.yaml` is needed.
4. **Configure build**: "Configure all settings here" (skip the yaml-file option):
   - Runtime: **Node.js 20**
   - Build command: `npm ci && npm run build`
   - Start command: `npm start`
   - Port: `8080`
5. **Environment variables** (Plaintext unless noted **Secret**) — same values already live on
   Vercel (`vercel env ls`), just copied over:
   ```
   NODE_ENV=production
   PORT=8080
   ALLEGRA_ORIGIN=<the Vercel URL, e.g. https://allegra-green.vercel.app>
   JWT_SECRET=<generate 32+ random chars>            # Secret
   SAAVN_API_URL=<your Saavn wrapper URL>            # Secret
   GAANA_API_URL=<your Gaana wrapper URL>             # Secret
   LRCLIB_API_URL=https://lrclib.net/api
   CONVEX_URL=<from convex/README.md, or leave blank>           # Secret
   CONVEX_SERVER_SECRET=<from convex/README.md, or leave blank> # Secret
   ```
6. **Health check**: Protocol HTTP, Path `/api/health`, leave the interval/threshold defaults.
7. **Instance**: 1 vCPU / 2 GB is plenty.
8. Create & deploy. Wait for the service to go green, then note its URL:
   `https://<id>.<region>.awsapprunner.com`.
9. `curl https://<id>.awsapprunner.com/api/health` → `{"ok":true,...}`.
10. Back on Vercel, change `VITE_API_BASE_URL` to the App Runner URL, remove the `/api/(.*)`
    rewrite from `vercel.json` (the API isn't on Vercel anymore), redeploy the frontend.
11. Set `ALLEGRA_ORIGIN` on App Runner to the real Vercel URL (no trailing slash) and redeploy —
    CORS is origin-checked in `apps/api/src/config.ts`, and a stale `ALLEGRA_ORIGIN` is the
    classic "works on my machine, CORS-blocked in prod" bug.

## Verify from a phone on mobile data

Search → play → drag the scrubber (DevTools Network tab: confirm `206 Partial Content`, not
`200`) → like a song → reload, the like is still there (or, with no Convex configured, survives
until the API restarts).

## Optional: the fuller AWS story (DynamoDB, ECR, CloudFormation, CloudWatch, Amplify)

`infra/aws/core.yaml` and `infra/aws/app-runner.yaml` are still in the repo — a more
production-shaped version of the App Runner setup above (DynamoDB cache/tables, ECR + IAM
roles instead of GitHub-source builds, an SSM parameter store, a CloudWatch dashboard) with the
frontend on Amplify instead of Vercel. Not required for the steps above, and building/pushing
the Docker image to ECR needs the AWS CLI (not installed in this environment). Worth naming in
the write-up as "the next step at real scale" — Technical Understanding rewards knowing the
tradeoff, not just picking the option.
