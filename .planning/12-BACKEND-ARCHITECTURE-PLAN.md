# 12 — BACKEND ARCHITECTURE PLAN (P1)

> This plan records the architecture review of the B1 skeleton and turns the review into an ordered implementation plan. It does not replace the ticket plan in `05-BACKEND-PLAN.md` or the frozen seam in `docs/api-contract.md`.

## Current status

- B1 skeleton is implemented and locally verified on branch `be/b1-skeleton`.
- The full backend is **not** complete. B2 is the next implementation ticket.
- The architecture review report is `/private/tmp/architecture-review-20260919-112740.html`.
- No API contract changes are proposed by this plan.

## Architectural direction

The backend should be built as a small set of deep modules rather than a collection of provider-shaped routes. Each module should hide difficult decisions behind a narrow interface and keep provider quirks local.

The design vocabulary for this work is:

- **Module:** a unit that owns a coherent policy, such as catalog search or stream resolution.
- **Interface:** the narrow input/output boundary used by routes and neighboring modules.
- **Seam:** a boundary where an implementation can change without changing its callers.
- **Adapter:** provider-specific code translating an external API into an internal interface.
- **Leverage:** the amount of behavior one well-tested module provides to the rest of the application.
- **Locality:** keeping a rule next to the data and decision it governs.
- **Deletion test:** if removing a proposed abstraction does not make a real change harder, it is probably unnecessary.

Do not abstract for hypothetical providers. One adapter can remain a direct implementation. A seam becomes justified when there are two implementations (for example, an in-memory cache and DynamoDB) or when a boundary protects the application from a volatile external contract (for example, Saavn and Gaana).

## Target module map

```text
apps/api/src/
├── index.ts                         # process startup and environment validation
├── app.ts                           # HTTP composition, middleware, route mounting
├── routes/                          # thin HTTP adapters; contract in, module call, envelope out
│   ├── search.ts
│   ├── songs.ts
│   ├── artwork.ts
│   ├── lyrics.ts
│   ├── stream.ts
│   ├── me.ts
│   └── ai.ts                        # optional B12 only
├── catalog/
│   └── catalog.ts                   # search policy, cascade, ranking, cache coordination
├── providers/                       # external adapters; no route imports provider shapes
│   ├── saavn.ts
│   ├── gaana.ts
│   ├── itunes.ts
│   └── lrclib.ts
├── lib/
│   ├── normalize.ts                 # provider response → UnifiedSong
│   ├── decodeHtml.ts                # named, decimal, and hexadecimal entities
│   ├── streamResolver.ts            # URL lookup, refresh, Range and upstream response policy
│   ├── lyricsPipeline.ts             # lookup ladder, rejection, scoring, parsed output
│   ├── lrc.ts                       # permissive LRC parsing
│   ├── matcher.ts                   # title/artist/duration matching
│   ├── cache.ts                     # CacheStore interface and cache policy
│   ├── fetchWithTimeout.ts
│   ├── circuitBreaker.ts
│   └── errors.ts
└── db/
    └── dynamo.ts                    # DynamoDB CacheStore/library implementation
```

### Deep modules and boundaries

#### Catalog cascade — first strong seam

`catalog/catalog.ts` owns the search behavior that otherwise leaks across routes and providers:

- call Saavn with the required browser headers and timeout;
- normalize and discard unplayable records;
- call Gaana only when Saavn returns exactly zero results;
- rank authentic results before `playCount` descending;
- coordinate the search cache;
- return the internal `UnifiedSong[]` shape or a friendly application error.

The route should only validate `q`, `limit`, and `page`, call the catalog module, and serialize the frozen API envelope. Provider response shapes must not cross this boundary.

The provider boundary must preserve the difference between a successful empty result and a failed request. A non-throwing adapter may return an empty `songs` array on failure, but it must also carry an `ok`/`error` status so the catalog invokes Gaana only for a successful zero-result Saavn search.

#### Stream resolver — critical seam

`lib/streamResolver.ts` owns the failure-prone stream policy:

- resolve and cache the playable URL;
- forward `Range` and `BROWSER_HEADERS` upstream;
- preserve the upstream status, especially `206`;
- forward `Content-Range`, `Content-Length`, `Content-Type`, and `Accept-Ranges`;
- re-resolve once on `403` or `404`;
- stream the body without buffering it.

The stream route remains responsible for HTTP request/response plumbing only. This keeps the seek invariants testable without starting Express.

#### Cache store — real implementation seam

`lib/cache.ts` defines the narrow cache operations and owns key/TTL policy. The local implementation is an in-memory store for tests and development. `db/dynamo.ts` supplies the production implementation. This is a justified seam because there are two real implementations with different operational concerns.

The cache module must support positive and negative entries, per-type TTLs, and forced invalidation for expired stream URLs. DynamoDB details must not leak into catalog, stream, artwork, or lyrics modules.

#### Lyrics pipeline — deep policy module

`lib/lyricsPipeline.ts` owns the LRCLIB ladder and returns pre-parsed `LyricLine[]`:

- clean title/artist inputs;
- try precise `/get`, then fuzzy `/search`, then interpolated plain lyrics;
- reject HTML error pages and continue the ladder;
- parse dirty LRC with a permissive matcher;
- score candidates and choose the best match;
- negative-cache misses for 24 hours and hits for 30 days.

`lrc.ts`, `matcher.ts`, and the LRCLIB provider are implementation details behind this module. The browser never parses LRC.

## Ordered implementation plan

The ticket IDs remain stable; only the architecture-aware sequencing is clarified.

| Order | Ticket | Architectural outcome | Gate |
|---:|---|---|---|
| 1 | B1 | HTTP composition, health, security middleware | Local typecheck, lint, tests, build, health smoke test |
| 2 | B2 | Saavn adapter with timeout, headers, and failure isolation | Provider fixture/live verification |
| 3 | B3 | Normalization boundary and `UnifiedSong` invariants | Entity, artist-shape, quality, and missing-URL fixtures |
| 4 | B4–B5 | Catalog module, Gaana fallback, ranking, and search route | Zero-result-only fallback and search contract tests |
| 5 | B6 | Stream resolver and range-preserving stream route | Automated `206`/`Content-Range`, refresh, and streaming tests |
| 6 | B9 | CacheStore seam, memory adapter, DynamoDB adapter, TTL policy | Cache unit tests; Dynamo integration when credentials are available |
| 7 | B7 | Artwork policy using provider adapters and cache | Two-pass query and URL-upgrade tests |
| 8 | B8 | Lyrics pipeline, parser, matcher, and negative cache | Synced, plain, HTML rejection, dirty-LRC, and miss tests |
| 9 | B10 | Home/suggestions modules using existing provider seams | Contract and cache tests; no over-built CMS |
| 10 | B11 | Anonymous identity, JWT, and library persistence | Create/refresh/read integration test |
| 11 | B12 | Bedrock adapter and validated fallback, only if core gates pass | Optional stretch; never blocks search/play/seek |

The cache ticket moves ahead of artwork and lyrics because those features depend on the same explicit store policy. It also makes the stream URL refresh path testable before the backend grows more provider behavior.

## Verification contract per seam

- **Providers:** narrow response types; every outbound call has an explicit timeout, required headers, and an isolated failure path.
- **Catalog:** Gaana runs only for zero Saavn results, never merely because Saavn errored; no provider objects escape.
- **Normalization:** named, decimal, and hex HTML entities; string or array artists; quality fallback; play-count rules; no playable URL means no result.
- **Stream:** request `Range` is forwarded; upstream `206` and `Content-Range` are preserved; one forced refresh on `403`/`404`; body is streamed.
- **Cache:** positive and negative TTLs, stable keys, forced refresh, and no AWS dependency in local tests.
- **Lyrics:** HTML-body rejection, permissive LRC, interpolation, candidate scoring, and pre-parsed lines.
- **HTTP:** route tests assert the frozen response envelope and friendly errors without leaking provider details.
- **Release:** each ticket passes typecheck, lint, and tests; the deployed health/search/play/seek path is verified before depth work.

## Constraints and non-goals

- `docs/api-contract.md` remains frozen unless the team explicitly approves a contract change first.
- No provider URL, token, or secret enters `apps/web`.
- No new endpoint is added outside B1–B12.
- B12 is optional and must not delay Gate 1 or Gate 2.
- Do not perform a broad refactor before a failing test or concrete provider boundary justifies it.
- Keep routes thin and keep provider quirks local; apply the deletion test to every new abstraction.
