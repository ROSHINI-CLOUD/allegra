# Allegra optimization plan

Architecture vocabulary from **codebase-design**: deepen modules (small interface, hide complexity), place seams where two adapters already exist, prefer locality over scattered fixes.

Scope for this pass: **architecture depth + AWS burn + general efficiency**. Do not change frozen `docs/api-contract.md` response shapes.

## AWS touchpoints (current)

| Resource | Role | Cost risk |
|---|---|---|
| App Runner (`infra/aws/app-runner.yaml`) | API host, 1 vCPU / 2 GB, health every 10s | Idle over-provision + health chatter |
| DynamoDB cache/users/libraries | Layered cache + user data, PITR on | Cache table PITR is pure waste |
| Bedrock (SigV4, no SDK) | AI cascade when `AI_PRIMARY=bedrock` | **Highest burn**: recommendations uncached |
| S3 + CloudFront | Playlist cover uploads | Low volume if uploads gated |
| Amplify | Web hosting | Mostly fixed / traffic-tied |
| Budget alert $10 | Guardrail in `core.yaml` | Keep |

Convex stays out of AWS bill; still protect it by not spamming user endpoints.

## Waste findings (ranked)

1. **HIGH — RecommendationService has no cache** (`services/recommendations.ts`). Every `/api/ai/recommendations` hit invokes Bedrock/Gemini + up to 5 catalog searches. Frontend refetches on **every** `currentSong.id` change (`App.tsx`).
2. **HIGH — Frontend taste effect too hot**. Deps include `audio.currentSong?.id`, so skip track ⇒ new AI call even when likes/recents unchanged.
3. **MED — App Runner oversized** for hackathon traffic: 1 vCPU / 2 GB; health Interval 10s.
4. **MED — DynamoDB PITR on cache table**. Point-in-time recovery on ephemeral TTL cache burns money for no recovery value.
5. **MED — AiClient cascade can stack 25s timeouts** when a primary provider hangs before falling through.
6. **LOW — Translation cache key ignores lyric body** (title/artist/length only). Wrong reuse rare; content hash would deepen correctness.
7. **LOW — God surface `App.tsx`**. Queue/AI/lyrics effects live in one shallow shell; later deepen into hooks (not this pass unless free).

## Deepening opportunities

### 1. `RecommendationService` (do now) — **Depth ↑, AWS burn ↓**

- **Interface** (unchanged to callers): `recommend(context, excludeIds, excludeSongs?, limit?) → RecommendationResult | null`
- **Behind the seam**: cache key from taste fingerprint; hit/miss/negative TTL; catalog fan-out unchanged
- **Adapters**: existing `CacheStore` (memory in tests, layered Dynamo in prod) — real second adapter already exists
- **Leverage**: one place stops Bedrock + search storms for all routes/clients

### 2. Frontend AI picks effect (do now)

- Stabilize deps on a **taste fingerprint** (liked + recent ids + top artists), not every now-playing id
- Keep AbortController; optional soft refresh when song changes only if cache miss on server

### 3. App Runner + Dynamo guardrails (do now)

- Right-size instance; lengthen health interval
- Disable PITR on **cache** table only (keep on users/libraries)

### 4. AiClient soft circuit (next session if needed)

- Skip a provider for N minutes after consecutive timeouts
- Only if logs show cascade timeouts; avoid speculative seam

## Non-goals

- Replacing Convex with Dynamo/Cognito
- Adding AWS SDK
- Changing API contract shapes
- Drag-to-reorder queue / new product features
- Buying Savings Plans (wrong stage)

## This-session implementation order

1. Cache + negative cache inside `RecommendationService`; wire `CacheStore` from `buildServices`
2. Tests for cache hit / negative miss
3. Frontend: taste-fingerprint deps for AI picks
4. Infra: App Runner size + health; cache table PITR off
5. `AiClient` `maxAttempts: 2` when `AI_PRIMARY` is set

## Done in this session

- [x] `RecommendationService` deepened with hit (1h) + negative miss (10m) cache; taste-stable key
- [x] Frontend AI picks effect keyed on `tasteFingerprint` (not every track skip)
- [x] `AiClient` caps cascade at primary + one fallback when `AI_PRIMARY` is set
- [x] App Runner default `0.25 vCPU / 0.5 GB`, health interval 20s
- [x] Dynamo cache table PITR disabled
- [x] Hand-rolled `DynamoCacheStore` + `LayeredCacheStore` wired from `DDB_TABLE_CACHE`
- [x] Shared `cachedLookup` used by recommendations + translation (body-hash keys + negative miss)
- [x] AI route rate limit: 20/min on `/api/ai/*`
- [x] App Runner sets `AWS_REGION` explicitly for SigV4

## Still human / console

- Point `S3_COVERS_PUBLIC_BASE_URL` at a CloudFront distribution URL
- Confirm `$10` budget alert email is subscribed
- Do **not** remove stream proxy (Web Audio / 206 invariant)

## Later deepening (optional)

- Roll `cachedLookup` into catalog/artwork/lyrics for one Locality
- `recommendForUser` orchestration seam (move taste hydration out of `routes/ai.ts`)

## Success metrics

- Skipping tracks does **not** fire a new Bedrock call when taste fingerprint unchanged
- Second identical recommend request is a cache hit (no `AiClient.complete`)
- App Runner template documents smaller instance for prod-default
