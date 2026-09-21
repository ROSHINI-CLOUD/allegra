# Allegra

> A music-streaming web app with a real catalog, real audio, time-synced lyrics, and an interface built to feel like an instrument rather than a list.

**Live (preview):** [allegra-green.vercel.app](https://allegra-green.vercel.app) · **Ship It target:** AWS Amplify (web) + App Runner (API) — run `bash scripts/aws-ship-it-wizard.sh` · Built for **First Commit** (Bharat Builds Tour · WeMakeDevs × AWS), 17–20 Sept 2026

## What this is

Allegra began as a fully mocked front-end: hardcoded songs, playback faked with a timer, accounts faked in `localStorage`. It is now a working product: live catalog, streaming audio with working seek, artwork, time-synced lyrics with graceful degradation, guest sessions, likes, recently played and playlists that persist.

## Architecture

```
Browser  (React 19 · Vite · Motion)
   |
   |-- AWS Amplify Hosting       static SPA, CDN
   |
   `-- AWS App Runner            Express API, container, long-lived
         |-- JioSaavn -> Gaana   catalog + audio (server-side, because of CORS)
         |-- iTunes Search       artwork
         |-- LRCLIB (+ Lyrica)   time-synced lyrics
         `-- Convex              guest users, likes, recents, playlists
```

**Why the app is hosted on AWS:** Ship It (one of the event's three judged tracks) requires a live AWS URL. Amplify Hosting serves the SPA; App Runner runs the API as a normal container with no VPC or ALB to wrangle.

**Why the API is a real server and not Convex functions or serverless:** `GET /api/stream/:id` proxies audio and has to forward `Range` and preserve `206 Partial Content`. That is ordinary long-lived HTTP; function runtimes (Lambda included) make it awkward. Convex is used for what it is good at, durable user data — DynamoDB would have been pure rework for no judging benefit, so the data layer uses Convex while the compute layer stays on AWS.

**Why the browser never talks to Convex:** the API owns auth (an anonymous JWT issued on first load) and calls Convex with a shared secret that every Convex function checks. The public API contract in [`docs/api-contract.md`](docs/api-contract.md) did not change when the database moved.

Deployment steps: [`infra/README.md`](infra/README.md) · Convex setup: [`convex/README.md`](convex/README.md)

## Run it

```bash
git clone <repo> && cd allegra
npm install
npm --prefix apps/api install && npm --prefix apps/web install

cp apps/api/.env.example apps/api/.env      # works as-is; no keys needed
npm run dev                                  # web :5173 · api :8080
```

Open http://localhost:5173. Guest data stays in memory until you set `CONVEX_URL` and `CONVEX_SERVER_SECRET` (see `convex/README.md`).

```bash
npm run typecheck && npm run lint && npm test
```

Keyboard: `Space` play/pause, `←` `→` seek 5 s, `⌘/Ctrl K` search, `Esc` closes the player.

## The interesting problems

**Seeking silently did nothing.** A naive proxy collapses the upstream `206 Partial Content` into a `200` with the whole body, so the browser has no byte range to seek within. Audio plays perfectly, which is what makes it hard to find. The proxy forwards `Range` and preserves the upstream status and `Content-Range`, and a test pins it.

**Lyrics that don't exist.** Rather than showing nothing when a track has no synced lyrics, plain text is interpolated evenly across the duration. Synced and interpolated lyrics share one render path.

**CORS.** The reference implementation for these providers is a mobile app, which has no origin and no preflight. A browser has both, and the audio CDN sends no permissive `Access-Control-Allow-Origin`. Every provider call is server-side; that is why the backend exists.

**A token that outlives its user.** On an in-memory or freshly reset store, a saved JWT points at nobody and every personal call returns 401. The web client now renews the guest session once and retries, so Library never gets stuck on an error.

## What's real, what's not

| | |
|---|---|
| Catalog, audio, seek, artwork, lyrics | **Real** |
| Guest sessions, likes, recently played, playlists | **Real**, persisted in Convex when configured |
| Karaoke sliders, Premium page | **Not built.** Real stem separation needs GPU processing and there are no payments, so we left them out rather than ship controls that do nothing |
| AI "set the mood" | **Not built.** The mood pills run a plain search |

## A note on the providers

Allegra uses unofficial community API wrappers and plays licensed audio outside a licensed player. That is appropriate for a learning and hackathon project, which is what this is. It is not a licensed commercial music service and is not pitched as one. The `UnifiedSong` normalisation boundary is deliberately the seam where a licensed provider would swap in without touching the UI.

## Team

| | Role |
|---|---|
| P1 | Backend & data |
| P2 | Frontend & motion |
| P3 | Infra & integration |
| P4 | QA & submission |

Planning: [`.planning/`](.planning/) · Reference: [`docs/`](docs/) · Learning log: [`.planning/LEARNING-LOG.md`](.planning/LEARNING-LOG.md)

## AI coding tools

- **Claude Code (Anthropic)**: planning, implementation help and code review across the API, the web app and the Convex/deploy setup. Every change was run through typecheck, lint and tests, and the seek behaviour was checked against the running app.
