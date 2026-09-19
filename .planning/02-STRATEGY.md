# 02 — STRATEGY

## The central bet

> **Ship a thin, reliable spine early; spend the surplus on the interface.**

Everything in the architecture below is chosen for *time-to-deployed*, not for how it would scale to a million users. Where a simpler service gets us a live URL faster, we take it, and we say so in the write-up. **Judges reward decisions you can explain, not services you name-dropped.**

## System shape

```
┌──────────────────────────────────────────────────────────────┐
│  BROWSER                                                     │
│  React 19 · Vite · Tailwind v4 · Framer Motion               │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS  (only ever talks to our API)
┌───────────────────────────▼──────────────────────────────────┐
│  AWS Amplify Hosting        — static SPA, CDN, TLS, CI/CD    │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│  AWS App Runner             — Express API (container)        │
│  ┌────────────┬──────────────┬───────────┬────────────────┐  │
│  │ /search    │ /lyrics      │ /stream   │ /me /libraries │  │
│  └─────┬──────┴──────┬───────┴─────┬─────┴────────┬───────┘  │
└────────┼─────────────┼─────────────┼──────────────┼──────────┘
         │             │             │              │
   ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼──────┐ ┌─────▼──────┐
   │ JioSaavn  │ │  LRCLIB   │ │  Saavn CDN │ │  DynamoDB  │
   │ (Gaana    │ │  (lyrics) │ │  (audio,   │ │  users     │
   │  fallback)│ │           │ │   Range)   │ │  libraries │
   │ + iTunes  │ │           │ │            │ │  + caches  │
   └───────────┘ └───────────┘ └────────────┘ └────────────┘
                                                     │
                            ┌────────────────────────┴───────┐
                            │ SSM Parameter Store (secrets)  │
                            │ CloudWatch (logs + dashboard)  │
                            │ Amazon Bedrock (AI feature) ★  │
                            └────────────────────────────────┘
```

## Why each choice

| Decision | Why | Rejected alternative |
|---|---|---|
| **Amplify Hosting** for the SPA | Connect the repo, push, get HTTPS + CDN + preview branches in ~10 min. Free tier. | S3+CloudFront — more moving parts, more time, same result for a static SPA. |
| **App Runner** for the API | Container → public HTTPS URL, no load balancer, no VPC, no TLS cert wrangling. Handles long-lived streaming responses and `Range` natively because it's a normal HTTP server. | **Lambda + API Gateway** — the audio proxy is the problem. Lambda's response limits and streaming ergonomics make byte-range audio genuinely painful. Not worth losing hours to at 2 AM. **EC2** — viable free-tier fallback (see below) but you own TLS and the process manager. |
| **DynamoDB** for data **and** cache | One service does both: user/library persistence *and*, with a **TTL attribute**, our provider cache. 25 GB always-free. No VPC. | Redis/ElastiCache — needs a VPC, which App Runner then needs a connector for. Hours of yak-shaving for a demo. |
| **SSM Parameter Store** (SecureString) | Free. Holds JWT secret + any provider token. | Secrets Manager — costs per secret, no benefit at this size. |
| **Bedrock** for the AI feature ★ | Allegra's `package.json` already ships `@google/genai` **unused**. Swapping that placeholder for Bedrock turns dead scaffolding into a real, on-AWS, judgeable feature. | Keeping a Google AI dependency in an AWS hackathon — actively works against us. |

### EC2 fallback
If App Runner costs or quota become a problem: **t3.micro (free tier 12 mo) + Caddy** for automatic TLS. Slower to set up, zero cost. Documented in `08-AWS-DEPLOYMENT.md` §Fallback. Decide by **T+8** — not later.

## The four hard technical problems

Ranked by how likely they are to eat the hackathon. P1 and P3 must know these cold.

**1. CORS.** The providers are called directly from the phone in our reference implementation. A browser can't do that — the Saavn CDN and Genius send no permissive `Access-Control-Allow-Origin`. **Every provider call moves server-side.** The browser talks only to our API. This is the entire reason the backend exists.

**2. `Range` requests.** Seeking an `<audio>` element issues `Range: bytes=N-`. A naive proxy that pipes `fetch(url).body` back returns `200 OK` with the whole file and **seeking silently does nothing** — playback looks fine, the scrubber is dead. Forward `Range`, preserve `206`, pass through `Content-Range` / `Accept-Ranges`. **This is the single most likely way to lose the demo.** It is Phase 2's acceptance test for exactly that reason.

**3. Stream URLs expire.** The CDN URL is a short-lived handle, not an identity. **Store the song `id`; re-resolve on 403/404.** A library full of dead URLs an hour into judging is a bad look.

**4. One server IP.** On mobile, N users = N IPs. Behind our API, the whole user base is one IP against a rate-limited community provider. **Caching is a correctness requirement, not an optimisation.** Including *negative* caching — lyric misses get re-queried hardest.

## Ruthless scope

### Must ship (the spine)
1. Search → real results
2. Click → audio plays **and seeks**
3. 1000×1000 artwork
4. Time-synced lyrics
5. Deployed, live, public AWS URL
6. **The cinematic interface** ← the differentiator

### Stretch (only if the spine is green)
- ★ Bedrock feature: *"Set the mood"* — natural-language → a generated queue, or a one-paragraph context card for the playing track
- Library persistence beyond guest
- Web Audio visualizer driven by real frequency data

### Cut now, deliberately
| Cut | Why |
|---|---|
| **Genius scraping** | Flakiest tier, breaks on any redesign, ToS-grey, and LRCLIB already covers us. |
| **Email/password auth** | A time sink with near-zero judging value. **Anonymous JWT from first load**, libraries persist against that id. Demonstrates real persistence with no login screen to build, style or debug. |
| **Real stem separation (karaoke)** | Needs Demucs/Spleeter on a GPU, 10–60 s per track. Impossible here. The sliders stay as a *visual* mode, honestly labelled. Do not ship a control that does nothing and call it a feature. |
| **Payments** | Premium page stays a UI demo, labelled as one. |
| **Offline / PWA / downloads** | Out of scope. |

## Legal footing — state it once, in the README

The JioSaavn and Gaana APIs are unofficial community wrappers, and the audio is licensed content played outside a licensed player. That is fine for a **learning/hackathon/portfolio** project, which is what this is. It is not a licensed commercial service and must not be pitched as one — the Premium page is explicitly a UI demo. Say this plainly in the README. **Judges respect a team that understands the boundaries of its own project**; pretending the issue doesn't exist reads worse than naming it.

The `UnifiedSong` normalisation boundary is deliberately the seam where a licensed provider would swap in. That's a real architectural answer to an obvious judging question — make sure whoever presents can give it.
