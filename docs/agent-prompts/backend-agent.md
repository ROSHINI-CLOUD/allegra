# AGENT BRIEFING — Backend (P1)

Paste as the opening message of a fresh agent session in the Allegra repo.

---

You are helping me build the backend for **Allegra**, a music-streaming web app, for the First Commit hackathon (WeMakeDevs × AWS). We have ~30 hours. I am P1, the backend owner.

**Read these first, in order:**
1. `.planning/05-BACKEND-PLAN.md` — my ticket list in build order
2. `docs/api-contract.md` — **frozen**. Do not change response shapes.
3. `docs/provider-integration.md` + `ALLEGRA_BACKEND_SPEC.md` — exact provider endpoints, headers, gotchas. **These are extracted from a working production implementation — follow them literally rather than writing what looks reasonable.**
4. `CLAUDE.md` — project rules

**Stack:** Node 20, Express, TypeScript strict, AWS SDK v3 (DynamoDB), zod, Docker → App Runner.

**Work one ticket at a time, in the order in the plan.** After each: run typecheck and tests, show me the diff, wait. Do not scaffold the whole API at once — I have to be able to explain every line to a judge, and *Technical Understanding* is a scored criterion.

**Non-negotiables:**
- `BROWSER_HEADERS` on every Saavn/Gaana call
- Gaana fires **only on zero results**, not on error
- HTML entity decoding: named, decimal **and** hex
- Artist handles both `primaryArtists` (string) and `artists.primary[]` (array)
- Duration is always **seconds**
- Every outbound call: `AbortController` timeout + own try/catch returning empty, never throwing
- `{ success, data, error? }` envelope everywhere; never leak a provider error to the client
- **No secrets in code** — SSM at boot
- Provider responses typed as narrow interfaces covering only consumed fields. No `any`.

**The one that matters most — `GET /api/stream/:songId`:**
Forward the client's `Range` header verbatim. Preserve the upstream status — **a `206` must stay a `206`** — and pass through `Content-Range`, `Accept-Ranges`, `Content-Length`. Re-resolve the URL once on a 403/404 and retry. **Stream the body; never buffer it.** If this returns `200` where it should return `206`, audio plays perfectly and seeking silently does nothing. That is our highest-risk failure.

**Ask me before:** changing anything in `docs/api-contract.md`, adding a dependency, or adding an endpoint that isn't in the plan.

Start with ticket **B1** (skeleton + `/api/health` + Dockerfile) — infra is blocked on the health endpoint existing.
