# Roadmap — state, blockers, next

Updated 2026-09-22.

## Where things stand

| Area | State |
|---|---|
| Next.js App Router + real routes | **Done.** Verified: playback survives navigation on the same `<audio>` element. |
| One Vercel deployment (web + Express) | **Done.** Verified with a local `vercel build`: the `/api` rewrite precedes Next's catch-all, and a Range request returns `206`. |
| npm workspaces, one lockfile | **Done.** |
| Karaoke on AWS Batch (code) | **Done and tested locally.** Never run on real AWS. |
| Google sign-in via Convex Auth (code) | **Done and tested locally.** Never run against a real Google client. |
| Render / App Runner removal | **Done.** No container deploy path remains. |

## Blocked on someone with credentials

These are finished in code and cannot be verified further from here.

### 1. AWS karaoke — first real run

Needs: AWS credentials, a GPU Spot quota, and a decision to spend money.

1. `aws login`, then confirm G-family **Spot** vCPU quota in `ap-south-1` is not zero.
2. Deploy `infra/aws/karaoke-batch.yaml` with `MaxvCpus=4` (one GPU) and a `BudgetEmail`.
3. Build and push the worker image, tagged by git sha.
4. Create an access key for the stack's `KaraokeApiUserName` and set `KARAOKE_AWS_*` on Vercel.
5. Run **one** 3–5 minute song. Then verify, in order: exactly one Batch job; the GPU is actually
   used; both stems land in S3 with `manifest.json`; the API flips to ready; the sliders work
   instantly; vocals at 0% is a usable karaoke track; requesting Sing again creates **no** new job.
6. Fill `docs/karaoke-aws-cost-benchmark.md` with the measured timings and the real ₹ figure.

Full instructions: `docs/karaoke-aws-deploy.md`.

### 2. Google sign-in — first real sign-in

Needs: a Convex deployment and a Google OAuth client.

Follow `docs/auth-convex-google.md`. Then check that a guest who likes a song *before* signing in
still has it afterwards — that is the path most likely to be wrong in a way tests cannot see.

## Next, once those are verified

1. **Quality benchmark for Sing.** Compare `htdemucs` against a BS-RoFormer / MelBand-RoFormer
   candidate on the listening set in the PRD. Licences must be checked before any checkpoint is
   promoted — `workers/stem-separator/models.py` holds the allowlist and the reason for each entry.
2. **A shared cache.** Serverless instances each keep their own memory cache, so a cold start re-fetches
   search and lyrics. Either wire `DDB_TABLE_CACHE`, or move the cache into Convex and drop the
   DynamoDB adapter. Decide rather than leaving both half-present.
3. **Server-rendered content.** The shell is client-only (`ssr: false`), so `/artist/x` has no HTML for
   a crawler and nothing paints until JS loads. Rendering the static half of a view on the server is
   the single biggest first-paint and SEO win available.
4. **On-demand GPU fallback.** Only if Spot interruptions prove painful in practice. The method is
   written down at the end of `docs/karaoke-aws-deploy.md`; do not build it speculatively.

## Deliberately not doing

- A second infrastructure framework. CloudFormation is what exists; keep it.
- An event system (EventBridge/SQS) for job completion. Reconcile-on-read already works and is one
  moving part instead of three.
- Regenerating the stems of already-separated songs when the model changes. Bumping
  `STEM_SEPARATION_VERSION` re-separates lazily, on demand, one song at a time.
