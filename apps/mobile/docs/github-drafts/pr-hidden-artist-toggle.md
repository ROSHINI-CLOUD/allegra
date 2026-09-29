## Pre-flight check

> **PRs without a linked issue will be closed without review.**
> Open or find an issue first, then come back here.

- [x] I have opened or referenced an existing issue that tracks this work (required)

## Related Issue

Closes #<issue-number>

## Summary

Add a hidden Home-header interaction that toggles the recent-song strip into a current-artist strip sourced from downloaded songs in the local library.

## Type of Change

- [ ] Bug fix
- [x] New feature
- [ ] Refactor
- [ ] Documentation update
- [ ] Test improvement

## What Changed

- Made the `LuvLyrics` title in the Home header act as a hidden toggle for the top slider.
- Kept normal recents capped at 16 songs.
- Added artist mode that pins the currently playing song first and fills the slider with downloaded songs from the same artist, capped at 20.
- Added a lightweight fallback hint when the hidden interaction is used without an active current song.
- Added issue and PR draft artifacts for maintainers.

## Testing

- [ ] `npm run lint`
- [x] Manual testing completed
- [ ] Relevant test cases added/updated (if applicable)

Describe how you tested this change:

- Verified the recently played strip logic compiles with the new mode switching.
- Verified the Home screen header tap target toggles the strip source.
- Ran `npm run typecheck`.

## Screenshots / Recordings (if UI change)

Add screenshots or short recordings here.

## Checklist

- [x] I kept this PR focused (no unrelated large changes)
- [x] I followed existing code style and project structure
- [ ] I updated docs where needed
- [x] I did not commit secrets or sensitive credentials
