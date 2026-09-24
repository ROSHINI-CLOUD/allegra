# Architecture — how Allegra actually works

One deployment, three owners of state. Read this before changing anything structural.

```
                    ┌─────────────────────────────────────────────┐
  Browser           │  Vercel deployment                          │
  ───────           │                                             │
  Next.js shell ────┼──► apps/web  (Next.js App Router, static)   │
   • one <audio>    │                                             │
   • Web Audio mix  │    /api/*  ──► api/index.ts                 │
   • routes         │                └─ apps/api (Express)        │
                    └──────────┬──────────────────┬───────────────┘
                               │                  │
        ┌──────────────────────┘                  └──────────────┐
        ▼                                                        ▼
  Music providers                                         ┌─────────────┐
  (Saavn, Gaana, LRCLIB, …)                               │   Convex    │
  server-side only, never                                 │             │
  reachable from the browser                              │ • Google    │
                                                          │   sign-in   │
  Browser worker                                          │ • profiles  │
  • on-device Karaoke                                     │ • shares    │
  • optional local model cache                            └─────────────┘
```

## The three owners of state

| State | Owner | Why there |
|---|---|---|
| Identity (who you are) | **Convex Auth** | It holds the Google secret and signs session tokens. Our API never touches a credential. |
| Listener data (likes, playlists, recents, taste, play tally, shares) | **Convex** | Durable, and the API reaches it through one `UserStore` seam. |
| Song relations (which songs go with which, shared by everyone) | **Convex** `songRelations` | Derived, so allowed to be lost, but kept durable because each one costs several provider calls to work out and every listener reuses it. Reached through `RelationStore`. |
| Karaoke output | **Browser memory / device storage** | The worker separates audio locally. A model may be cached locally; no stems or track audio are persisted by the API. |

Everything else — search results, lyrics, artwork, recommendations — is cache, and is allowed to be lost.

## Why the API and the web app ship together

`apps/web` is a Next.js app; `api/index.ts` is an Express app running as a Vercel Function. One
`vercel.json` builds both. The rewrite `/api/(.*) → /api` is ordered **before** Next's optional
catch-all route, which is the only reason Express still receives API requests at all.

That ordering is load-bearing and invisible when wrong: the site renders perfectly while every API
call 404s, so it reads as a frontend bug. `tests/infra/infra-files.test.mjs` asserts the rewrite
exists, and `vercel build` can be run locally to inspect the generated route table.

Express was kept rather than ported to route handlers because `GET /api/stream/:songId` forwards the
client's `Range` header and preserves the upstream status. A `206` must stay a `206`. Rewriting that
path would risk the highest-consequence, least-visible bug in the product (see below).

## Playback

One `<audio>` element lives in the App Router layout, so it survives every route change. Verified:
navigating `/discover → /library` keeps the *same* DOM node and playback continues uninterrupted.

Three invariants, each of which was a real bug:

1. **One funnel.** All play/pause goes through `requestPlayback(playing)`. Never `setIsPlaying(...)`
   *and* `audio.play()` from a component. The raw setter only syncs **from** the element's events.
2. **Load effects must not depend on `isPlaying`.** An effect listing it in deps that calls `.play()`
   re-fires on the user's own pause and instantly resumes — pause appears to do nothing.
3. **Seek pauses. Always resume.** Capture `wasPlaying`, set `currentTime`, resume if it was playing.

### Karaoke

Normal playback uses the original master. Karaoke keeps that element as the transport clock while a
browser worker produces an instrumental stream near the playhead. Seeking and synced lyrics stay on
the same clock. The worker returns both stems (instrumental, and vocals = mix − instrumental), so the
listener's Vocals / Bass & instruments faders mix two sample-aligned buffers; both at 100% is the
original. The mid-side fallback has no stems, so the faders are shown locked with a reason.
Listener preferences (theme, lyrics, karaoke mode and mix, analytics opt-out) live in
`localStorage['allegra-settings-v1']` on the device, never on the server. When the Mel-Band RoFormer model cannot load, cannot keep up, or the song exceeds
the device limit, the client falls back to local mid-side reduction or shows a capability message.

No API route starts a separation job, no track audio is uploaded, and no cloud GPU or per-song state
exists. The model may be cached in browser storage, but the derived audio remains local to the
listener's session.

## Authentication

```
Browser ──► Convex Auth ──► Google ──► session JWT (RS256)
   │
   └──► Express API:  Authorization: Bearer <token>
                        ├─ guest token?   verify with JWT_SECRET (local, free)
                        └─ Convex token?  verify against Convex's published JWKS
```

Both kinds sit behind one `TokenVerifier` port, so routes never branch on which kind of caller they
have. Guest listening works with no Convex deployment at all.

Signing in calls `POST /api/auth/link` once, handing over the old guest token so likes and playlists
made before signing in follow the listener into their account. Merging is a union, so it is safe to
repeat.

## Seams worth knowing

| Port | Implementations |
|---|---|
| `UserStore` | `ConvexUserStore`, `MemoryUserStore` (tests, and local dev without Convex) |
| `TokenVerifier` | `GuestTokenVerifier`, `ConvexTokenVerifier`, `FirstMatchVerifier` |
| `CacheStore` | `MemoryCacheStore` |
| `RelationStore` | `ConvexRelationStore`, `MemoryRelationStore` (tests, and local dev without Convex) |

## Recommendations (Quick Picks)

Modelled on Echo's Quick Picks. Every play grows a per-listener **play tally** (`profile.playStats`,
capped at 200 songs: plays, seconds ever, and seconds halving weekly). A shelf takes up to twenty
seeds — now playing, the last five plays, this week's top five, the all-time top ten, the latest
likes — and reads each seed's **song relation**: YouTube Music's song radio and the catalog's
suggestions, merged and matched to catalog rows (`services/songRelations.ts`). Every seed votes for
its neighbours, so a song many of your plays point to ranks first. Missing relations are worked out a
few per shelf (no background jobs), so the map grows as people listen; each is refreshed after 30
days. Audio never comes from YouTube — see `docs/provider-integration.md` rule 14.

Each has a fake used by tests, which is why the suite runs with no network and no cloud account.

## Rules that are not negotiable

1. **`docs/api-contract.md` is the contract.** Propose → update the doc → announce → adapt both sides.
2. **No provider URLs, tokens or secrets in the frontend.** `NEXT_PUBLIC_*` is inlined into public
   JavaScript. Everything provider-side is server-side.
3. **Duration is always seconds.**
4. **`{ success, data, error? }` on every API response.** `error` is user-facing copy, never a raw
   provider error.
5. **Animate `transform` and `opacity` only**, from a token in `src/motion/index.ts`.
6. **`prefers-reduced-motion` collapses to opacity.** It never disables a feature.
7. **TypeScript strict, no `any`.** Provider responses get narrow interfaces covering consumed fields.
8. **Every outbound call** gets an `AbortController` timeout and its own try/catch returning empty —
   that is what keeps the provider cascade alive.
9. **The byte-range rule.** `GET /api/stream/:songId` preserves the upstream status and passes through
   `Content-Range` and `Accept-Ranges`. Collapse a `206` to `200` and audio plays perfectly while
   seeking silently does nothing — the highest-risk failure in the product, because it looks fine.
