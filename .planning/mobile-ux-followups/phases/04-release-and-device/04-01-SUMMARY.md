# 04-01 summary: release and device

Task 1 done. Task 2 (device evidence) is pending a person and the phone.

- Version: `expo.version` 1.67.0 to 1.67.1. The plan said 1.66.0 to 1.66.1, but `origin/main` had moved to 1.67.0 (PR #135)
  before this branch rebased, so the bump is one patch above main's current version, as the plan's rule requires.
- Listener note: a new first entry, 1.67.1. The plan's copy repeated four items that already shipped in 1.67.0 (plain
  errors, counts, steady Library tabs, the lyrics-editor prompt), so the new entry lists only what this release adds.
  The oldest entry, 1.64.5, drops off, which keeps the four-entry limit.
- `npm run infra:test` from the repo root: 25 of 25 pass.

Pending (task 2, a person with the phone):

- The device checklist in the plan: the lyrics editor discard sheet with TalkBack, the search clear button, the Library
  at 200% text on a 360dp phone, the download failure line at 200%, the LuvLink error copy, the search failure line with
  Try again, and the device rows in the text-scale findings.
- The status record in `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md` is not written. It needs a real phone run.
  CI results are not device evidence.
