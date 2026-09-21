> **Superseded (2026-09-20):** the DynamoDB/ECR/CloudFormation shape below was replaced with a Console-only deploy (no AWS CLI needed): **AWS Amplify Hosting (web) + AWS App Runner source-deploy (API) + Convex (user data)**. See `infra/README.md` for the actual runbook. AWS hosting is still a hard requirement (`01-GOAL.md` — Ship It). This file is kept for the "fuller AWS story" reference the README links to.

# 08 — AWS DEPLOYMENT (P3 owns) — the Ship It track

> **The architecture is part of the score.** Don't just get it live — be able to explain every box in the diagram and why it isn't a different box.

## Pre-flight (do this at T+0, not later)

- [ ] Every member: AWS account. Free tier. Signup takes a debit card / RuPay; the verification charge is about ₹2.
- [ ] Every member: **AWS Builder Center profile with university enrollment verified** — this is an eligibility requirement and verification is not instant. Start it first.
- [ ] Apply the AWS credits (startups get up to $200; check what the event provides)
- [ ] One account nominated as the deploy account; share access properly (IAM users, not root credentials in Slack)
- [ ] **Set a billing alarm at $10.** Ten minutes now, versus a nasty surprise later.

## Target architecture

| Layer | Service | Why |
|---|---|---|
| SPA | **Amplify Hosting** | Repo → HTTPS + CDN + preview branches in ~10 min. Free tier. |
| API | **App Runner** | Container → public HTTPS URL. No ALB, no VPC, no cert wrangling. Handles `Range` + streaming because it's a normal HTTP server. |
| Data + cache | **DynamoDB** | One service for persistence *and* (via TTL) the provider cache. 25 GB always-free. No VPC. |
| Secrets | **SSM Parameter Store** (SecureString) | Free. Secrets Manager costs per secret for no benefit here. |
| Logs | **CloudWatch** | Log group + one dashboard. Cheap credibility on the architecture score. |
| AI ★ | **Bedrock** | Stretch. Replaces the unused `@google/genai` placeholder with something on-AWS and judgeable. |
| Sing / Karaoke ★ | **Batch (Spot GPU) + ECR + S3** | On-demand dual-stem separation; CE scales to **0**. CFN: `infra/aws/karaoke-batch.yaml`. Decisions: `docs/karaoke-aws-decisions.md`. |

**Why not Lambda + API Gateway?** The audio proxy. Byte-range streaming through Lambda means fighting response size limits and streaming invoke modes. At 2 AM that's a night lost. **This is the single best "explain your decision" answer in the whole project — make sure whoever presents can give it.**

**Why not SageMaker / always-on GPU for Sing?** Cost and ops. Batch Spot `g4dn.xlarge` runs only while a job exists; empty queue → zero GPU instances.

## Runbook

### 1 · Amplify (T+2, target live by T+4)
1. Console → Amplify → Host web app → connect the GitHub repo, branch `main`
2. Build settings for a Vite monorepo:
```yaml
version: 1
applications:
  - appRoot: apps/web
    frontend:
      phases:
        preBuild:  { commands: ["npm ci"] }
        build:     { commands: ["npm run build"] }
      artifacts: { baseDirectory: dist, files: ["**/*"] }
      cache:     { paths: ["node_modules/**/*"] }
```
3. Env var `VITE_API_BASE_URL` → App Runner URL (placeholder until step 2 lands)
4. **SPA rewrite rule — everyone forgets this and deep links 404:**
   `</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff2?|map|json)$)([^.]+$)/>` → `/index.html` (200 Rewrite)

**DoD:** a public HTTPS URL renders the app. **Even if it renders "hello" — get the URL live on day one.**

### 2 · App Runner (T+4, target live by T+6)
Needs three things from P1: a `Dockerfile`, a `PORT` env listen, and `GET /api/health`.

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
CMD ["node", "dist/index.js"]
```
Console → App Runner → Create → **Source: GitHub** (simplest) or ECR → port `8080`, health check `/api/health` → 1 vCPU / 2 GB.

**Attach an instance role** with least-privilege access to the DynamoDB tables and the SSM path. **Not access keys in env vars** — a judge looking at your repo for hardcoded credentials is a real thing, and the instance role is the better answer anyway.

**DoD:** `curl https://<id>.awsapprunner.com/api/health` → 200.

### 3 · CORS wiring (T+6) — the classic 20-minute bug
```ts
app.use(cors({
  origin: [process.env.ALLEGRA_ORIGIN!, 'http://localhost:5173'],
  credentials: true,
}));
```
`ALLEGRA_ORIGIN` = the Amplify URL, **no trailing slash**. The `/api/stream` route additionally needs `Cross-Origin-Resource-Policy: cross-origin` for Web Audio.

### 4 · DynamoDB (T+8)
Three on-demand tables: `allegra-cache` (PK `pk`, **TTL attribute `ttl`**), `allegra-users` (PK `userId`), `allegra-libraries` (PK `userId`, SK `libraryId`). On-demand billing — no capacity planning, no cost at our volume.

### 5 · SSM (T+8)
```
/allegra/prod/JWT_SECRET          SecureString
/allegra/prod/SAAVN_API_URL       String
/allegra/prod/GAANA_API_URL       String
```
Read at boot, cache in memory. Never per-request.

### 6 · CI (T+8)
GitHub Actions on PR: `typecheck → lint → test`. Amplify and App Runner already auto-deploy on `main`. That's the pipeline — don't gold-plate it.

### 7 · CloudWatch (T+16)
Log group + one dashboard: request count, p95 latency, 5xx rate, App Runner CPU/mem. Ten minutes, and it's a screenshot for the architecture slide.

## Fallback — decide by T+8, not later

If App Runner blocks (quota, cost, deploy trouble): **EC2 t3.micro** (free tier, 12 months) + **Caddy** for automatic TLS.
```
# Caddyfile
api.your-domain.com { reverse_proxy localhost:8080 }
```
Slower to stand up and you own the process manager (`pm2` or a systemd unit). Zero cost. **Time-box the App Runner attempt to 90 minutes**, then switch without debate.

## Cost sanity
Amplify free tier · DynamoDB always-free · SSM free · App Runner ≈ **$3 for the weekend** at 1 vCPU/2 GB · CloudWatch pennies. Comfortably inside credits. **The billing alarm still goes on.**

> ⚠️ **Bandwidth:** every audio byte flows through your proxy. Fine for a demo; it's the thing that wouldn't scale, and saying so out loud — *"here's what I'd change first at real volume"* — is a strong Technical Understanding answer.

## Ship It checklist
- [ ] Public HTTPS URL, working **from a phone on mobile data** (not office wifi)
- [ ] API health check green
- [ ] Deep links work (SPA rewrite in place)
- [ ] No secrets in the repo (P4 greps for them)
- [ ] Instance role, not access keys
- [ ] Billing alarm set
- [ ] Architecture diagram in the README
- [ ] You can explain **every box**, and why it isn't a different box
