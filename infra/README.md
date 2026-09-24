# Deployment

One Vercel project serves everything: the Next.js app and the Express API, from a single build.
Convex owns identity and listener data; Karaoke separation stays in the browser.

```
Vercel  ──┬── apps/web            Next.js App Router (the app shell)
          └── /api/*  →  api/index.ts  →  apps/api (Express, one Function)
                            ├── JioSaavn / Gaana / iTunes / LRCLIB   catalog, artwork, lyrics
                            ├── Convex                               sign-in + listener data
                            └── browser worker                       Karaoke separation (on-device)
```

Full walkthrough: [`docs/workflows.md`](../docs/workflows.md).
How it fits together: [`docs/architecture.md`](../docs/architecture.md).

## What `vercel.json` is doing

| Setting | Value | Why |
|---|---|---|
| `framework` | `nextjs` | Vercel builds `apps/web` with the Next builder |
| `outputDirectory` | `apps/web/.next` | where that build lands |
| `installCommand` | `npm install` | npm workspaces: one install covers every package |
| `rewrites` | `/api/(.*)` → `/api` | **load-bearing** — see below |

**The rewrite is the whole trick.** Next's optional catch-all route (`app/[[...slug]]`) matches
every path, including `/api/health`. The rewrite is emitted into an earlier routing phase, so
`/api/*` reaches the Express Function first. Get the order wrong and the site renders perfectly
while every API call 404s — which reads as a frontend bug, not a routing one.

Check it without deploying:

```bash
vercel build
node -e "require('./.vercel/output/config.json').routes.forEach((r,i)=>console.log(i, r.handle||r.src||''))"
```

The `/api` rewrite must appear before `[[...slug]]`. `tests/infra/infra-files.test.mjs` also pins it.

## Dependencies

Vercel resolves a Function's `node_modules` from the **repo root**. This repo uses npm workspaces,
so one root `package-lock.json` covers `apps/api`, `apps/web` and `packages/shared`.

Never add a per-app lockfile. A split lockfile is how a package ends up installed locally and
missing in production, which surfaces as `ERR_MODULE_NOT_FOUND` on a cold start.

Convex functions live in `/convex` and are not a workspace, so their dependencies
(`convex`, `@convex-dev/auth`, `@auth/core`) sit in the root `package.json`.

## Environment

```bash
node scripts/sync-vercel-env.mjs
```

Pushes non-empty keys from `apps/api/.env` to Production / Preview / Development. It forces
`ALLEGRA_ORIGIN` to the production URL and a blank `NEXT_PUBLIC_API_BASE_URL` (same-origin `/api`),
skips `NODE_ENV` and `PORT`, refuses to ship a localhost `CONVEX_URL`, and prints key **names**
only — never values.

Two traps:

- **Never set a custom `NODE_ENV` on Vercel.** Vercel sets it at runtime, and a custom one also
  leaks into the build, making `npm ci` skip devDependencies — the web build then fails with
  `tsc: command not found`.
- **`CONVEX_URL` must be `https://` in production.** A local `http://127.0.0.1` value is rejected
  at startup by design.

## Deploying

```bash
vercel deploy            # preview
vercel deploy --prod     # production — only when asked
npx convex deploy        # Convex schema + functions
```

Preview deployments sit behind Vercel's SSO protection, so a public `curl` against one returns a
login redirect rather than the app. Verify against the production alias:

```bash
curl -s https://allegravibe.vercel.app/api/health
curl -sI -H "Range: bytes=0-1023" https://allegravibe.vercel.app/api/stream/<songId>   # expect 206
```

There is no infrastructure deployment for Karaoke. Its worker and optional local model cache are
created by the browser and never send track audio to the API.
