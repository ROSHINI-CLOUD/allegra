# Mobile UX follow-ups: implementation plan

Status: draft for owner review, 2026-11-15. Nothing in this plan is built yet.
Builds on commit `3ed19845` (branch `fix/mobile-ux-audit`), which already fixed plain error copy,
singular counts, steady Library tabs, the lyrics-editor discard prompt and four small targets.
Scope: `apps/mobile` only, plus the planning and release-note files named below.

## 0. Rules for the implementing agent

Read first, in this order:
1. `CLAUDE.md` (repo root), `apps/mobile/CLAUDE.md`, `apps/mobile/DESIGN.md` (sections 3, 7a, 9, 10, 11),
   `apps/mobile/src/ui/AGENTS.md`.
2. `.planning/mobile-ui-review/IMPLEMENTATION-STATUS.md` (line 77 lists the device checks still open).
3. This file, then `ROADMAP.md`, then the phase plan you are executing.

Non-negotiable:
- Tests first where behaviour is testable: one commit with the failing test, one with the code.
- One commit per task. Conventional commits (`fix(mobile): ...`). **No AI attribution footer** (repo rule).
- Never edit by script (python, sed, node one-liners). Use the Edit tool. A hung `python3` heredoc cost
  five minutes in the last session.
- Every press goes through `Tactile` / `TactileRow` or a `src/ui` component. No bare `Pressable`.
  `src/designGuards.test.ts` ratchets this.
- Targets are at least 48dp (`Control.target`). A smaller visual needs `hitSlop` that reaches 48.
  Two zones that touch must not overlap: the gap between them is at least twice the slop.
- No raw `error.message` shown to a listener. Use `plainErrorMessage` from `src/utils/plainError.ts`.
- Counts use `countOf(n, 'song')` from `src/utils/formatters.ts`. Never `${n} songs`.
- Sentence case, no trailing period on one-line labels, no exclamation marks, no emoji.
- Never change font weight or size on selection. Reserve space for any indicator.
- Animate `transform` and `opacity` only; durations from `Motion` tokens.
- Stop and report when the code disagrees with this plan. Write what you found into the plan's
  `SUMMARY.md` and stop. Do not improvise.

Do not touch (other work owns them): `StreamScreen.tsx`, `StreamUpdatesDropdown.tsx`, `V6TabBar.tsx`,
`UpdatePanel.tsx`, `appUpdate*`, `update-history` tooling and release workflows, `MiniPlayer.tsx`,
`miniPlayerSurface*`, `usePlayerSheetMotion*`, `CoverGhost*`, `ConnectDropdown.tsx` and their motion tests.
Phase 5 is the only phase that edits `StreamScreen.tsx` and `UpdatePanel.tsx`, and only after the gate in
its plan passes.

## 1. What we are building

A second pass over the phone app's usability gaps. The first pass fixed what was cheap and certain. What is
left falls in four groups.

1. A search that fails looks the same as a search that finds nothing, so a listener on a bad connection is
   told to "try another spelling".
2. Several controls are smaller than 48dp with too little slop, or sit so close that their slop would overlap.
3. Text that does not scale: containers with a fixed `height` around `Text` can clip at 200% text. This group
   is not yet measured. Phase 3 measures it before anything is changed.
4. Owner-locked files still carry one wrong plural and two raw error messages, and the work is not yet
   shipped: no version bump, no listener-facing release note, no device evidence.

## 2. Decision log

| # | Decision | Why |
|---|---|---|
| D1 | Search gets a real `failed` state, shown only when there are no fresh results. Copy: "Could not reach the catalog. Check your connection and try again." plus a "Try again" text button. | The catch at `SearchScreen.tsx:265-268` already knows it failed, but the flag lives in a ref used only for tracing (`onlineSearchFailed`, line 149). |
| D2 | The "no results" copy loses its "or check your connection" tail: "Nothing streamable for that. Try the artist name or another spelling." | With a failed state the tail is wrong half the time. |
| D3 | The status rules are a pure function in `screens/searchStatus.ts`, tested on its own. | The screen has no test seam; the project's pattern (`libraryCollections.ts`) is a pure sibling file. |
| D4 | Failed searches are never cached. | `onlineAnswers.set` runs only when `found.length > 0` (line 272); keep it so. |
| D5 | The Library has no first-load empty-state flash. Verified: `App.tsx` awaits the song preload before `isReady` (`App.tsx:92`, `:150`). No loading task is planned. | An earlier suspicion; checked and dropped. |
| D6 | Small controls keep their visual size and gain `hitSlop`, as `ui/Chip.tsx:65-67` does (36 visual, `(48 - 36) / 2` vertical slop). | Changing visuals is a design change; slop is not. |
| D7 | Where two small controls stack with a gap under 12dp, raise the gap to `Space.sm` (12) instead of dropping slop. | Slop zones that overlap steal each other's taps. 12 = 2 x 6. |
| D8 | A hit-target guard test ratchets small pressables. Its baseline records today's offenders; the list may only shrink. | Same mechanism as `designGuards.baseline.json`, so reviewers already know it. |
| D9 | Text-scale work is audit first, fix second, capped at 6 fixes. | The scope is unmeasured. An uncapped "fix all" is how redesigns sneak in. |
| D10 | The version bump (1.66.0 to 1.66.1, patch) and the release note go in the last task, after a fresh `git fetch` and a re-read of `app.json`. | Other branches also bump. A stale number loses the race silently. |
| D11 | Device checks are a `checkpoint:human-verify`. CI evidence is never recorded as device evidence. | `apps/mobile/CLAUDE.md`: "Do not claim physical checks from CI". |
| D12 | `plainErrorMessage` stays the only error-to-copy helper. Phase 1 adds tests for every message `services/feedback.ts` throws, so none of them gets swallowed. | The helper rejects text that looks technical. Authored messages must keep passing. |

## 3. Vocabulary

| Term | Meaning | Code name |
|---|---|---|
| Fresh results | Online results not already downloaded | `onlineFresh` (`SearchScreen.tsx`) |
| Slop | Invisible extra touch area | `hitSlop` |
| Target | The touchable area a thumb can hit, at least 48dp | `Control.target` |
| Owner-locked | A file another change is editing | list in section 0 |

## 4. The model

Search status, one function, no other input:

```ts
export type OnlineStatus = 'idle' | 'busy' | 'failed' | 'empty' | 'results';
export interface OnlineStatusInput {
  busy: boolean;                    // a request is in flight
  online: readonly unknown[] | null; // null = no query yet or scoped to the phone
  fresh: number;                    // onlineFresh.length
  failed: boolean;                  // the last request threw
}
export function onlineStatus(i: OnlineStatusInput): OnlineStatus;
```

Rules, in this order (first match wins):

| # | Condition | Result |
|---|---|---|
| 1 | `fresh > 0` | `results` |
| 2 | `busy` | `busy` |
| 3 | `failed` | `failed` |
| 4 | `online === null` | `idle` |
| 5 | otherwise | `empty` |

Hit-target guard rule (D8): in a `.tsx` file, a JSX element named `Tactile`, `Pressable` or
`TouchableOpacity` that has an `onPress` attribute and a `style` attribute naming `styles.X`, where the
same file's `StyleSheet.create` defines `X` with a numeric-literal `width` or `height` below 48 and no
`minHeight` / `minWidth` of 48 or more, and the element has no `hitSlop` attribute, counts as one offender.
Files under `src/ui/` are skipped. Non-literal values (tokens) are ignored.

## 5. Facts checked in the code

| Fact | Where |
|---|---|
| Tests run by Jest glob `**/?(*.)+(spec\|test).+(ts\|tsx)`; no registration needed. | `apps/mobile/jest.config.js:7` |
| Root gate for mobile is `npm run mobile:check`, which runs `npm --prefix apps/mobile run ci`. | `package.json:26` |
| `ci` = check-secrets, lint, typecheck, `jest --ci --runInBand --coverage`. | `apps/mobile/package.json` scripts |
| Release-note test: `npm run infra:test` (includes `tests/infra/mobile-release-notes.test.mjs`). | `package.json:15` |
| Typecheck runs out of memory at Node's default heap on this machine. Use `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit`. | seen 2026-11-15 |
| `npm ci` in `apps/mobile` fails in the `llama.rn` postinstall (Git-bash `tar` cannot read a `C:` path). Use `npm ci --ignore-scripts`; Jest and `tsc` do not need the native files. | seen 2026-11-15 |
| Catalog search catch: `searchOfficial(...).catch(() => { failed = true; return []; })`. | `SearchScreen.tsx:265-268` |
| Only successful non-empty answers are cached. | `SearchScreen.tsx:272` |
| Failure flag is a ref used for tracing only. | `SearchScreen.tsx:149, 180, 274, 311` |
| Current empty copy. | `SearchScreen.tsx:544-546` |
| Search effect dependency list is `[q, scope]`. | `SearchScreen.tsx:289` |
| `Chip` pattern: 36 visual, vertical slop 6. | `ui/Chip.tsx:65-67` |
| `Space`: xxs 4, xs 8, sm 12, md 16, lg 24, xl 32, xxl 48. `Control.target` is 48. | `constants/allegraTheme.ts:40-41, 175-183` |
| InfoTour trigger is 26 with `hitSlop={10}` (46 total). Step dots are 22x28 with `hitSlop={6}` (34x40). | `InfoTour.tsx:285, 303, 226, 261` |
| Now Playing header chips are `height: 30`, no slop; wrapper has `marginTop: 6`. | `NowPlayingHeader.tsx:75, 74, 54, 60` |
| Blend filter chips are `height: 36`, no slop, `gap: Space.xs`. | `BlendScreen.tsx:298-299, 237` |
| `PrimaryButton` / `GlassButton` `compact` is `height: 36`; used only by `StreamScreen`. | `allegra/home.tsx:123`, grep |
| `UpdatePanel` shows `e.message` at lines 127 and 223. `StreamScreen.tsx:432` prints `${mix.songs.length} songs`. | grep |
| `uxAudit.test.ts` has `PLURAL_ALLOWED = new Set(['screens/StreamScreen.tsx'])`. | `src/uxAudit.test.ts` |
| Version is 1.66.0; the APK workflow's paths include `apps/mobile/**`. | `app.json:5`, `.github/workflows/mobile-apk.yml:13` |

## 6. Tasks (phase summaries; details in each plan file)

| Phase | Plan | What |
|---|---|---|
| 1 Search and copy | `phases/01-search-and-copy/01-01-PLAN.md` | `onlineStatus`, failed-search state with retry, error-copy test for feedback messages, `AboutSheet` uses the helper |
| 2 Touch targets | `phases/02-touch-targets/02-01-PLAN.md` | slop for InfoTour, header chips, Blend chips; hit-target guard with baseline |
| 3 Text scale | `phases/03-text-scale/03-01-PLAN.md` | audit fixed-height text containers, write findings, fix at most six |
| 4 Release and device | `phases/04-release-and-device/04-01-PLAN.md` | version bump, listener release note, device checklist, evidence record |
| 5 Owner-locked files | `phases/05-owner-locked/05-01-PLAN.md` | `StreamScreen` plural, `UpdatePanel` messages, `home.tsx` compact slop; gated on the other change merging |

## 7. Cost and limits

No network calls, no new dependencies, no data stored. The audit in phase 3 is read-only grep. The
hit-target guard reads about 200 source files with the TypeScript parser, as `accessibilityNames.test.ts`
does (about 14 s on this machine; the guard must stay under 20 s).

## 8. Edge cases

- Search typed fast: a newer query must clear `failed` (`setOnlineFailed(false)` at the top of the effect).
- Search scoped to "On this phone": status is `idle`; never `failed`.
- A failed search with local results: local list shows as before; the Online section shows the failed line.
- A retry while a request is in flight: the effect cleanup aborts the old controller; the counter bump
  triggers one new request.
- Offline with a cached exact answer: `known.exact` returns early (line 254); no failed state.

## 9. Copy

| Where | Text |
|---|---|
| Search, failed | Could not reach the catalog. Check your connection and try again. |
| Search, failed button | Try again |
| Search, empty | Nothing streamable for that. Try the artist name or another spelling. |
| Release note, Improved | Search tells you when the catalog cannot be reached, with a Try again button |
| Release note, Improved | Errors say what happened in plain words |
| Release note, Improved | Counts read correctly, like “1 song” |
| Release note, Improved | Library tabs stay put when you pick one |
| Release note, Improved | The lyrics editor asks before it throws away your edits |
| Release note, Improved | Small buttons are easier to tap |

## 10. Verification per phase

Global gate, run from `apps/mobile` after every phase:
```
NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit
NODE_OPTIONS=--max-old-space-size=8192 node node_modules/eslint/bin/eslint.js <changed files>
NODE_OPTIONS=--max-old-space-size=8192 node node_modules/jest/bin/jest.js
```
Expected: no tsc output; no eslint errors (warnings in untouched code are fine); `Test Suites: N passed`.
Phase 4 also runs `npm run infra:test` from the repo root.

## 11. Out of scope

Redesigns, new screens, new tokens, motion changes, the mini player, Stream's layout, update flow behaviour,
iOS. The `Library` loading state (D5). Recording CI emulator output as device evidence.

## 12. Sources

All facts come from this repository. No third-party service is involved.
