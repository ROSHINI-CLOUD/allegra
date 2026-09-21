# Karaoke / Sing — AWS Batch decisions

**Date:** 2026-09-21  
**Branch:** `fe/karaoke-aws` (replaced `fe/karaoke-scarleta`)  
**Status:** Code + CloudFormation landed; **Batch stack not deployed from the agent session** (human deploy).

Related:

- Contract: [`api-contract.md`](./api-contract.md) § Karaoke / Sing  
- Deploy: [`karaoke-aws-deploy.md`](./karaoke-aws-deploy.md)  
- Cost template: [`karaoke-aws-cost-benchmark.md`](./karaoke-aws-cost-benchmark.md)  
- Planning handoff: [`.planning/23-HANDOFF-KARAOKE.md`](../.planning/23-HANDOFF-KARAOKE.md)

---

## 1. Problem we solved

The first karaoke implementation used **Scarleta** to produce a single instrumental URL. That was enough for an on/off “Karaoke” toggle, but not for Apple Music Sing–style independent voice/instrument control.

We needed:

1. **Two synchronized stems** — `vocals` + `instrumental`
2. **Generate once, cache forever** (per song + source fingerprint + model version)
3. **No AI / no network** when the user moves a volume slider
4. **No always-on GPU**
5. **No Scarleta** in runtime config or code

---

## 2. Architecture (final)

```text
Browser (Sing button + GainNode sliders)
    ↓  only our API
KaraokeService  (claim / poll / cache / proxy)
    ↓
AwsBatchStemSeparationProvider
    ↓  stage source → SubmitJob
AWS Batch (Spot, g4dn.xlarge / NVIDIA T4)
    ↓
stem-separator worker (audio-separator + FFmpeg)
    ↓
S3  karaoke/{trackId}/{fingerprint}/{version}/
        vocals.m4a
        instrumental.m4a
        manifest.json
    ↓
GET /api/stream/karaoke/:songId/{vocals|instrumental}  (Range → 206)
    ↓
Web Audio: MediaElementSource → GainNode → destination  (both stems)
```

**Normal mode** still plays the **original master** stream. Sing mode does **not** reconstruct the mix from stems for everyday listening.

---

## 3. Decision log

| Decision | Choice | Why |
|---|---|---|
| Keep vs rebuild Karaoke | **Keep** UI, cache, claim/dedupe, poll, routes; **replace provider only** | Spec + existing Scarleta work already had the deep module; rebuilding would burn time and regress concurrency |
| Provider | **AWS Batch + Spot GPU**, not Scarleta / SageMaker / EKS / always-on EC2 | Async, scales to zero, matches cost target |
| Instance | **`g4dn.xlarge` (T4)** Spot via `SPOT_PRICE_CAPACITY_OPTIMIZED` | Enough VRAM for HTDemucs; disposable worker |
| Capacity | **min/desired 0 vCPU**, max ~4 (one GPU) in CFN default | Dev safety — never leave GPUs running |
| Stems | **vocals + instrumental only** (no drums/bass/other retained) | Sing UX; storage cost |
| Model (v1) | **`htdemucs`** via `audio-separator`, configurable `STEM_MODEL` | Reliable baseline; RoFormer candidates documented for later A/B |
| Separation version | `aws-batch-htdemucs-v1` | Bumping regenerates once; same song+source+version never re-runs |
| Source audio to worker | **Stage into private S3** `karaoke-input/{songId}/{fingerprint}` | Worker must not fetch fragile Saavn CDN URLs |
| Job identity after API restart | Read **Batch job parameters** (`trackId`, `sourceFingerprint`, …) | In-memory map alone is lost on restart |
| Completion | Backend **polls Batch + HeadObject** on stem keys | Fits existing `KaraokeService` poll loop; browser never talks to AWS |
| Delivery | **Private S3 + API proxy** (optional CDN base later) | Matches “no provider URL in the browser”; Range → 206 preserved |
| Frontend mix | **Web Audio GainNodes** on two media elements | Slider moves are local-only |
| Branch | New **`fe/karaoke-aws`**; delete **`fe/karaoke-scarleta`** (local + fork) | Clear line between Scarleta experiment and AWS architecture |
| Deploy from agent | **Code + CFN only** | No GPU quota / account deploy in that session |
| AWS SDK in API | **Allowlist only** `@aws-sdk/client-batch` + `@aws-sdk/client-s3` | Rest of API stays hand-rolled SigV4 (covers, Dynamo, Bedrock); infra test updated |
| Env gate | Karaoke **503** unless `AWS_BATCH_JOB_QUEUE` + `AWS_BATCH_JOB_DEFINITION` + `KARAOKE_S3_BUCKET` all set | Half-config must not look “available” |
| Remove | All `SCARLETA_*`, Scarleta provider, Scarleta docs | No dead provider left |

---

## 4. What stayed the same

- `KaraokeService` deep module (`status` / `request` / `pipeStem`)
- `KaraokeSeparationProvider` seam + `FakeProvider` tests
- `CacheKaraokeAssetStore` claim race (one job under concurrency)
- Browser never sees raw S3/provider URLs
- Stream **Range → 206** rule
- Original song keeps playing while first-time generation runs

---

## 5. What changed for the product

| Before (Scarleta) | After (AWS Batch) |
|---|---|
| One instrumental | Dual stems |
| On/off Karaoke pill | **Sing** + Voice / Instrumental sliders |
| `SCARLETA_API_KEY` | Batch queue + job definition + karaoke bucket |
| Provider CDN (proxied) | Deterministic S3 keys, proxied by us |
| ~2 min poll budget | ~20 min poll (Spot cold start) |

---

## 6. Env vars (API)

| Variable | Role |
|---|---|
| `AWS_BATCH_JOB_QUEUE` | Queue name/ARN |
| `AWS_BATCH_JOB_DEFINITION` | Job definition name/ARN |
| `KARAOKE_S3_BUCKET` | Private stems + input bucket |
| `KARAOKE_AWS_ACCESS_KEY_ID` / `KARAOKE_AWS_SECRET_ACCESS_KEY` | Dedicated API IAM user (Vercel has no instance role) |
| `STEM_SEPARATION_VERSION` | Default `aws-batch-htdemucs-v1` |
| `STEM_MODEL` | Default `htdemucs` |
| `AWS_REGION` | Prefer same as App Runner (e.g. `ap-south-1`) |

Static `AWS_ACCESS_KEY_ID` / secret only when no task/instance role. Prefer IAM roles in AWS.

Removed: `SCARLETA_API_KEY`, `SCARLETA_API_BASE_URL`.

---

## 7. Open / human follow-ups

1. Confirm **G Spot vCPU quota** in `ap-south-1` (or chosen region)  
2. `aws cloudformation deploy` of `infra/aws/karaoke-batch.yaml`  
3. Build/push worker image to ECR (`stem-separator:<git-sha>`)  
4. Wire App Runner env to stack outputs  
5. Run one real song end-to-end; fill [`karaoke-aws-cost-benchmark.md`](./karaoke-aws-cost-benchmark.md) with measured ₹  
6. Optional: On-Demand Batch CE fallback if Spot capacity is chronically empty  
7. Optional: CloudFront OAC in front of the karaoke bucket  

---

## 8. Honest product labelling

- **Sing** is real stem separation **when Batch + GPU + bucket are configured**.  
- Without those env vars the control is **hidden** (API 503) — we do not ship a dead slider.  
- **Premium** remains a UI demo (no payments).  
- First Sing on an uncached track can take minutes while Spot capacity scales from zero; UI copy is “Preparing Sing… / Separating vocals and instruments…”, never “AWS / GPU / Batch”.
