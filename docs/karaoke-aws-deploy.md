# Karaoke stem separation — AWS Batch deploy

Self-hosted dual-stem (vocals + instrumental) separation on **Spot GPU** via AWS Batch.
Prefer region **`ap-south-1`** (Mumbai) to match the rest of Allegra unless GPU quota forces otherwise.

Related:

- Decisions (why Batch, dual stems, no Scarleta): [`karaoke-aws-decisions.md`](./karaoke-aws-decisions.md)
- Worker image: [`workers/stem-separator/`](../workers/stem-separator/)
- CloudFormation: [`infra/aws/karaoke-batch.yaml`](../infra/aws/karaoke-batch.yaml)
- Cost / timing template: [`karaoke-aws-cost-benchmark.md`](./karaoke-aws-cost-benchmark.md)
- Planning handoff: [`.planning/23-HANDOFF-KARAOKE.md`](../.planning/23-HANDOFF-KARAOKE.md)

## 0. Prerequisites

- AWS CLI v2, Docker with `buildx`, account access in `ap-south-1`
- IAM permission to create Batch, EC2, ECR, S3, IAM, CloudWatch, VPC
- **Service Quotas** — confirm G-family Spot vCPU before first job (see below)

## 1. Quota check (G Spot vCPU)

Before deploying, open Service Quotas in **ap-south-1**:

1. Console → **Service Quotas** → **Amazon Elastic Compute Cloud (Amazon EC2)**
2. Find **Running On-Demand G and VT instances** is *not* the Spot quota — look for:
   - **All G and VT Spot Instance Requests** (vCPU), or the regional Spot G-family equivalent listed for your account
3. If the applied value is **0**, request an increase (start with **4–8 vCPU** for one `g4dn.xlarge`)
4. Do **not** silently switch to larger / On-Demand families to bypass a zero quota

CLI sketch:

```bash
aws service-quotas list-service-quotas \
  --region ap-south-1 \
  --service-code ec2 \
  --query "Quotas[?contains(QuotaName, 'G') && contains(QuotaName, 'Spot')].[QuotaName,Value]" \
  --output table
```

Wait until the quota is approved before expecting Batch to place GPU Spot capacity.

## 2. Deploy the CloudFormation stack (once)

The stack creates a small VPC, Spot managed CE (`SPOT_PRICE_CAPACITY_OPTIMIZED`, `g4dn.xlarge`, min/desired **0**), job queue, job definition, ECR repo, private S3 bucket (lifecycle on `karaoke-input/`), IAM roles, and a log group.

You need an image URI for the first deploy. Options:

**A.** Create the ECR repo first by deploying with a placeholder image, push, then update `ImageUri`, **or**

**B.** Create the ECR repository manually, push, then deploy with the real URI.

```bash
REGION=ap-south-1
ENV=dev
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

# After the ECR repo exists (from stack output EcrRepositoryUri or a prior create):
REPO=allegra-stem-separator-${ENV}
SHA=$(git rev-parse --short HEAD)
IMAGE_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPO}:${SHA}"

aws cloudformation deploy \
  --region "$REGION" \
  --stack-name "allegra-karaoke-batch-${ENV}" \
  --template-file infra/aws/karaoke-batch.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    EnvironmentName="$ENV" \
    ImageUri="$IMAGE_URI" \
    MaxvCpus=4
```

`MaxvCpus=4` ≈ **one** concurrent `g4dn.xlarge` (4 vCPU). Raise later for production concurrency.

Capture outputs:

```bash
aws cloudformation describe-stacks \
  --region "$REGION" \
  --stack-name "allegra-karaoke-batch-${ENV}" \
  --query 'Stacks[0].Outputs' \
  --output table
```

You need at least: `KaraokeBucketName`, `JobQueueName` / ARN, `JobDefinitionName` / ARN, `EcrRepositoryUri`.

## 3. Build and push the worker (git sha tag)

Always tag with the **git sha**. The ECR repository is tag-**immutable**, so a sha tag can never be overwritten (do not push `latest` or a moving `v1`).

```bash
REGION=ap-south-1
ENV=dev
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=allegra-stem-separator-${ENV}
SHA=$(git rev-parse --short HEAD)
IMAGE_URI="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com/${REPO}:${SHA}"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

docker build --platform linux/amd64 \
  -t "$IMAGE_URI" \
  workers/stem-separator

docker push "$IMAGE_URI"
```

Update the stack (or register a new job-definition revision) so `ImageUri` points at the sha you just pushed.

## 4. API environment variables

Set these in the **Vercel project env** (or `apps/api/.env` locally). Vercel has no instance role, so the API uses the dedicated, least-privilege IAM user the stack creates (`KaraokeApiUserName`) — never the shared Bedrock session token, which expires.

| Variable | Example | Notes |
|---|---|---|
| `AWS_REGION` | `ap-south-1` | Same region as the Batch stack |
| `AWS_BATCH_JOB_QUEUE` | `allegra-karaoke-dev` | Queue name or ARN from stack output |
| `AWS_BATCH_JOB_DEFINITION` | `allegra-stem-separator-dev` | Name or ARN from stack output |
| `KARAOKE_S3_BUCKET` | `allegra-karaoke-dev-…` | Stack `KaraokeBucketName` |
| `KARAOKE_AWS_ACCESS_KEY_ID` / `KARAOKE_AWS_SECRET_ACCESS_KEY` | from `aws iam create-access-key` | Keys for the stack's API user only |
| `STEM_SEPARATION_VERSION` | `aws-batch-htdemucs-v1` | Bump when model/pipeline changes (cache key) |
| `STEM_MODEL` | `htdemucs` | Must be allowlisted in the worker (`models.py`) |

All three of `AWS_BATCH_JOB_QUEUE`, `AWS_BATCH_JOB_DEFINITION`, and `KARAOKE_S3_BUCKET` must be set together (or all blank to disable karaoke).

## 5. Smoke test

1. Stage or trigger Sing on one 3–5 minute track through the API.
2. Confirm **exactly one** Batch job in the queue.
3. Watch logs in `/allegra/karaoke-batch/<env>` for:
   `input_download_ms`, `model_load_ms`, `inference_ms`, `encoding_ms`, `upload_ms`, `total_job_ms`
4. Verify S3 objects:
   `karaoke/{trackId}/{fingerprint}/{version}/vocals.m4a`
   `instrumental.m4a`
   `manifest.json`
5. Request Sing again — **no** new Batch job (cache hit).

First job from a cold CE includes Spot capacity spin-up; subsequent jobs with warm capacity are faster. Scale returns toward **0** vCPU when the queue is empty.

## 6. Adding an On-Demand fallback later

Initial design is Spot-only. If Spot interruptions or capacity become painful:

1. Add a second **MANAGED** compute environment in the same template (or a nested stack) with `Type: EC2` (On-Demand), same `g4dn.xlarge`, min/desired **0**, conservative `MaxvCpus`.
2. Attach it to the **same job queue** with a **lower priority order** than Spot (Spot order `1`, On-Demand order `2`), **or** use a separate queue the API only uses after classifying `SPOT_INTERRUPTION` / `AWS_CAPACITY`.
3. Keep the job definition unchanged (same image, GPU=1).
4. Do not raise On-Demand max until Spot path is measured; On-Demand is the expensive path.

Do not overcomplicate the first ship — Spot alone is enough for the hackathon path.

## 7. Cost formula (placeholder)

Fill real numbers in [`karaoke-aws-cost-benchmark.md`](./karaoke-aws-cost-benchmark.md). Conceptual formula per successful separation:

```text
cost_per_song_INR ≈
    (billable_gpu_instance_seconds / 3600) * spot_hourly_INR_g4dn_xlarge
  + s3_put_get_INR
  + s3_storage_INR_amortized
  + data_transfer_INR
  + (ecr_pull_amortized_INR)
```

Target: under ₹20 total per ~4 minute song, ideally ₹1–₹5. This is a target to verify, not a measured result — measure; do not hardcode cost into product behavior.

## 8. Operational notes

- Worker temp files are deleted on exit; `karaoke-input/` expires via lifecycle (default 3 days); **`karaoke/` stems are retained**.
- Spot retries: job definition retry strategy retries host/Spot-style failures; output keys are deterministic so retries are idempotent.
- Model weights: first inference may download into `/models`. Optionally bake weights into the image (see Dockerfile comment) after license review.
- Never expose raw Batch, GPU, or model names in end-user UI copy.
