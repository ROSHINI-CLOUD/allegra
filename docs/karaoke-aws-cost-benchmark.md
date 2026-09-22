# Karaoke AWS Batch — cost & timing benchmark template

Fill this after real runs in **ap-south-1** on `g4dn.xlarge` Spot.  
**Do not invent numbers.** Leave cells as `TBD` until measured.

Worker log fields to copy: `input_download_ms`, `model_load_ms`, `inference_ms`, `encoding_ms`, `upload_ms`, `total_job_ms`.  
Also record Batch job wall time (Submitted → Succeeded) and EC2 instance lifetime from the CE if available.

## Run metadata

| Field | Value |
|---|---|
| Date (UTC) | TBD |
| Region | ap-south-1 |
| Environment | TBD (`dev` / `prod`) |
| Image tag (git sha) | TBD |
| `STEM_MODEL` | htdemucs |
| `SEPARATION_VERSION` | TBD |
| Instance type | g4dn.xlarge |
| Allocation | Spot (`SPOT_PRICE_CAPACITY_OPTIMIZED`) |
| MaxvCpus | 4 |
| Spot price observed (USD/hr) | TBD |
| FX rate used (USD → INR) | TBD |
| Notes | TBD |

## Per-song timing (worker)

| Track id | Duration (s) | Genre / language | Cold CE? (Y/N) | input_download_ms | model_load_ms | inference_ms | encoding_ms | upload_ms | total_job_ms | Batch wall (s) |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## Cost rollup (per successful song)

| Track id | Billable GPU seconds | Spot compute ₹ | S3 request ₹ | S3 storage ₹ (amortized) | Transfer ₹ | Other ₹ | **Total ₹** |
|---|---:|---:|---:|---:|---:|---:|---:|
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

**Target:** under ₹20 per ~4 min song, ideally ₹1–₹5. Unverified until the rows above are measured.

## Aggregate

| Metric | Value |
|---|---|
| Songs measured | TBD |
| Mean total_job_ms (warm) | TBD |
| Mean total_job_ms (cold CE) | TBD |
| Mean total ₹ / song | TBD |
| p95 total ₹ / song | TBD |
| Spot interruption rate | TBD |
| Retries / song (mean) | TBD |

## Quality checklist (listen, do not score numerically unless calibrated)

| Track id | Vocal leakage (low/med/high) | Instrument damage | Sync OK? | Notes |
|---|---|---|---|---|
| TBD | TBD | TBD | TBD | TBD |

## Model A/B (later)

Compare allowlisted candidates only after license review (`models.py`).

| Model alias | Mean inference_ms | Mean ₹ / song | Subjective vocal isolation | License cleared? |
|---|---:|---:|---|---|
| htdemucs | TBD | TBD | TBD | TBD |
| bs-roformer | TBD | TBD | TBD | TBD |
| melband-roformer | TBD | TBD | TBD | TBD |

## Formula reminder

```text
cost_per_song_INR ≈
    (billable_gpu_instance_seconds / 3600) * spot_hourly_INR_g4dn_xlarge
  + s3_put_get_INR
  + s3_storage_INR_amortized
  + data_transfer_INR
  + ecr_pull_amortized_INR
```

Billable GPU seconds should reflect **instance lifetime attributed to the job** (including pull/start), not only `total_job_ms`, when estimating Spot spend.
