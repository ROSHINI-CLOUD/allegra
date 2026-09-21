# 15 — BACKEND: WHAT REMAINS (ordered task list)

Companion to `14-HANDOFF-BACKEND.md`. Work top to bottom. Each task has a **done-when** you can verify. Sizes: S ≈ 30 min, M ≈ 2 h.

The hackathon needs **a live AWS URL** and **AWS credits actually used**. Section A does that with the smallest
possible surface; section B finishes Convex; section C is optional polish.

---

## A. AWS (small, easy, real)

### A1 · Host on AWS — App Runner (API) + Amplify (web) — M ★ required
Why: it is the "Ship It" gate (`01-GOAL.md`) and uses credits. Runbook already written: `infra/README.md`,
`infra/aws/app-runner.yaml`, `infra/aws/core.yaml` (Console-only, no AWS CLI needed).
Steps:
1. App Runner → create service from the GitHub repo, source directory `apps/api`, build `npm ci && npm run build`,
   start `node dist/index.js`, port 8080. (Repo also has a `Dockerfile` for the API; source deploy is simpler.)
2. Set env vars from `14-HANDOFF §5` on the service (`JWT_SECRET`, `CONVEX_URL` = **production** Convex URL, `CONVEX_SERVER_SECRET`,
   `ALLEGRA_ORIGIN` = the Amplify domain, `SAAVN_API_URL`, `GAANA_API_URL`, `LRCLIB_API_URL`, AI keys optional). Health check path: `/api/health`.
3. Amplify Hosting → connect the repo, app root `apps/web`, build `npm ci && npm run build`, output `dist`. Add env `VITE_API_BASE_URL=https://<apprunner-domain>`.
   Add an SPA rewrite `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|mp3|mp4)$)([^.]+$)/>` → `/index.html`.
4. Set the API's `ALLEGRA_ORIGIN` to the Amplify URL (CORS), redeploy.
**Done when:** the Amplify URL loads Home, search → play works, **seeking works** (the 206 range rule; check with
`curl -H "Range: bytes=0-10" -I https://<api>/api/stream/<id>` → `206` + `Content-Range`), a guest can register and the
row appears in the **production** Convex `users` table.

### A2 · Amazon Bedrock as the primary AI provider — S ★ zero new code
The cascade already ends in Bedrock (`apps/api/src/ai/providers/bedrock.ts`). Make it first so recommendations and
lyric translation spend AWS credits.
1. Bedrock console → Model access → enable a Claude Haiku model in the region you deploy (default in `.env.example`: `anthropic.claude-3-haiku-20240307-v1:0`, `us-east-1`).
2. Create an IAM user (or, better, an App Runner **instance role**) with `bedrock:InvokeModel` only. Prefer the role;
   if you must use keys set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` on App Runner. (The provider currently signs with keys; supporting the
   role's temporary credentials needs `AWS_SESSION_TOKEN` handling — S extra, see `providers/bedrock.ts`.)
3. In `apps/api/src/services.ts` `buildAiClient`, add a config flag `AI_PRIMARY=bedrock` that moves Bedrock to the front of the provider list. Default order unchanged.
**Done when:** `GET /api/ai/recommendations` (with a taste-rich account) returns `provider: "bedrock"` and CloudWatch shows an `InvokeModel` call.

### A3 · CloudWatch logs + one alarm — S
App Runner ships stdout to CloudWatch automatically (`pino` already logs JSON). Add one alarm on 5xx count and note the log group in `infra/README.md`.
**Done when:** you can find a request log line by `x-request-id` in CloudWatch and the alarm exists.

### A4 · Pick ONE of these small integrations (each is independent)
| Option | What it gives the product | Effort | How |
|---|---|---|---|
| **S3 + CloudFront for playlist covers / avatars** | Users upload a custom playlist cover or avatar | M | API route `POST /api/uploads/sign` returns a short-lived **presigned PUT URL** (sign with SigV4 by hand like `bedrock.ts`, or add the SDK deliberately — update `tests/infra`); store the resulting key on the library (`coverKey`, additive to `LibraryRecord`) |
| **Amazon SES** | Welcome email on register; "someone shared a playlist with you" email | M | `POST /api/libraries/:id/share` accepts optional `email`; send via SES `SendEmail` (sandbox: verify sender + recipient). Rate limit it. |
| **Amazon Translate** | Cheaper first tier for lyric translation before the LLM cascade | S | Add a provider ahead of the AI cascade in `services/translation.ts`; keep the LLM as fallback for languages it lacks |
| **Amazon Polly** | "Read this aloud" for lyrics / accessibility | S | New `POST /api/ai/speak` → audio; low product value, high demo value |
Recommendation: **A2 (Bedrock) + A1 (hosting) + S3/CloudFront covers** — three clearly-AWS pieces, none of them core.
**Done when:** the chosen feature works on the deployed URL and is named in the README's "How we used AWS" section.

### A5 · README + learning log — S
`README.md` has placeholders. Fill "How we used AWS" (hosting, Bedrock, the A4 choice), keep the "what's real vs demo" honesty
(`CLAUDE.md`), and add a line per lesson to `.planning/LEARNING-LOG.md` (the submission scores it).

---

## B. Convex (finish it)

### B1 · Production deployment — S ★ needs a human once
A human must run, in the repo root (needs a browser login, cannot be scripted):
```
npx convex login
npx convex deploy            # creates the prod deployment, pushes schema + functions
npx convex env set CONVEX_SERVER_SECRET <new-long-random> --prod
```
Then put the printed `https://<name>.convex.cloud` URL and the same secret into the API host env (A1 step 2).
Generate the secret with `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. Never reuse the local-dev value.
**Done when:** `npx convex data users --prod` shows a row created from the deployed site.

### B2 · Delete the throwaway local data — S
The local deployment has a smoke-test account (`smoke@example.com`). It is local-only; nothing to clean in prod. Do **not** commit `.env.local`.

### B3 · Tests for the Convex layer — M
- Extend `apps/api/src/db/convex.test.ts`: `findByEmail`, `getShare/saveShare/deleteShare/findShare`, parsing of `taste`, malformed rows → `null`.
- Add a test that a wrong `CONVEX_SERVER_SECRET` surfaces as `PersistenceError` → HTTP 502 with the friendly copy (never the raw error).
- Optional: a script `scripts/convex-smoke.mjs` that registers, likes, shares and reads back against a running deployment.

### B4 · Kill the read-modify-write race — M (do only if time)
Today each request loads the whole user, edits arrays, saves the whole document. Two overlapping writes can drop one.
Cheapest fix: add Convex mutations that operate atomically — `users.addLike`, `users.removeLike`, `users.addToLibrary`, `users.recordPlay`,
`users.applyTaste` — each reading and patching inside one transaction, and have `ConvexUserStore` expose matching methods that routes call
instead of `save()`. Keep `MemoryUserStore` behaviour identical. The `UserStore` interface grows; update the fake in `app.routes.test.ts`.
Bigger fix (split into `libraries`, `likes`, `plays` tables) only if the 1 MB document limit ever matters (≈ thousands of plays).

### B5 · Small account features — S each
- `DELETE /api/me/taste` → reset taste (`onboarded: false`) so a user can re-run onboarding.
- `DELETE /api/me` → delete the account (remove user row + their `shares`). Requires password in the body.
- Email verification / reset are **out of scope** unless SES (A4) is chosen; if so, add a `verifiedAt` field and a signed-token flow.
Update `docs/api-contract.md` for anything you add (additive only).

### B6 · Guard the public share endpoint — S
`GET /api/shared/:code` is unauthenticated. Add a dedicated rate limit (e.g. 60/min/IP) in `app.ts` next to the `auth` limiter, and cap `songs` at 200.

---

## C. Optional polish (only after A1–A2 and B1)

- `BETTERLYRICS_API_KEY` for uncached lyrics (see `.env.example`).
- Album-tracks lookup so album pages list the whole album (`catalog.getArtist(...).albums` has ids; add `GET /api/albums/:id`, additive).
- Home "Because you like X" shelves: take `taste.topArtists[0..2]`, fetch each artist's top songs (`GET /api/artists/:name`), return from a new `GET /api/me/home` so the browser makes one call.
- Make `useListenTracker` (frontend) also flush on `pagehide` via `navigator.sendBeacon` so the last song's listen time is not lost.

---

## Verification checklist before you say "done"

```
npm run typecheck && npm run lint && npm test          # all exit 0
curl -s $API/api/health                                # {success:true}
curl -s -o /dev/null -w "%{http_code}" -H "Range: bytes=0-10" $API/api/stream/<songId>   # 206
```
Then on the **deployed** web URL: fresh browser → Home shows onboarding → pick 3 artists → Home shows "Your artists" →
play two songs → reload → Home still shows them (data came from Convex) → create a playlist → Share → open the link in a
private window (no login) → Save to my library from a second account. Film that path; it is the demo.
