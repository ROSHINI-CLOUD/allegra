# LuvLyrics — Project Reference

Read [the current codebase map](../../docs/current-codebase.md) and [CLAUDE.md](CLAUDE.md) first.
The current Android queue and play state are owned by Kotlin Media3. The player lifecycle and
verification rules in CLAUDE.md govern changes here.

## Commit style
- Keep the configured project author identity. Do not add tool-origin notes, co-author lines, or
  authorship disclosures to commit metadata, PRs, source, or documentation.
- Use conventional commits: `fix(scope):`, `feat(scope):`, `refactor(scope):`, etc.
- Keep messages short — one imperative sentence, body only when the why needs explaining.

## Stack and playback

- Expo / React Native, Kotlin Media3, SQLite, Zustand and React Navigation. Use the local npm
  lockfile for Expo and native dependency versions.
- Android's Kotlin service owns the queue and confirmed play state. The JS store mirrors
  it and routes commands. Expo audio fallback uses its own play-state and auto-next rules.
- Preserve the shared audio load guard, current-song check, and Connect/LuvLink routing.
  Use the [player rules](CLAUDE.md#key-architecture) for seek and in-flight operations.
- Use [DESIGN.md](DESIGN.md) and [the UI rules](src/ui/AGENTS.md) for component ownership.

## File map

| Area | Files |
|------|-------|
| Playback engine | `src/contexts/PlayerContext.tsx`, `src/contexts/playerStatusGuard.ts` |
| Player state | `src/store/playerStore.ts` |
| Main UI | `src/components/MiniPlayer.tsx`, `src/screens/NowPlayingScreen.tsx` |
| Lyrics | `src/components/SynchronizedLyrics.tsx`, `src/components/LyricsLine.tsx` |
| Scrubber | `src/components/TimelineScrubber.tsx` |
| Downloads | `src/services/DownloadManager.ts`, `src/components/BackgroundDownloader.tsx` |
| Stores | `src/store/` — songsStore, playlistStore, settingsStore, downloadQueueStore, etc. |
| Screens | `src/screens/` — Library, NowPlaying, Playlist, Search, Settings, etc. |

## Rules
- No `console.log` in production paths — wrap with `if (__DEV__)` or use `diag`
- No `as any` unless unavoidable (FlashList type shim is the one exception)
- No mock DB in tests — always hit real SQLite
- Don't introduce shadow styles on NowPlayingScreen — intentionally removed for clean look
- `MAX_CONCURRENT` downloads is 2 — don't raise it without testing on low-end Android

## Branch naming
- `fix/<issue-number>-short-description`
- `feat/short-description`

## CI
```
npm run ci
# runs: check-secrets → lint → typecheck → jest --coverage
```
