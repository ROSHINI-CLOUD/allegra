# Milestone: Mobile UX follow-ups

Spec: `PLAN.md`. No `REQUIREMENTS.md` or `STATE.md` (Medium depth); track progress in the table below.

## How to execute a plan

1. Read `PLAN.md` fully, then the plan file.
2. Read every `read_first` file before editing. Line numbers drift; names do not.
3. Do tasks in order. After each, run its `verify` and check every acceptance line.
4. If the code contradicts the plan, write it in `NN-MM-SUMMARY.md` and stop.
5. One commit per task. Conventional commit, no attribution footer.
6. Write `NN-MM-SUMMARY.md` (what changed, commands run, results, anything skipped and why).
7. Tick the row below.

Global gates (from `apps/mobile`, see `PLAN.md` section 10): `tsc`, `eslint` on changed files, full `jest`.
Registration: none. Jest finds any `*.test.ts(x)` under `apps/mobile`.

## Phases

| # | Phase | Goal | Depends on | Status |
|---|---|---|---|---|
| 1 | Search and copy | A failed search says so and can retry; feedback errors keep passing the helper | none | [ ] |
| 2 | Touch targets | Every small control reaches 48dp; a guard keeps it that way | none | [ ] |
| 3 | Text scale | Fixed-height text containers are measured; up to six are fixed | none | [ ] |
| 4 | Release and device | Version, listener note, device evidence | 1, 2, 3 | [ ] |
| 5 | Owner-locked files | Last wrong plural and two raw messages gone | other change merged | [ ] |

Phases 1, 2 and 3 touch different files and can run in parallel (wave 1). Phase 4 runs after them
(wave 2). Phase 5 waits for the owners' change and may run before or after phase 4; if after, it needs
a second bump (see its plan).

### Phase 01: Search and copy
Plans:
- [ ] 01-01 Failed search state (wave 1)

Success criteria:
1. `searchStatus.test.ts` covers all five rules and passes.
2. With the catalog request failing, the Online section shows the failed copy and a "Try again" button.
3. With a successful empty answer, the Online section shows the empty copy and no button.
4. `grep -rn "e.message" apps/mobile/src/components/about/AboutSheet.tsx` finds nothing.

### Phase 02: Touch targets
Plans:
- [ ] 02-01 Slop and guard (wave 1)

Success criteria:
1. InfoTour trigger and step dots, Now Playing header chips and Blend chips are each 48dp including slop.
2. `hitTargets.test.ts` passes with a baseline that lists only files this plan could not fix.
3. Adding a 30dp `Tactile` with no slop to any non-`ui` file makes the guard fail (proved in the test).

### Phase 03: Text scale
Plans:
- [ ] 03-01 Audit and capped fixes (wave 1)

Success criteria:
1. `TEXT-SCALE-FINDINGS.md` lists every candidate with file, line, decision and reason.
2. At most six `height` values became `minHeight`; none changes layout at 100% text.
3. Remaining candidates are named in the device checklist.

### Phase 04: Release and device
Plans:
- [ ] 04-01 Bump, note, device checks (wave 2)

Success criteria:
1. `apps/mobile/app.json` version is one patch above `origin/main`'s.
2. `update-history.json` has the new entry first and at most four entries; `npm run infra:test` passes.
3. A person has run the checklist on a phone and the result is in `IMPLEMENTATION-STATUS.md`.

### Phase 05: Owner-locked files
Plans:
- [ ] 05-01 Stream and update panel leftovers (wave 3, gated)

Success criteria:
1. `uxAudit.test.ts` has no `PLURAL_ALLOWED` exception and passes.
2. `grep -n "e.message\|error.message" apps/mobile/src/components/about/UpdatePanel.tsx` finds nothing
   that reaches `setNotice` or `setStatus`.
