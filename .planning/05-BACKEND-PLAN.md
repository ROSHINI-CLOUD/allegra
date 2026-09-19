# 05 — BACKEND IMPLEMENTATION PLAN (P1)

> Full provider reference — exact endpoints, headers, response shapes, gotchas — is in `docs/provider-integration.md`. That document is extracted from a working production implementation. **Follow it literally; it is not generic advice.**

## Stack
Node 20 · Express · TypeScript (strict) · AWS SDK v3 (DynamoDB) · `zod` for request validation · Docker → App Runner.

## Implementation status

The core backend implementation is now present locally through B11: provider adapters, normalization, catalog/search, stream proxy, cache/Dynamo seam, artwork, lyrics, home/suggestions, anonymous JWT, and library persistence. Local typecheck, lint, 12 tests, production build, and built-server health smoke test pass.

Remaining release work is environment-specific: configure real SSM/Dynamo/App Runner resources, run Docker/CI/deployed smoke tests, and optionally implement B12 Bedrock. B12 remains stretch-only and is not required for the search → play → seek spine.

## Layout
```
apps/api/src/
├── index.ts                 # express, cors, helmet, rate-limit, /api/health
├── routes/
│   ├── search.ts  songs.ts  artwork.ts  lyrics.ts
│   ├── stream.ts            # ⭐ the audio proxy
│   ├── me.ts                # anon identity, libraries, liked, recent
│   └── ai.ts                # ★ Bedrock (stretch)
├── providers/
│   ├── saavn.ts  gaana.ts  itunes.ts  lrclib.ts
├── catalog/
│   └── catalog.ts             # search cascade, normalization, ranking, cache policy
├── lib/
│   ├── normalize.ts  lrc.ts  matcher.ts  decodeHtml.ts
│   ├── streamResolver.ts     # URL refresh, Range forwarding, 206 preservation
│   ├── lyricsPipeline.ts     # LRCLIB ladder → parsed LyricLine[]
│   ├── cache.ts              # CacheStore seam, TTL and negative-cache policy
│   ├── fetchWithTimeout.ts  circuitBreaker.ts  errors.ts
└── db/
    └── dynamo.ts
```

## Architecture after review

The detailed architecture plan is in `.planning/12-BACKEND-ARCHITECTURE-PLAN.md`. The implementation follows a deep-module approach: routes are thin HTTP adapters, providers are external adapters, and application policy lives in modules with narrow interfaces.

- `catalog/catalog.ts` is the first strong seam. It owns Saavn → normalization → zero-result-only Gaana fallback → ranking → cache coordination. Provider response shapes never reach routes.
- `lib/streamResolver.ts` owns stream URL resolution, forced refresh on `403`/`404`, `Range` forwarding, `206` preservation, response headers, and streaming without buffering.
- `lib/cache.ts` defines the real `CacheStore` seam. An in-memory adapter supports local tests; `db/dynamo.ts` supplies production persistence. Positive, negative, and per-type TTL policy stays inside the cache module.
- `lib/lyricsPipeline.ts` owns the LRCLIB ladder, HTML rejection, dirty-LRC parsing, matching, scoring, interpolation, and pre-parsed output. The browser never parses LRC.
- Provider adapters should expose a non-throwing result that preserves `ok` versus `error` while returning an empty `songs` array on failure. The catalog may invoke Gaana only for `ok` + zero Saavn songs; a timeout or provider error must not look like a valid zero-result search.

Use the deletion test for new abstractions. A seam is justified by two real implementations or by protecting the application from a volatile external contract; do not add speculative interfaces.

### Revised execution order

`B1 → B2 → B3 → B4/B5 → B6 → B9 → B7 → B8 → B10 → B11 → B12 (optional)`

The cache ticket intentionally moves before artwork and lyrics so those modules share a tested cache policy and stream URL refresh can be verified before depth work. Ticket IDs and their definitions below remain unchanged.

## Ticket list, in build order

### B1 · Skeleton — 30 min
Express + TS strict + `/api/health` returning `{ok:true, version}`. Dockerfile. **`/api/health` must exist before P3 can wire App Runner** — do it first.
**DoD:** `docker build && docker run` → `curl localhost:8080/api/health` → 200.

### B2 · Saavn provider — 1 h
`search(query, limit, page)`, `getSong(id)`, `getSuggestions(id, limit)`.
- `BROWSER_HEADERS` on every call (Cloudflare bot protection — without them, intermittent 403s)
- 25 s timeout via `AbortController`
- Any failure returns `[]` from its own try/catch — **never throws**, so the cascade keeps working

**DoD:** unit test hits the live API, gets ≥1 result with a non-empty `downloadUrl`.

### B3 · Normalisation — 1 h ⚠️ detail-heavy
→ `UnifiedSong`. Four things people get wrong:
- **Decode HTML entities** in title/artist: named, decimal (`&#39;`) **and** hex (`&#x27;`). Saavn really does return these.
- Artist is `primaryArtists` (string) **or** `artists.primary[]` (array). Handle both → `"Unknown Artist"`.
- `playCount` may be a formatted string → strip non-digits. **Force 0 for Gaana** (incomparable scales, and we sort on it).
- Audio: prefer `320kbps`, else **last** array element. Image: prefer `500x500`, else last. Drop anything with no URL.

**DoD:** a fixture with `&quot;`, the array artist shape and `"1,234,567"` normalises correctly. **P4 writes this test.**

### B4 · Gaana fallback — 30 min
Same shape, same mapper, `source: 'Gaana'`.
**Fires only when Saavn returns exactly zero results** — not on error, not on timeout. (A Saavn failure already returns `[]`, so it cascades naturally.)

### B5 · `GET /api/search` — 30 min
Cascade → normalise → filter no-URL → sort (authentic first, then playCount desc) → cache 1 h.
**DoD:** `?q=<track>` returns ≥5 playable results, <800 ms cold, <200 ms cached.

### B6 · `GET /api/stream/:songId` — 2 h ⭐⭐ THE CRITICAL ONE
```ts
router.get('/stream/:songId', async (req, res) => {
  let url = await resolveStreamUrl(req.params.songId);      // cache → saavn
  const range = req.headers.range;

  let upstream = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...(range ? { Range: range } : {}) }
  });

  // URL expired — re-resolve ONCE and retry
  if (upstream.status === 403 || upstream.status === 404) {
    url = await resolveStreamUrl(req.params.songId, { force: true });
    upstream = await fetch(url, {
      headers: { ...BROWSER_HEADERS, ...(range ? { Range: range } : {}) }
    });
  }

  res.status(upstream.status);                    // 206 MUST stay 206
  for (const h of ['content-type','content-length','content-range','accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  Readable.fromWeb(upstream.body).pipe(res);      // STREAM — never buffer
});
```
**Four ways this goes wrong:** collapsing `206`→`200` (seek dies silently); dropping `Content-Range`; buffering the whole file (100 listeners × 12 MB = dead container); not re-resolving on 403.
**DoD:** `curl -H "Range: bytes=1000-2000"` → **`206`** + `Content-Range`. P4's automated test asserts exactly this.

### B7 · `GET /api/artwork` — 45 min
iTunes, no key. Two-pass: raw query → cleaned query (strip parens, brackets, `ft|feat|official|video|audio|lyrics`) → Saavn's 500×500 as last resort. Upgrade via `.replace('100x100bb','1000x1000bb')`. Cache **30 days**.
**DoD:** returns a 1000×1000 URL that actually loads.

### B8 · `GET /api/lyrics` — 2 h ⭐
Ladder: **LRCLIB `/get`** (precise, pass `duration`) → **LRCLIB `/search`** (fuzzy) → **interpolated-plain**.
- Clean the query first (strip `(Lyrics)`, `(Official …)`, `(Audio)`; split `"Artist - Title"` when artist unknown)
- **Reject any body containing `<div` / `<html` / `<!DOCTYPE`** — that's an error page. Fall through.
- 404 → `null`, continue the ladder. Other non-2xx → throw.
- Permissive LRC regex: `\d{1,2}` for **both** minutes and seconds, optional brackets/ms. Real files are dirty.
- Empty stamped line → `[INSTRUMENTAL]`
- **No timestamps → interpolate evenly across duration.** One rendering path for both cases; the UI still auto-scrolls.
- Score candidates 0–100: title 30/15 · synced 20 · duration ±2 s → 10, ±10 s → 5
- **Return pre-parsed `LyricLine[]`.** The browser never parses LRC.
- Cache **30 d** on hit, **24 h on miss** (negative cache — misses get re-queried hardest).

**DoD:** a popular track returns `type:'synced'` with ≥10 lines and ascending timestamps.

### B9 · DynamoDB + cache — 1 h
Single-table-ish, TTL on cache rows:

| Table | PK | SK | TTL |
|---|---|---|---|
| `allegra-cache` | `type#key` | — | ✅ per-type |
| `allegra-users` | `userId` | — | — |
| `allegra-libraries` | `userId` | `libraryId` | — |

In-process LRU in front of Dynamo (App Runner instances are warm; saves a round-trip).
**Circuit breaker:** N consecutive failures → skip that provider for M minutes. Without it, one dead provider adds its full timeout to *every* request.

### B10 · `GET /api/home` — 30 min
Three rows from curated Saavn playlist IDs. Cache 1 h. **Do not over-build** — hardcoded IDs are the fallback and they're fine.

### B11 · `/api/me/*` — 1 h
**Anonymous JWT issued on first load.** No login screen. Libraries, liked, recently-played keyed to that id in DynamoDB.
**DoD:** create a library, hard-refresh, it's still there.

### B12 ★ · Bedrock — 1 h, stretch only
`POST /api/ai/mood` → `{ prompt: "late night drive" }` → 3–5 search terms → hydrate via Saavn → a queue.
Use the AWS SDK Bedrock Runtime client with a small, fast model; constrain the output to JSON and validate with `zod` before trusting it. Wrap in try/catch and **degrade to a plain search** on any failure — a stretch feature must never break the spine.

## Rules
- Uniform envelope: `{ success, data, error? }`. **Never leak provider errors** — map network/timeout/404/429/5xx to friendly copy.
- Every outbound call: explicit `AbortController` timeout + own try/catch returning empty.
- TS strict. Provider responses typed as narrow interfaces covering **only** consumed fields.
- No secrets in code. SSM Parameter Store → env at boot.
