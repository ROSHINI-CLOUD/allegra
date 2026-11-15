# Starter prompt: mobile UX follow-ups

Paste everything below the line into a new agent session opened in the Allegra repo.

---

You are implementing a finished, reviewed plan. Your job is to execute it exactly, prove each step
with commands, and report honestly. You are not here to redesign anything.

## Where things are

- Repo: Allegra monorepo. Work only in `apps/mobile`, plus the planning and release files the plan names.
- Plan folder: `.planning/mobile-ux-followups/`
  - `PLAN.md` (rules, decisions, facts), `ROADMAP.md` (phases and order)
  - `phases/01-search-and-copy/01-01-PLAN.md`
  - `phases/02-touch-targets/02-01-PLAN.md`
  - `phases/03-text-scale/03-01-PLAN.md`
  - `phases/04-release-and-device/04-01-PLAN.md`
  - `phases/05-owner-locked/05-01-PLAN.md` (gated; do not start it unless told the gate passed)
- Earlier work you build on: commit `3ed19845` on branch `fix/mobile-ux-audit`
  (`src/utils/plainError.ts`, `src/uxAudit.test.ts`, `src/utils/lyricsEditing.ts`).

## Setup (do this first, in order)

1. Work in your own isolated checkout. Do not touch `C:\dev\allegra` (it is dirty and belongs to someone else).
2. `git fetch origin`, then check out `fix/mobile-ux-audit`. If it is missing, create it from `origin/main`
   and cherry-pick `3ed19845`. Confirm with `git log --oneline -3` that `3ed19845` is in history.
3. Read, fully, in this order: root `CLAUDE.md`, `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md`
   (sections 3, 7a, 9, 10, 11), `apps/mobile/src/ui/AGENTS.md`, `.planning/mobile-ux-followups/PLAN.md`,
   `ROADMAP.md`.
4. Install: `cd apps/mobile && npm ci --ignore-scripts` (plain `npm ci` fails on this Windows machine
   in the `llama.rn` postinstall). It takes about ten minutes; run it in the background and read the plan
   meanwhile.
5. Baseline before you change anything. From `apps/mobile`:
   - `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit` (no output = pass)
   - `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/jest/bin/jest.js > <scratch>/jest-baseline.log 2>&1`
     (expect 217 suites, 1710 tests, all passing; read the `Tests:` line from the log file)
   If the baseline is not green, stop and report. Do not fix unrelated failures.

Run long commands (full jest, install) in the background writing to a log file, then read the log.
Do not pipe them through `tail` or `head`; output can stay empty until the process ends.

## How to execute

- Order: phases 1, 2 and 3 first (any order, they touch different files), then phase 4. Skip phase 5.
- For each phase plan: read its whole file, then every `read_first` file named in a task, before editing.
  Line numbers in the plan drift. Names do not. Find things by name.
- Tasks in order. For a task marked `tdd`: commit the failing test first and run it to see it fail for the
  right reason, then commit the code. One commit per task. Conventional commits, for example
  `fix(mobile): show a failed search state with retry`. **No AI attribution footer, no Co-Authored-By.**
- After each task run its `<verify>` command and check every line under `<acceptance_criteria>` with `grep`.
  A criterion you did not check is not met.
- Edit with the Edit tool only. Never rewrite source with python, sed or node one-liners.
- Use only existing tokens (`Space`, `Control`, `Signal`, `Motion`). No raw colors, sizes or durations
  in screens. No bare `Pressable` outside `src/ui` and `components/allegra`.
- Do not touch these files: `StreamScreen.tsx`, `StreamUpdatesDropdown.tsx`, `V6TabBar.tsx`,
  `UpdatePanel.tsx`, anything named `appUpdate*`, update-history tooling, release workflows, `MiniPlayer.tsx`,
  `miniPlayerSurface*`, `usePlayerSheetMotion*`, `CoverGhost*`, `ConnectDropdown.tsx`. Their owners have
  pending edits.
- Do not push, open a PR or merge. Do not bump the version except in phase 4, task 1.

## When the plan and the code disagree

If a name, line, string or file is not as the plan says, or a criterion cannot be met without changing
something outside the plan: stop that task. Write what you found (file, line, the plan's claim, the real
state) into that phase's `NN-MM-SUMMARY.md` and report it. Do not improvise a different fix and do not
loosen a test or helper to make it pass (for example, never weaken `plainErrorMessage` so a message passes).

## Checkpoints

Tasks of type `checkpoint:human-verify` need a person with a phone. You cannot do them. Prepare
everything, state exactly what the person must check (copy the steps from the plan), and stop there.
Never record CI or jest results as device evidence.

## Quality bar

- Read your own diff before each commit. It must contain only what the task names.
- Visual sizes do not change in phase 2; only touch areas do. If something looks different at rest,
  you changed too much.
- Copy is plain, short English. Sentence case, no trailing period on one-line labels, no exclamation marks.
- Numbers you write into tests come from the real code, not memory. Re-read the source string first.
- A test must fail before the fix and pass after. Show both runs in the summary.

## Finish

After phases 1-3 and phase 4 task 1, run the full gate from `apps/mobile`:
`tsc`, `eslint` on changed files (`node node_modules/eslint/bin/eslint.js <files>`; warnings in untouched
code are fine, errors are not), full `jest`, and from the repo root `npm run infra:test`.

Final report, in this shape:
1. Branch, and every commit SHA with its subject.
2. Files changed (grouped by phase).
3. Per phase: what is done, the acceptance lines you checked, anything skipped and why.
4. Command results with the real counts (suites, tests, tsc output, eslint errors).
5. Deviations from the plan, and anything you stopped on.
6. What is waiting on a person: the phase 2 visual check, the phase 4 device checklist, the phase 5 gate.

Be exact. If something is not done or not verified, say so plainly.
