# 00 — The GSD Method (how this team plans and works)

> **GSD = Goal → Strategy → Delivery.**
> One shared definition so four people mean the same thing by "the plan."

| Layer | Question | Changes | Lives in |
|---|---|---|---|
| **G — Goal** | What does winning look like, and what are the hard constraints? | Almost never | `01-GOAL.md` |
| **S — Strategy** | What shape of system gets us there, and what do we deliberately *not* build? | Only on a real discovery | `02-STRATEGY.md` |
| **D — Delivery** | Who does what, in what order, by when? | Every checkpoint | `03-DELIVERY.md` |

## The four rules

**1. The contract is frozen before the code.**
`docs/api-contract.md` is written and agreed in the first 90 minutes. Frontend builds against a mock of it, backend builds toward it. **Neither person is ever blocked on the other.** This single rule is worth more than any other on this list. If the contract has to change, it changes in the doc first, announced in the team channel, and both sides adapt — never a silent shape change.

**2. Every task has a visible Definition of Done.**
Not "search works." → "`GET /api/search?q=x` returns ≥1 normalized result with a non-empty `streamUrl`, in under 800 ms cold, and the FE renders it in a card grid." If you can't write the check, the task isn't ready to start.

**3. Vertical slices, never horizontal layers.**
Do not build "all the endpoints" then "all the UI." Build **search → play** end-to-end and deployed before touching lyrics. A thin thing that works beats a thick thing that doesn't. At any moment there must be a deployed URL that does *something*.

**4. Time-boxed, with a pre-agreed cut.**
Every phase has an hour budget and a named fallback in `11-RISK-REGISTER.md`. When the box is spent, you take the fallback. You do not negotiate with the clock at 3 AM. The cut list is decided *now*, while everyone is calm.

## Working rhythm (checkpoints)

Three sync points a day, 10 minutes, standing up, no laptops:

- **CP-A (morning)** — what I'll finish today, what's blocking me, what I need from whom.
- **CP-B (midday)** — integration pulse. Is `main` green? Is the live URL up? Anything need cutting?
- **CP-C (night)** — demo whatever exists on the *deployed* URL, not localhost. Update the risk register.

**Rule:** if a blocker survives two consecutive checkpoints, it gets cut or re-scoped. No exceptions.

## Branch & merge protocol

```
main                    always deployable, always green
  ├── be/<task>         backend
  ├── fe/<task>         frontend
  ├── infra/<task>      AWS, CI, env
  └── qa/<task>         tests, fixtures
```

Small PRs, squash-merged, reviewed by whoever isn't the author. **Nobody pushes to `main` directly.** A red `main` is a team-wide stop-the-line event — everyone drops what they're doing until it's green, because a red `main` means nobody can deploy, which means the Ship It track is at risk.

## How we work with AI agents

This is an AI-assisted build and the write-up has to disclose it, so we do it deliberately:

- Every role has a briefing in `docs/agent-prompts/`. You paste it as the opening message of a fresh agent session.
- `CLAUDE.md` / `AGENTS.md` at the repo root give any agent the project's rules without you re-explaining them each time.
- **You own the diff.** An agent proposes; you read it, run it, and put your name on the commit. "The AI wrote it" is not an answer a judge accepts under *Technical Understanding* — and that criterion is scored.
- Log what you used in `.planning/LEARNING-LOG.md` as you go, not the night before submission.
