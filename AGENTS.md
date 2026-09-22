# AGENTS.md

Agent-facing guide for the Allegra repo. The hard rules are in [`CLAUDE.md`](CLAUDE.md) — **read that
too; everything in it applies here.**

## Orientation, in order

1. [`docs/architecture.md`](docs/architecture.md) — how the system works end to end
2. [`docs/api-contract.md`](docs/api-contract.md) — the FE↔BE seam. Change it by proposing first.
3. [`.planning/ROADMAP.md`](.planning/ROADMAP.md) — current state and what is blocked on credentials
4. [`docs/workflows.md`](docs/workflows.md) — how to run, verify and ship
5. [`CLAUDE.md`](CLAUDE.md) — the rules

## How to work here

**One thing at a time.** Take the next item, finish it, show the diff, stop. Do not scaffold a whole
layer at once.

**Vertical slices, never horizontal layers.** Build search→play end to end, then add depth. Not "all
the endpoints" followed by "all the UI".

**Verify before claiming done.** Run typecheck, lint and tests. If something fails, say so with the
output. Never report a task complete on the strength of the code looking right. If a change is visible
in a browser, look at it in a browser.

**Prefer deleting.** A control that does nothing, a config with no consumer, a second way to do the
same thing — remove it rather than documenting around it.

## Things that will waste your day

- **The `/api` rewrite must precede Next's catch-all** in `vercel.json`. If it does not, the site
  renders perfectly and every API call 404s. `vercel build` shows the real route order locally.
- **The API is serverless.** Instances freeze after responding and share no memory. Background timers,
  polling loops and in-process locks silently do nothing in production. Reconcile on read instead.
- **One lockfile, at the root.** Vercel resolves function dependencies from the repo root. A
  per-app lockfile lets a package work locally and be missing in production.
- **Range requests.** `206` must survive. It is the one bug that looks like success.
- **`NEXT_PUBLIC_*` is public.** Anything with that prefix is inlined into JavaScript the world can
  read.
- **Convex Auth owns the `users` table.** Listener data lives in `profiles`.

## Costs real money

`workers/` and `infra/aws/` drive GPU jobs. Never deploy a stack, push an image, or submit a job
unless you were explicitly asked to. Dev capacity is capped at one GPU (`MaxvCpus=4`) on purpose.

## Testing style

Tests state a behaviour, not a method name: *"20 simultaneous requests across separate instances
create ONE Batch job"*. Each seam has a fake, which is why the suite needs no network and no cloud
account. Prove security properties with real primitives — the token tests sign with generated RSA
keys rather than asserting on a mock.
