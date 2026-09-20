# Deployment

```
Vercel (static SPA)  ->  AWS App Runner (Express API)  ->  Convex (user data)
                                |-> JioSaavn / Gaana / iTunes / LRCLIB (server-side only)
```

Ship It (the AWS track) requires a live AWS URL — see `.planning/01-GOAL.md`. The API is the
AWS-hosted piece; be ready to explain that in the write-up since the site's front door is a
Vercel URL, not an `*.amplifyapp.com` one. Convex is the user-data store (likes/recents/
playlists/settings) — it's already built and tested (`apps/api/src/db/convex.ts`, `convex/`),
and the app runs fine with **no Convex configured at all**: `CONVEX_URL` unset means guest data
lives in memory, so a broken Convex deployment never takes the API down.

Why the API is not on Vercel functions: `GET /api/stream/:id` forwards `Range` and preserves
`206`. That needs a long-lived HTTP server, not a serverless function — App Runner is a normal
container host.

No AWS CLI needed. Do the API first (you need its URL for the web app's env var), then the web
app, then loop back and set the API's `ALLEGRA_ORIGIN` to the web app's real URL.

## 1. Convex (5 min)

See `convex/README.md`. `npx convex dev` locally to create a deployment (one-time browser
login), then `npx convex deploy` for prod. Note the deployment URL (`CONVEX_URL`) and set a
`CONVEX_SERVER_SECRET` (16+ chars) in both the Convex dashboard env vars and step 2 below. Skip
this entirely if you're out of time — the API falls back to in-memory storage with no config.

## 2. API on AWS App Runner

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
5. **Environment variables** (Plaintext unless noted **Secret**):
   ```
   NODE_ENV=production
   PORT=8080
   ALLEGRA_ORIGIN=<placeholder for now, e.g. https://allegra.vercel.app>
   JWT_SECRET=<generate 32+ random chars>            # Secret
   SAAVN_API_URL=<your Saavn wrapper URL>            # Secret
   GAANA_API_URL=<your Gaana wrapper URL>             # Secret
   LRCLIB_API_URL=https://lrclib.net/api
   CONVEX_URL=<from step 1, or leave blank>           # Secret
   CONVEX_SERVER_SECRET=<from step 1, or leave blank> # Secret
   ```
6. **Health check**: Protocol HTTP, Path `/api/health`, leave the interval/threshold defaults.
7. **Instance**: 1 vCPU / 2 GB is plenty.
8. Create & deploy. Wait for the service to go green, then note its URL:
   `https://<id>.<region>.awsapprunner.com`.
9. `curl https://<id>.awsapprunner.com/api/health` → `{"ok":true,...}`.

## 3. Web on Vercel

`apps/web` imports `packages/shared/types.ts` through a `tsconfig.json` path alias, so the
project is deployed from the **repo root** (Root Directory left at its default), not from
`apps/web` — that keeps `packages/shared` on disk during the build without needing the
"include files outside the root directory" toggle. The root `vercel.json` does the rest
(`npm --prefix apps/web ci` / `run build`, output `apps/web/dist`).

Dashboard: import the repo, leave Root Directory blank, deploy.

CLI: from the repo root, `vercel link` then `vercel --prod`.

Either way, set the environment variable **before** the first real deploy:
`VITE_API_BASE_URL` = the App Runner URL from step 2.8. Vite inlines this at build time —
changing it later means a rebuild, not just a redeploy, so get the App Runner URL first if you
can. Note the production URL (`https://<project>.vercel.app`, or your custom domain).

No rewrite/redirect rule is needed: the app has no client-side router (single root route), so
there's no deep-link path for a 404 to hide behind.

## 4. Close the loop

Go back to the App Runner service → Configuration → Environment variables → set
`ALLEGRA_ORIGIN` to the real Vercel URL from step 3.5 (no trailing slash) → Deploy. CORS is
origin-checked in `apps/api/src/config.ts`; a stale `ALLEGRA_ORIGIN` is the classic "works on my
machine, CORS-blocked in prod" bug.

## 5. Verify from a phone on mobile data

Search → play → drag the scrubber (DevTools Network tab: confirm `206 Partial Content`, not
`200`) → like a song → reload, the like is still there (or, with no Convex configured, survives
until the API restarts).

## Optional: the fuller AWS story (DynamoDB, ECR, CloudFormation, CloudWatch, Amplify)

`infra/aws/core.yaml` and `infra/aws/app-runner.yaml` are still in the repo — a more
production-shaped version of this (DynamoDB cache/tables, ECR + IAM roles instead of
GitHub-source builds, an SSM parameter store, a CloudWatch dashboard) with the frontend on
Amplify instead of Vercel. Not required for the steps above, and building/pushing the Docker
image to ECR needs the AWS CLI (not installed in this environment). Worth naming in the
write-up as "the next step at real scale" — Technical Understanding rewards knowing the
tradeoff, not just picking the option.
