# 23 — Karaoke (AWS Batch) handoff

Branch: `fe/karaoke-aws`. Scarleta is gone; nothing in the repo calls it.

## Architecture

```
Sing button → POST /api/songs/:id/karaoke → KaraokeService → KaraokeSeparationProvider
                                                             └─ AwsBatchStemSeparationProvider
   Batch (Spot g4dn.xlarge, scale to 0) → workers/stem-separator (audio-separator, htdemucs)
   → private S3: karaoke/{song}/{fingerprint}/{version}/{vocals,instrumental}.m4a + manifest.json
   → GET /api/stream/karaoke/:id/{vocals,instrumental}  (Range → 206 preserved)
   → browser Web Audio: two GainNodes, sliders are local-only
```

## Why it is stateless

The API runs as Vercel functions: they freeze after responding and each instance has its own memory.
So there is no background polling and no in-process lock. AWS is the source of truth:

- **Ready** = `manifest.json` exists (the worker writes it after both stems).
- **In flight / failed** = `karaoke-state/…json` marker + `DescribeJobs`, reconciled on every status read.
- **One job per song** = S3 conditional write (`If-None-Match` / `If-Match`) is the cross-instance lock.
  A claimer that dies before submitting is taken over after 120 s. Proven by the 20-concurrent test.
- The in-memory cache only remembers *ready* results as a speed-up.

## Failure classes

Worker exit codes → API error codes: 10 `INVALID_AUDIO`, 11 `MODEL_FAILURE`, 12 `UPLOAD_FAILURE`,
13 `OUTPUT_MISMATCH`; Batch reasons → `SPOT_INTERRUPTION`, `TIMEOUT`, `AWS_CAPACITY`.
Batch retries only Spot host loss; a job stuck without capacity is cancelled after 30 min. A failed song is retryable
(POST again takes over the claim atomically).

## Legacy data

No Scarleta-generated assets ever shipped, so there is nothing to migrate. Stem identity includes the separation
version, so bumping `STEM_SEPARATION_VERSION` regenerates once per song.

## Deploy / test

See `docs/karaoke-aws-deploy.md`. Nothing has been deployed or measured yet: `docs/karaoke-aws-cost-benchmark.md`
is intentionally all `TBD` until a real run fills it.
