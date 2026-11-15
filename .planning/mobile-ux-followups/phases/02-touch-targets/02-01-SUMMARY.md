# 02-01 summary: touch targets

Done, except the device checkpoint.

- Info tour: the "i" trigger has `hitSlop` 11 (26 + 22 = 48). Step dots are 24 wide and 28 tall, with vertical slop 10
  (48 tall). The Previous and Next round buttons got `hitSlop` 2 (44 + 4 = 48), so InfoTour is not in the baseline.
- Now Playing header chips: `hitSlop` 9 top and bottom, and `chipWrap` `marginTop` 6 to 18, so two stacked chips keep
  their slop zones from overlapping.
- Blend filter chips: `hitSlop` 6 top and bottom, and `rowGap` 12 on the row.
- `hitTargets.test.ts`: the detector, two self-tests (a 30dp pressable with no slop counts one; with `hitSlop` counts
  none), and a ratchet against `hitTargets.baseline.json`. The baseline lists five files, 13 offenders, copied from the
  red run's output.
- The info card's cross closes the card: the corner placement moved onto the touch wrapper (`closeWrap`). It has its own
  guard, `InfoTour.test.ts`, which fails on the old code.

Deviations, for the device checkpoint:

- The plan's must-have says 48 wide including slop. The step dots are 24 wide, following the plan's WCAG 2.2 decision,
  and no slop can make them 48 wide without overlapping the next dot.
- Changing `marginTop` 6 to 18 moves the header chip stack 12pt at rest. The plan calls for it, to keep the slop zones
  from overlapping. The quality bar says visuals should not move in this phase, so this needs a look on the phone.

Pending (human):

- The phase 2 device checkpoint. Open the "i" on a tour and tap just outside the small circle. Tap beside a step dot and
  check it moves one step. Check the gap above the second header chip with Listen together or Connect showing. Tap
  between two Blend filter chips in the same row and in different rows.
- The info card's cross, on the phone: it closes the card; tapping the card's text does not close it; tapping outside
  closes it.
