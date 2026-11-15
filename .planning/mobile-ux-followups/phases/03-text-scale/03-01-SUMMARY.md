# 03-01 summary: text scale

Done.

- `TEXT-SCALE-FINDINGS.md` lists 27 candidates with file, line, style, decision and reason. Counts: fix 6 (applied),
  deferred 10, device 8, skip 3. The filtered icons, artwork, sliders, dividers and owner-locked files are not rows.
- Six `height` values became `minHeight` with the same number, one line each: Search header 52, Now Playing chip 30,
  lyric match badge 22, Now Playing timer strip 44 and timer cell 44, player action 48. At 100% text nothing moves.
- Six source guards in `uxAudit.test.ts`, one per changed style. Before the change, the regex check found `minHeight`
  absent and `height` present in all six (the check ran against the HEAD copies). After it, the nine audit tests pass.

Deviations:

- The plan says to stop when more than 12 rows match the fix rule. Sixteen matched, so the plan's fallback applies: the six
  with the most visible screens and the clearest clipping at 200% are fixed, and the other ten are `deferred`.
- The findings file records rows by line numbers on the rebased tree, so they match the code this PR ships.

Pending (device):

- The device checklist additions in the findings file: check the six fixed boxes at 200% text, the deferred buttons, and
  the eight device rows.
