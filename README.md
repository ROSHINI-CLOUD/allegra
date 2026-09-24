# Allegra

> A music-streaming web app with a real catalog, real audio, time-synced lyrics, and an interface built to feel like an instrument rather than a list.

**Live:** [allegravibe.vercel.app](https://allegravibe.vercel.app)

## What this is

Allegra began as a fully mocked front-end: hardcoded songs, playback faked with a timer, accounts faked in `localStorage`. It is now a working product: live catalog, streaming audio with working seek, artwork, time-synced lyrics with graceful degradation, guest sessions, likes, recently played and playlists that persist.

## Architecture

```
Browser  (Next.js App Router · React 19 · Motion)
   |
   `-- Vercel                    one deployment
         |-- apps/web            the app shell: one <audio>, player, routes
         `-- /api -> Express     apps/api, as a Vercel Function
               |-- JioSaavn -> Gaana   catalog + audio (server-side, because of CORS)
               |-- iTunes Search       artwork
               |-- LRCLIB (+ Lyrica)   time-synced lyrics
               |-- Convex              Google sign-in, likes, recents, playlists
               `-- Browser worker      on-device karaoke separation
```

**Why the API is still Express and not route handlers:** `GET /api/stream/:id` proxies audio and must
forward `Range` and preserve `206 Partial Content`. That path works; rewriting it would risk the
least-visible bug in the product for no gain. Vercel builds both halves from one `vercel.json`.

**Why the browser never talks to a provider:** these providers' reference client is a mobile app,
which has no origin and no preflight. A browser has both. Every provider call is server-side — that
is why the backend exists.

**Why sign-in lives in Convex:** Convex Auth holds the Google secret and signs the session token; the
API only verifies it against Convex's published keys. No credential ever reaches this repo or the
browser.

Details: [`docs/architecture.md`](docs/architecture.md) · Deploy and verify: [`docs/workflows.md`](docs/workflows.md)

## Run it

```bash
git clone <repo> && cd allegra
npm install                                  # workspaces: one install covers everything

cp apps/api/.env.example apps/api/.env      # works as-is; no keys needed
npm run dev                                  # web :5173 · api :8080
```

Open http://localhost:5173. No keys are needed to search, play, translate lyrics, get
recommendations, or use Karaoke. Guest data stays in memory until you set up Convex; Karaoke runs
on the listener's device — see [`docs/workflows.md`](docs/workflows.md).

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
| **Google sign-in** | **Real when Convex Auth is configured** — guest data merges into the account on first sign-in. Guest-only otherwise. Setup: [`docs/auth-convex-google.md`](docs/auth-convex-google.md) |
| **Karaoke** | **On-device** — a browser worker uses Mel-Band RoFormer when supported and falls back to mid-side vocal reduction. No track audio, model request, or cloud GPU is sent through the API. |
| Premium page | **UI demo only** — no payments |
| AI "set the mood" | **Not built.** The mood pills run a plain search |

## A note on the providers

Allegra uses unofficial community API wrappers and plays licensed audio outside a licensed player.
That is appropriate for a personal learning project, which is what this is. It is not a licensed
commercial music service and is not pitched as one. The `UnifiedSong` normalisation boundary is deliberately the seam where a licensed provider would swap in without touching the UI.

## Where things live

[`docs/`](docs/) — architecture, the API contract, setup guides ·
[`.planning/`](.planning/) — the PRD and roadmap ·
[`.planning/LEARNING-LOG.md`](.planning/LEARNING-LOG.md) — things that bit us

## AI coding tools

- **Claude Code (Anthropic)**: planning, implementation and review across the API, the web app, the
  Convex setup and the on-device karaoke pipeline. Every change was run through typecheck, lint and tests,
  and behaviour that is visible in a browser was checked in a browser.
