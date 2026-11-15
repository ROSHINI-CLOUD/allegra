# Text scale findings (phase 3, task 1)

Audit of fixed-height containers that wrap text, read against 200% system text. Method: the grep from
`03-01-PLAN.md` on `apps/mobile` (`height` 20 to 149 in `src/screens` and `src/components`), then the JSX that uses
each style. Line numbers are on branch `fix/mobile-ux-audit` after rebasing onto `origin/main` 610c689f.

Filtered out by the skip list (not rows): icons and icon-only buttons, artwork and covers, thumbnails, sliders and
tracks, progress and visualiser bars, dividers, `src/ui/`, and owner-locked files (`StreamScreen`, `StreamUpdatesDropdown`,
`V6TabBar`, `UpdatePanel`, `ConnectDropdown`).

Rule used: `fix` = a row, button, chip or input with a Text child that can wrap or grow and has no `numberOfLines={1}`
on that child. 16 rows matched. The plan's fallback applies: six changes, the six with the most visible screens and the
clearest clipping at 200%; the rest are `deferred`.

| file:line | style | what it wraps | decision | reason |
|---|---|---|---|---|
| screens/SearchScreen.tsx:684 | header | Search title, 28pt | fix (applied) | 52 fixed; a 28pt title at 200% needs about 68. `height` became `minHeight: 52`. |
| components/NowPlayingHeader.tsx:75 | chip | "Listening together · n" label, 13pt, no `numberOfLines` | fix (applied) | 30 fixed; 13pt at 200% needs about 32. `height` became `minHeight: 30`. |
| components/player/LyricsPicker.tsx:116 | badge | match-kind label, 12pt | fix (applied) | 22 fixed; 12pt at 200% needs about 26. `height` became `minHeight: 22`. |
| components/NowPlayingControls.tsx:673 | segment | container of the output and sleep-timer cells, `overflow: hidden` | fix (applied) | 44 fixed; a grown cell would be clipped by a fixed container. `height` became `minHeight: 44`. |
| components/NowPlayingControls.tsx:674 | segmentHalf | sleep-timer cell with its label | fix (applied) | 44 fixed; the label grows. `height` became `minHeight: 44`. |
| components/player/PlayerExtras.tsx:103 | action | action label, 15pt, under an icon | fix (applied) | 48 fixed; the label can wrap at 200%. `height` became `minHeight: 48`. |
| components/player/PlayerExtras.tsx:110 | reset | "Reset", 15pt | deferred | Same as `action`. Over the six-change cap. |
| components/stream/AddListSheet.tsx:226 | primary | "Find songs" / "Save n", 15pt | deferred | 44 fixed; visible on Stream and Search. Over the cap. |
| components/stream/AddListSheet.tsx:228 | secondary | "Edit list" / "Playlist", 14pt | deferred | 44 fixed. Over the cap. |
| components/allegra/InfoTour.tsx:308 | done | "Got it", 15pt | deferred | `minWidth: 96`, height 44. Over the cap. |
| components/blend/BlendStoryPlayer.tsx:313 | playSmall | "Play", 15pt | deferred | 44 fixed. Over the cap. |
| components/connect/ConnectRemotePlayer.tsx:496 | waitingAction | "Choose a device", 15pt | deferred | 44 fixed. Over the cap. |
| components/blend/BlendStage.tsx:253 | skip | "Skip", text beside an icon | deferred | 36 fixed. Over the cap. |
| screens/BlendScreen.tsx:299 | chip | Blend member filter label | deferred | 36 fixed. Phase 2 edited this chip (hit slop and row gap). Over the cap. |
| screens/LyricsEditorScreen.tsx:436 | save | "Save" | deferred | `minWidth: 76`, height 40. Over the cap. |
| components/allegra/home.tsx:123 | btnCompact | compact button label | deferred to phase 5 | 36 fixed. Used only by `StreamScreen` (owner-locked). |
| screens/LuvsScreen.tsx:532 | hint | hint text with a fixed `lineHeight: 46` | device | May wrap at 200% and clip. |
| screens/PlaylistDetailScreen.tsx:660 | findBar | "Find in playlist" text input, 40 | device | Text input height at 200%. |
| components/AddToPlaylistModal.tsx:309 | searchBar | text input, 44 | device | Text input height at 200%. |
| components/PlaylistSelectionModal.tsx:148 | searchBar | text input, 44 | device | Text input height at 200%. |
| components/connect/ConnectDeviceSheet.tsx:199 | renameInput | text input, 44 | device | Text input height at 200%. |
| components/stream/NativeTrackRow.tsx:97 | row | native track row, 64; title and artist | device | Native layout; two lines at 200% may exceed 64. |
| components/import/SpotifyCrate.tsx:141 | count | digits in a 20-high badge | device | Digits at 200%. |
| components/blend/BlendStage.tsx:249 | inviteWrap | "Send invite" control, 44, absolutely placed | device | Position and text unclear from the source. |
| components/allegra/infoTours.tsx:375, 380, 387 | row, pill, search | sample text inside tour illustrations | skip | Decorative tour art, not reader text. |
| components/luvLink/LuvLinkPanel.tsx:197 | avatar | one initial letter in a 36 circle | skip | A single letter fits at 200%. |
| screens/ArtistScreen.tsx:191 | follow | none | skip | No JSX uses this style. |

Counts: fix 6 (applied), deferred 10, device 8, skip 3.

## Device checklist additions (phase 4 task 2)

On the phone at 200% text, check the six applied boxes (search title, Now Playing chips, lyric match badge, timer cell,
player action buttons) and whether the deferred buttons (Find songs, Save, Got it, Play, Choose a device, Skip, Reset)
clip. Check the eight device rows above.
