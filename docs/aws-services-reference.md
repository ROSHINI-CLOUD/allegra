# AWS SERVICES REFERENCE — what we use and why

Written so any team member (or agent) can answer an architecture question without opening the console.

## Amplify Hosting — the SPA
Git-connected static hosting: CDN, TLS, preview branches per PR, build on push. Free tier covers a hackathon comfortably.
- **Monorepo:** set `appRoot: apps/web` in `amplify.yml`.
- **SPA rewrite is mandatory** or deep links 404 — see `08-AWS-DEPLOYMENT.md` §1.
- Env vars are injected at **build** time. Changing `VITE_API_BASE_URL` requires a **redeploy**, not a restart. This confuses people; it's the #1 Amplify gotcha.

## App Runner — the API
Container or source → autoscaling HTTPS service. No ALB, no VPC, no certificates.
- Needs: listen on `PORT`, a health check path, a `Dockerfile`.
- **Attach an instance role** for DynamoDB + SSM. Not access keys in env vars.
- Scales to zero-ish between requests; expect a small cold start after idle.
- **Why here:** the audio proxy is a long-lived HTTP response with byte-range semantics. That's what a normal HTTP server does well and what Lambda makes awkward.

## DynamoDB — data *and* cache
Serverless key-value. **25 GB always free.** On-demand billing = no capacity planning.
- **TTL** — set an epoch-seconds attribute and rows self-delete. This is what makes one table serve as both persistence and cache. Deletion is background, not instant, so **also check the TTL on read**.
- Design keys for the access pattern, not for normalisation. `pk = "search#<normalized-query>"`.
- Normalise cache keys (lowercase, trim, collapse whitespace) or the hit rate is terrible.

## SSM Parameter Store — secrets
Standard parameters are free; `SecureString` is KMS-encrypted. Read once at boot, cache in memory — **never per-request**.
Preferred over Secrets Manager here: same job, no per-secret cost, no rotation needed for a weekend.

## CloudWatch — logs & metrics
App Runner ships stdout automatically. Add one dashboard (requests, p95 latency, 5xx, CPU/mem). Ten minutes of work and it's a slide.

## Amazon Bedrock ★ — the AI feature
Managed API over foundation models, no infrastructure. Use the Bedrock Runtime SDK client.
- **Enable model access in the console first** — it is not on by default, and this trips everyone up once.
- Region availability varies by model; pick a region where your chosen model is enabled and keep everything in it.
- Constrain output to JSON, **validate with `zod` before trusting it**, and wrap in try/catch that degrades to plain search.
- **Why it matters here:** Allegra ships an unused `@google/genai` dependency. Replacing a Google AI placeholder with a real AWS AI feature is exactly the kind of decision that reads well in an AWS hackathon.

## Free-tier & cost notes
Amplify free tier · DynamoDB 25 GB always-free · SSM standard free · CloudWatch pennies · App Runner ≈ **$3 for a weekend** at 1 vCPU/2 GB. Comfortably inside credits.

**Set a billing alarm at $10 on day one.** Ten minutes, and it removes a whole category of anxiety.

> **Verify current free-tier terms yourself** — they change, and this file is a snapshot, not a contract.

## The architecture answers to rehearse

**"Why App Runner and not Lambda?"**
> Our audio proxy streams byte-range responses. Lambda's response handling makes that awkward, and we'd have spent the night fighting it. App Runner is a normal HTTP server, so `Range` and streaming just work. For the rest of the API Lambda would have been fine — we chose one runtime for the whole service rather than splitting it.

**"Why DynamoDB for caching instead of Redis?"**
> ElastiCache needs a VPC, and App Runner then needs a VPC connector. That's an hour we didn't have for a weekend project. DynamoDB with a TTL attribute gives us expiring cache rows and our persistence in one service, with no network plumbing.

**"What breaks at scale?"**
> The audio proxy. Every byte flows through our server. The first change I'd make is a short-lived signed redirect so the CDN serves the bytes directly, and only true-proxy when the client needs CORS-clean audio for the visualizer.
