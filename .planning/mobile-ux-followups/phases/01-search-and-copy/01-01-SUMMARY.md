# 01-01 summary: search and copy

Done.

- `screens/searchStatus.ts` holds the five-rule `onlineStatus`. `searchStatus.test.ts` has 8 cases.
- `SearchScreen.tsx` shows a failed line with a Try again button when the catalog request threw, and the empty line
  (without the connection tail) when a request answered with nothing. Retry bumps a counter in the effect's deps.
- `AboutSheet.tsx` sends its send error through `plainErrorMessage`. `plainError.test.ts` pins the three
  `services/feedback.ts` strings and the two `feedbackDraft` rule messages, and has a source guard for the AboutSheet path.

Deviations:

- The plan's `failed` style alone would have put the Try again button at the screen edge: `TextButton` has no side
  padding. A `retry` wrapper with the gutter padding lines it up with the copy.
- The AboutSheet source guard is an addition to the plan's behaviour test. The behaviour test passes before the change
  (the helper already keeps those strings); the guard is the test that fails first.

Commands and results:

- `searchStatus.test.ts`: red before the module existed (`Cannot find module './searchStatus'`), then 8 passed.
- `plainError.test.ts`: before the AboutSheet change, 1 failed and 9 passed; after, all 10 pass.
- `tsc --noEmit`: no output after each task.
- `designGuards`, `accessibilityNames`, `feedback` suites: pass.
