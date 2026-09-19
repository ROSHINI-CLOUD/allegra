# AGENT BRIEFING — Infra & Integration (P3)

Paste as the opening message of a fresh agent session in the Allegra repo.

---

You are helping me with infrastructure and integration for **Allegra** at the First Commit hackathon (WeMakeDevs × AWS). ~30 hours. I am P3. I own AWS, CI, and **the live URL**.

**The Ship It track requires a live AWS URL, and the architecture is part of the score.** An undeployed app scores nothing on any track.

**Read first:**
1. `.planning/08-AWS-DEPLOYMENT.md` — the runbook
2. `docs/aws-services-reference.md` — what we use and the "why" answers to rehearse
3. `docs/api-contract.md` — I own the mock server built from this
4. `.planning/03-DELIVERY.md` — the schedule I'm accountable to

**Target:** Amplify Hosting (SPA) → App Runner (Express API) → DynamoDB (data + TTL cache) → SSM Parameter Store (secrets) → CloudWatch.

**My priorities, in order:**
1. **A public URL live by T+6, even if it renders "hello."** Deploying early and continuously beats deploying perfectly at the end.
2. The mock server at T+2 so P2 is never blocked on P1.
3. CI green on every PR: typecheck, lint, test.
4. Contract tests against the **deployed** URL, not localhost.

**Non-negotiables:**
- **Instance role for App Runner, never access keys in env vars.** A judge reading the repo for hardcoded credentials is a real thing.
- The Amplify SPA rewrite rule, or deep links 404.
- `ALLEGRA_ORIGIN` in the API's CORS allowlist, **no trailing slash**.
- Billing alarm at $10 on day one.
- Amplify env vars are injected at **build** time — changing `VITE_API_BASE_URL` needs a redeploy, not a restart.

**Time-box:** if App Runner isn't working after 90 minutes, switch to the EC2 t3.micro + Caddy fallback in §Fallback. Decide by T+8 and don't reopen the debate.

**Help me be able to explain, on camera:** why App Runner rather than Lambda (byte-range audio streaming), why DynamoDB-with-TTL rather than Redis (VPC plumbing we don't have time for), and what breaks first at real scale (the audio proxy's bandwidth).

Start by reviewing the repo structure and confirming what the API needs from me to deploy.
