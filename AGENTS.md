# AGENTS.md

Agent-facing guide for the Allegra repo. Human-facing rules are in `CLAUDE.md` — **read that too; everything in it applies here.**

## Orientation, in order
1. `.planning/03-DELIVERY.md` — the schedule and current phase
2. `docs/api-contract.md` — **frozen**. The FE↔BE seam.
3. The plan for your area — `.planning/05-` backend, `06-` frontend, `07-` motion, `13-` completion plan (no AWS), `09-` QA
4. `CLAUDE.md` — the hard rules

Role briefings: `docs/agent-prompts/{backend,frontend,infra,qa}-agent.md`

## How to work here

**One ticket at a time.** The plans are ordered lists. Take the next one, finish it, show the diff, stop. Do not scaffold a whole layer at once — a human has to be able to explain every line to a judge, and *Technical Understanding* is a scored criterion.

**Vertical slices, never horizontal layers.** Don't build "all the endpoints" then "all the UI." Build search→play end-to-end and deployed, then add depth.

**Verify before claiming done.** Run typecheck, lint and tests. If something fails, say so with the output. Never report a task complete on the strength of the code looking right.

**Ask before:** changing `docs/api-contract.md`, adding a dependency, adding anything not in the plan, or touching another role's directory.

## Reference material is authoritative
`docs/provider-integration.md` and `ALLEGRA_BACKEND_SPEC.md` are extracted from a **working production implementation**. The headers, fallback triggers and parsing quirks in them are load-bearing and were each learned from a real bug. **Follow them literally rather than writing what looks reasonable.** Specifically:
- `BROWSER_HEADERS` on every Saavn/Gaana call (Cloudflare)
- Gaana fires only on **zero results**, not on error
- HTML entity decoding: named, decimal **and** hex
- Artist arrives as a string **or** an array — handle both
- Reject a lyrics body containing `<div`/`<html`/`<!DOCTYPE` and fall through
- Permissive LRC regex; real files are dirty

## Things that look optional and are not
| | Why |
|---|---|
| `Range` → `206` on `/api/stream` | Audio plays fine, seeking silently dies |
| Negative caching on lyrics misses | Misses get re-queried hardest |
| `prefers-reduced-motion` | Accessibility, and judges check |
| Loading / empty / error states | Half of Best UI is what happens when things aren't perfect |
| Long-text and script handling | Devanagari and Tamil clip on line-height, not width |

## Never
- Put a provider URL, token or secret in `apps/web`
- Change a shared type without updating `docs/api-contract.md` first
- Animate anything other than `transform`/`opacity`
- Add an AI attribution footer to a commit
- Push directly to `main`
- Add a feature after T+26

## Environment
```
apps/web   VITE_API_BASE_URL          # the ONLY client env var
apps/api   PORT · ALLEGRA_ORIGIN · SAAVN_API_URL · GAANA_API_URL
           LRCLIB_API_URL · JWT_SECRET · CONVEX_URL · CONVEX_SERVER_SECRET
```
Everything secret comes from the host environment (Render dashboard) and the Convex dashboard. `.env.example` stays current; real values never get committed.
