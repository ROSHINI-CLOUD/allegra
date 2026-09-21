# Stem separator (AWS Batch GPU worker)

GPU worker that turns a staged source object in S3 into dual stems:

- `karaoke/{trackId}/{fingerprint}/{version}/vocals.m4a`
- `karaoke/{trackId}/{fingerprint}/{version}/instrumental.m4a`
- `karaoke/{trackId}/{fingerprint}/{version}/manifest.json`

Uses [audio-separator](https://github.com/nomadkaraoke/python-audio-separator) with **htdemucs** as the default model (`STEM_MODEL`). Four-stem Demucs outputs are mixed (drums + bass + other → instrumental).

Target host: **g4dn.xlarge** Spot via AWS Batch (`linux/amd64`, NVIDIA T4).

## Environment

| Variable | Required | Description |
|---|---|---|
| `TRACK_ID` | yes | Song / track id |
| `SOURCE_OBJECT` | yes | S3 key staged by the API (e.g. `karaoke-input/{id}/{fp}`) |
| `SOURCE_FINGERPRINT` | yes | Content fingerprint used in the output path |
| `STEM_MODEL` | yes | Allowlisted alias (`htdemucs`, …) |
| `SEPARATION_VERSION` | yes | Version segment in the output path (e.g. `aws-batch-htdemucs-v1`) |
| `KARAOKE_S3_BUCKET` | yes | Bucket for input + stems |
| `AWS_REGION` | recommended | Region for the S3 client |
| `MODEL_DIR` | no | Model cache dir (default `/models`) |
| `WORK_DIR` | no | Temp work root (default `/tmp/stem-work`) |
| `WORKER_VERSION` | no | Written into `manifest.json` |

IAM: task role with `s3:GetObject` on `karaoke-input/*` and `s3:PutObject` on `karaoke/*`, plus CloudWatch Logs. Do **not** bake access keys into the image.

## Build (linux/amd64)

From repo root (prefer an explicit git sha tag):

```bash
REGION=ap-south-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=allegra-stem-separator-dev   # or the ECR repo from karaoke-batch.yaml
SHA=$(git rev-parse --short HEAD)

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

docker build --platform linux/amd64 \
  -t "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$SHA" \
  -t "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:v1" \
  workers/stem-separator

docker push "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$SHA"
docker push "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:v1"
```

## Run locally (NVIDIA GPU)

```bash
export AWS_REGION=ap-south-1
export KARAOKE_S3_BUCKET=your-bucket
export TRACK_ID=demo-track
export SOURCE_OBJECT=karaoke-input/demo-track/abc123
export SOURCE_FINGERPRINT=abc123
export STEM_MODEL=htdemucs
export SEPARATION_VERSION=aws-batch-htdemucs-v1

docker run --rm --gpus all \
  -e AWS_REGION -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
  -e KARAOKE_S3_BUCKET -e TRACK_ID -e SOURCE_OBJECT -e SOURCE_FINGERPRINT \
  -e STEM_MODEL -e SEPARATION_VERSION \
  allegra-stem-separator:local
```

On Batch, credentials come from the job role — omit static keys.

## Run on AWS Batch

1. Deploy `infra/aws/karaoke-batch.yaml` (see `docs/karaoke-aws-deploy.md`).
2. Push an image tagged with the git sha; pass that URI as `ImageUri`.
3. The API submits jobs with `containerOverrides.environment` matching the table above.
4. Watch `/aws/batch/job` (log group from the stack) for timing lines:
   `input_download_ms`, `model_load_ms`, `inference_ms`, `encoding_ms`, `upload_ms`, `total_job_ms`.

Exit **0** on success; nonzero on failure (Batch marks the attempt failed / may retry).

## Models

See `models.py`. Default: **htdemucs**. BS-RoFormer / MelBand-RoFormer aliases exist for later A/B only — verify license and commercial-use terms before production.
