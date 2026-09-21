# 14 — BACKEND HANDOFF (paste this to the next AI)

Written 2026-09-21. Read `CLAUDE.md` (repo root) first, then this file, then `15-BACKEND-REMAINING.md` (the task list).
Everything here is verified against the working tree, not aspirational. Where something is **not** done it says so.

---

## 0. The prompt to paste

> **Superseded and extended by `.planning/16-FULL-PRODUCT-PROMPT.md`** — that file is the complete prompt (frontend + backend, the Allegra vibe, the definition of "100 percent", the browser self-test loop, and the exact AWS scope). Paste that one; keep this file as the backend reference.

> You are taking over the **backend** of Allegra, a music-streaming web app built for the First Commit hackathon
> (WeMakeDevs × AWS, 17–20 Sept 2026). The frontend is finished for now and talks only to the Express API.
> Your job: (1) make the Convex-backed user system production-ready, (2) put the API and web on **AWS** and
> integrate two or three small AWS services so the project legitimately uses AWS credits, (3) keep
> `docs/api-contract.md` truthful. Obey `CLAUDE.md` hard rules (contract is frozen except additive changes you
> document, no secrets in the frontend, `{success,data,error?}` envelope, duration in seconds, every outbound call
> has an AbortController timeout and never throws, no `any`, conventional commits with **no AI attribution footers**).
> Start with `.planning/15-BACKEND-REMAINING.md`, work top to bottom, and run `npm run typecheck && npm run lint &&
> npm test` before every commit. Do not rewrite what works; extend it.

---

## 1. Repo map (backend-relevant)

```
apps/api/src
  app.ts, config.ts, createAppFromEnv.ts, services.ts, index.ts   composition + env loading
  auth/auth.ts          AuthService: guest, register (guest->account), login (+guest merge), JWT (30d)
  auth/password.ts      scrypt hashing, email/password validation
  user/store.ts         UserData, TasteProfile, ShareRecord, UserStore interface, MemoryUserStore
  user/taste.ts         pure taste maths: applySignal / applySeeds / mergeTaste / playWeight
  db/convex.ts          ConvexUserStore (HTTP client, shared-secret gated)
  routes/auth.ts        /auth/anon|guest|register|login|me, PATCH /me/profile
  routes/user.ts        libraries, liked, recently-played, settings, taste (+ learns on each signal)
  routes/shared.ts      share / unshare / public read / save-copy
  routes/ai.ts          /ai/translate-lyrics, /ai/recommendations (now taste-aware)
  routes/catalog|lyrics|stream|artwork.ts   unchanged catalog + audio proxy
  services/recommendations.ts   AI recs; TasteContext now has favoriteArtists/favoriteLanguages
  ai/                   AiClient cascade: Gemini -> OpenRouter -> NVIDIA -> Groq -> Bedrock
  providers/            saavn, gaana, lrclib, betterlyrics, lyrica, itunes
convex/
  schema.ts   users (+by_email) and shares (+by_code, by_owner_library)
  users.ts    get / byEmail / save   (all gated by CONVEX_SERVER_SECRET)
  shares.ts   get / byLibrary / save / remove
docs/api-contract.md    frozen contract; new section "Accounts, taste and sharing" added 2026-09-21
infra/aws/{core.yaml,app-runner.yaml}, infra/README.md    AWS runbook (Amplify + App Runner)
api/index.ts + vercel.json    the API also runs as a Vercel serverless function (see §6)
```

## 2. What is DONE and verified

- **Convex is connected and working locally.** Run in *anonymous local mode* (no login needed):
  `CONVEX_AGENT_MODE=anonymous npx convex dev` (repo root) starts a local backend at `http://127.0.0.1:3210`,
  writes `.env.local` (`CONVEX_DEPLOYMENT`, `CONVEX_URL`), generates `convex/_generated/`, and pushes the schema.
  `CONVEX_SERVER_SECRET` was set on that deployment with `npx convex env set` and the same value is in
  `apps/api/.env` (`CONVEX_URL=http://127.0.0.1:3210`). A registered user row was confirmed in the `users` table
  (`npx convex data users`). **Production Convex still needs a human login — see task B1.**
- **Accounts**: guest → account conversion keeps the same `userId`; login merges a guest session on the device into
  the account. scrypt hashes. Constant-shape 401 for unknown email vs wrong password.
- **Taste engine** (`user/taste.ts`): a decaying tally of artists (top 60) and languages (top 12) stored on the user
  row. Signals: play, skip (<10 s), like, unlike, playlist-add, onboarding seed. Merged on login. Fed to the AI
  recommender. Unit-tested.
- **Sharing**: 8-char codes stored in Convex `shares`; the link is live (points at the owner's playlist);
  public read needs no session; save-a-copy; revoke.
- **Frontend** already calls all of it (see `apps/web/src/lib/api.ts` bottom section, `hooks/useAccount.ts`).
  Home (`#home`, now the default route) shows the listener's own artists, recents, playlists, likes and AI picks;
  first run shows a two-step taste onboarding; `AuthDialog` does sign up / sign in / sign out; playlists have Share
  and a timed-undo delete.
- **Tests**: 90 API tests green (`npm --prefix apps/api test`), including `src/app.accounts.test.ts` (register/login/
  merge/taste/share/decay) — it runs on the in-memory store. `npm run typecheck` and `npm run lint` are clean.

## 3. What is NOT done (honest list)

1. **No production Convex deployment.** Only the local anonymous one exists; it dies when the process stops and
   its data is local. Prod needs `npx convex login` + `npx convex deploy` by a human (task B1).
2. **No AWS resource exists yet** for this build, and no AWS service is integrated beyond the *optional* Bedrock
   fallback in the AI cascade (hand-rolled SigV4, no SDK). The hackathon's "Ship It" gate needs a live AWS URL
   (task A1) and this feature-set needs at least one clearly-AWS integration (tasks A2–A4).
3. **Convex tests**: the Convex functions have no automated test; `db/convex.test.ts` covers only the old
   get/save round trip with a fake client (it still passes). Add tests for `byEmail`, shares (task B3).
4. **Convex `users` row is one document** holding libraries/likes/recents/taste as arrays. It is fine for the demo
   but has a 1 MB doc limit and read-modify-write races between concurrent requests (two quick likes can lose one).
   Task B4 describes the fix if there is time.
5. **Email verification / password reset do not exist.** Accounts are email+password only, unverified.
6. **Rate limiting** exists for `/api/auth` (30/min) but is per-process memory; behind App Runner with >1 instance
   it is per instance. Acceptable for the demo.
7. **`taste` signal on unlike/skip can push a score below zero → the entry is dropped** (by design), but there is
   no "clear my taste" endpoint. Task B5 (small).
8. Frontend polish left over (not backend): the album page only lists tracks the search returned (needs an album-tracks
   lookup, see `packages/shared` `ArtistProfile.albums`); phone layouts of Home were not visually verified.

## 4. How to run everything locally

```
# terminal 1 — Convex (local, no login)
CONVEX_AGENT_MODE=anonymous npx convex dev
# terminal 2 — API + web together
npm run dev            # scripts/dev.mjs starts apps/api (:8080) and apps/web (:5173)
```
Vite proxies `/api` to `http://127.0.0.1:8080`. If the API process dies the UI shows "The music service returned an
unexpected response" — restart `npm --prefix apps/api run dev` (it does not read `.env` changes without a restart).
Without Convex (`CONVEX_URL` blank) the API silently uses `MemoryUserStore` — everything works, nothing persists.

Smoke test the account path with curl:
```
T=$(curl -s -X POST localhost:8080/api/auth/anon | node -pe "JSON.parse(require('fs').readFileSync(0)).data.token")
curl -s -X POST localhost:8080/api/auth/register -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"a-long-password","displayName":"Me"}'
```

## 5. Environment variables

| Var | Where | Notes |
|---|---|---|
| `CONVEX_URL`, `CONVEX_SERVER_SECRET` | API host | Both or neither. Secret must equal the one set **inside Convex** (`npx convex env set CONVEX_SERVER_SECRET …`, or dashboard → Settings → Environment Variables). Convex dev and prod keep separate values. |
| `JWT_SECRET` | API host | Required in prod. Rotating it signs everyone out. |
| `ALLEGRA_ORIGIN` | API host | The exact web origin for CORS (Amplify domain in prod). |
| `SAAVN_API_URL` (+ `GAANA_API_URL`, `LRCLIB_API_URL`) | API host | Prod refuses to start without `SAAVN_API_URL`. |
| `GEMINI_API_KEY`… `GROQ_API_KEY`, `AWS_*`, `BEDROCK_MODEL_ID` | API host | All optional. AI routes answer `503` with none set. |
| `VITE_API_BASE_URL` | web build | Public URL of the API. **Vite inlines `VITE_*` into the public bundle: never put a secret there.** |

`.env`, `.env.local` are git-ignored. Do not commit secrets; the secret in `apps/api/.env` is a local-dev value.

## 6. Hosting reality check (read before touching infra)

`.planning/13-COMPLETION-PLAN.md` says the deploy target is **AWS Amplify (web) + AWS App Runner (API)** because the
hackathon needs a live AWS URL. The recent git history instead moved the whole thing to **Vercel** (root build, the
API as a serverless function in `api/index.ts`) — `git log --oneline -5` shows this. A serverless function is a poor
fit for the audio proxy (long-lived byte-range streaming) and it is not AWS. Treat Vercel as a preview only. The
AWS path is task A1; do not delete the Vercel files until AWS is live and verified.

## 7. Rules that bit us (keep them)

- Playback invariants and the byte-range rule in `CLAUDE.md` are untouched by this work; do not regress them.
- Convex field names must be ASCII, so arrays (`[{name, score}]`) are used for taste, never records keyed by artist name.
- `exactOptionalPropertyTypes` is on: build optional fields with `...(x ? { k: x } : {})`, never `k: undefined`.
- Convex `save` uses `db.replace`, not `patch`, so a dropped optional field (cleared display name) really disappears.
- `infra/infra-files.test.mjs` asserts **no AWS SDK code in the API**. Bedrock works via hand-rolled SigV4; if you add an
  AWS SDK on purpose, update that test in the same commit and say why.
- Commits: conventional (`feat(api):`, `fix(web):`, `chore(infra):`), no AI footers. `main` must stay green.
