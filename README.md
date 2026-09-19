# Allegra

> A music-streaming web app with a real catalog, real audio, time-synced lyrics, and an interface built to feel like an instrument rather than a list.

**🔴 Live:** `<url>` · **First Commit** (Bharat Builds Tour · WeMakeDevs × AWS) · 17–20 Sept 2026

![hero transition](docs/assets/hero.gif)

## What this is

Allegra began as a fully mocked front-end — 30 hardcoded songs, playback faked with a timer, accounts faked in `localStorage`. This hackathon made it real: a live catalog, streaming audio with working seek, artwork at 1000×1000, time-synced lyrics with graceful degradation, and persistence — all deployed on AWS.

## Architecture

```
Browser (React 19 · Vite · Tailwind · Framer Motion)
   │
   ├─→ AWS Amplify Hosting        static SPA, CDN, TLS
   │
   └─→ AWS App Runner             Express API
         ├─→ JioSaavn → Gaana     catalog + audio (server-side; CORS)
         ├─→ iTunes Search        1000×1000 artwork
         ├─→ LRCLIB               time-synced lyrics
         ├─→ DynamoDB             data + TTL cache
         └─→ SSM · CloudWatch · Bedrock
```

**Why App Runner and not Lambda:** our audio proxy streams HTTP byte-range responses. That's what a normal long-lived HTTP server does well, and what Lambda makes awkward. Full reasoning in `docs/aws-services-reference.md`.

## Run it

```bash
git clone <repo> && cd allegra
npm install

cp apps/api/.env.example apps/api/.env      # sensible defaults; no keys required
npm run dev                                  # web :5173 · api :8080
```

Everything the app needs works without an API key. Open http://localhost:5173.

```bash
npm run typecheck && npm run lint && npm test
```

## The interesting problems

**Seeking silently did nothing.** Our proxy was collapsing the upstream `206 Partial Content` into a `200` with the whole body, so the browser had no byte-range to seek within. Audio played perfectly, which is exactly what made it hard to find. Fixed by forwarding the `Range` header and preserving the upstream status and `Content-Range`.

**Lyrics that don't exist.** Rather than showing nothing when a track has no synced lyrics, we interpolate plain text evenly across the duration. The UI still scrolls, and both cases share one render path.

**CORS.** The reference implementation for these providers is a mobile app, which has no origin and no preflight. A browser has both, and the audio CDN sends no permissive `Access-Control-Allow-Origin`. Every provider call moves server-side — that's the whole reason the backend exists.

## What's real, what's demo

| | |
|---|---|
| Catalog, audio, seek, artwork, lyrics, persistence | **Real** |
| Karaoke sliders | **Visual mode.** Real stem separation needs GPU processing — out of scope, and we'd rather say so than ship a control that does nothing |
| Premium page | **UI demo.** No payments. |

## A note on the providers

Allegra uses unofficial community API wrappers, and plays licensed audio outside a licensed player. That's appropriate for a learning and hackathon project, which is what this is — it is not a licensed commercial music service and isn't pitched as one. The `UnifiedSong` normalisation boundary is deliberately the seam where a licensed provider would swap in without touching the UI.

## Team

| | Role |
|---|---|
| P1 | Backend & data |
| P2 | Frontend & motion |
| P3 | Infra & integration |
| P4 | QA & submission |

Planning: [`.planning/`](.planning/) · Reference: [`docs/`](docs/) · Learning log: [`.planning/LEARNING-LOG.md`](.planning/LEARNING-LOG.md)

## AI coding tools

<!-- REQUIRED by the hackathon rules. Be specific and honest. -->
- `<tool>` — `<what it did>`

We reviewed, ran and own every line committed.
