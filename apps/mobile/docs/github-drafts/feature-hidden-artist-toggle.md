# [Feature]: Toggle Home recents into current artist songs from the LuvLyrics header

## Problem statement

The Home screen's top recent-song strip only shows recently played songs. When a listener wants to stay inside the artist they are currently hearing, there is no quick way to pivot that strip into "more from this artist" without searching manually or scrolling the full library.

## Proposed solution

Add a hidden interaction on the `LuvLyrics` header text in Home. A tap toggles the top slider between:

- the default recent listens strip
- a current-artist strip built from downloaded songs by the artist of the currently playing track

When artist mode is active:

- the currently playing song appears first
- remaining songs are filled from the same artist in newest-download order
- if the artist has fewer than the normal strip size, show only those songs
- if the artist has more songs, cap the strip at the latest 20 downloaded songs

A second tap on `LuvLyrics` returns the strip to normal recents.

## Acceptance criteria

- Tapping `LuvLyrics` on Home toggles the top horizontal song strip.
- Default mode continues to show the latest 16 recently played songs.
- Artist mode shows the currently playing song first.
- Artist mode only includes downloaded/local songs from the same artist.
- If the current artist has fewer than 16 songs, only those songs are shown.
- If the current artist has more than 16 songs, the strip shows at most 20 songs total.
- Tapping `LuvLyrics` again restores the normal recent listens strip.
- If nothing is currently playing, the app stays in recent mode and shows a lightweight hint.

## Suggested difficulty

medium

## Related files/links

- `src/screens/LibraryScreen.tsx`
- `src/components/RecentlyPlayedGrid.tsx`
- `src/store/playerStore.ts`
- `src/store/songsStore.ts`
