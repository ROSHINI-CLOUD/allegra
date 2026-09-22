# LEARNING LOG

> **Learning & Growth is a named judging criterion.** This file is scored material.
> Fill it in at every checkpoint. It cannot be honestly reconstructed the night before — and a reconstructed one reads exactly like a reconstructed one.

One entry per person per checkpoint. Two minutes each. Specific beats profound.

---

### Template
```
## T+__ — <name>
**Did:** 
**Learned:** (something you didn't know this morning)
**Stuck on:** 
**Would do differently:** 
```

---

## T+0 — kickoff

**P1:**
**P2:**
**P3:**
**P4:**

---

## 2026-09-21 — Sing / AWS Batch (team)

**Did:** Replaced Scarleta karaoke with AWS Batch Spot dual-stem Sing on `fe/karaoke-aws`; deleted `fe/karaoke-scarleta`; wrote decisions + deploy docs; updated `.planning` so “visual-only karaoke” is no longer the story.

**Learned:** Keeping `KaraokeService` + the claim/dedupe seam mattered more than swapping HTTP providers — concurrency safety and “generate once” live above Scarleta/Batch. Also: an infra test that bans `@aws-sdk/*` forced an explicit allowlist for Batch+S3 only, instead of silently violating the hand-rolled SigV4 rule elsewhere.

**Stuck on:** Live GPU E2E (quota + CFN deploy) — left as human follow-up; agent session was code+CFN only.

**Would do differently:** Encode job identity in Batch parameters from day one (not only an in-memory map) before the first restart during polling.

Canonical: `docs/karaoke-aws-decisions.md`.

## Next dev served 404 for every route, including `/`

**What happened:** after running `next build` to inspect the Vercel output, `next dev` in the same
directory answered `404` with an empty body for `/`, `/discover`, everything. The app directory was
intact and the build had just succeeded, so it read like a routing or config bug. It was neither:
`.next/` held production build artifacts, and dev mode read them instead of compiling.

**The fix:** `rm -rf apps/web/.next`. Two racing `next dev` processes (one left over from another
terminal, which had silently taken port 5174) made it look intermittent on top of that.

**What it cost:** most of an hour chasing `turbopack.root` and the optional catch-all route, both of
which were fine.

**Would do differently:** treat "every route 404s, including the root" as a stale-artifact symptom
rather than a routing one — a real routing bug almost always spares `/`. Clear `.next` and confirm
exactly one dev server before reading any config.

---

---

> **Good entry:** "Learned that a proxy returning 200 instead of 206 makes an audio element unable to seek at all — the browser needs a byte-range to seek within. Took two hours to find because playback itself looked perfect."
>
> **Weak entry:** "Learned a lot about AWS today."
>
> The good one is a story you can tell on camera. The weak one is filler.
