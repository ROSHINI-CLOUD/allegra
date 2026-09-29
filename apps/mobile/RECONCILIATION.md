# Reconciling the two Compose implementations

Two sessions built the Compose app in parallel on 2026-08-09 and produced
overlapping, incompatible work. Both are now committed; nothing is lost.

| | Branch | Head |
|---|---|---|
| **A — breadth** | `feat/artwork-flow-background` | `cb758ab` |
| **B — depth** | `feat/compose-player-ui` | `0eeb4bd` |

Common ancestor: `b1634af` (the checkpoint of the pre-existing Phase 0/1/2 work).

---

## Verdict

**Take A as the base. Port four things from B onto it. Delete the rest of B's UI.**

A is far ahead on surface coverage — every tab is wired. B is ahead in exactly
four places, three of which are data-correctness bugs that A still has.

---

## Side by side

### A only — keep, B has no equivalent

| Surface | File | Lines |
|---|---|---|
| Home tab (real, not placeholder) | `compose/FeatureScreens.kt` → `HomeScreen` | 1396 total |
| Search tab | `FeatureScreens.kt` → `SearchScreen` | ” |
| Downloader hub | `FeatureScreens.kt` → `DownloaderHubScreen` | ” |
| Spotify hub | `FeatureScreens.kt` → `SpotifyHubScreen` | ” |
| Settings screen | `compose/ComposeSettingsScreen.kt` + `ComposeFeaturePrefs.kt` | 599 |
| **Luvs reel feed** | `compose/luvs/` + `luvs/LuvsReelPlayer.kt` | 1753 |
| Local + Playlists | `compose/LibraryScreens.kt` | 1721 |
| Bottom nav | `compose/ShellBottomNav.kt` | 166 |
| Player | `compose/ComposeMiniPlayer.kt` + `compose/player/` | 1138 |

### B only — port these onto A

| What | Files | Why it must move |
|---|---|---|
| **1. Lyric timestamp fix** | `data/LibraryEntities.kt`, `data/LibraryDatabase.kt`, `data/LegacyLibraryMigrator.kt` | A still has `val timestamp: Int`. The legacy column holds fractional seconds under an INTEGER declaration, so **3421 of 3461 rows** are truncated (`34.86` → `34`) and every synced lyric is up to a second out. B has `Double`, DB v3 + `MIGRATION_2_3`, and `secondsAsDouble`. **Verified fixed on device.** |
| **2. Native-write preservation** | `data/LegacyLibraryMigrator.kt`, `data/LibraryDao.kt` | A's `fullCopy` REPLACE-overwrites Room from legacy, silently reverting every like and play count written natively. B carries `is_liked` / `play_count` / `last_played` forward. |
| **3. Deletion propagation** | `data/LegacyLibraryMigrator.kt`, `data/LibraryDao.kt` | A never prunes, so anything deleted in RN lingers in Room for ever and "legacy is source of truth" is false. B prunes in-transaction by chunked `IN` over a computed difference (`NOT IN` blows SQLite's variable limit at 1052 rows; a chunked `NOT IN` would be wrong). |
| **4. Lyrics engine** | `compose/player/Lyrics.kt`, `compose/player/LyricStage.kt` | A has **no** lyrics renderer or parser at all. B has the full offline pipeline: TTML → internal LRC, `<word:start:end\|…>` rows, enhanced-LRC inline stamps, plain fallback, per-song offset, and a stage rendering plain / line-synced / word-timed with no network dependency. |

Payload/DB versions must move together with 1–3:
`LibraryDatabase.version = 3`, `MIGRATION_2_3`, `PAYLOAD_VERSION = 4`.

### Duplicated — delete B's copy

B's versions of these are superseded by A's more complete ones:

```
compose/LocalHomeScreen.kt        → A: LibraryScreens.LocalLibraryScreen
compose/PlaylistsHomeScreen.kt    → A: LibraryScreens.PlaylistsScreen
compose/SongOptionsSheet.kt       → A: LibraryScreens song detail sheet
compose/CoverFlow.kt              → A: swipeable hero deck in LibraryScreens
compose/LuvTabBar.kt              → A: ShellBottomNav.kt
compose/DownloaderScreen.kt       → A: DownloaderHubScreen
compose/DownloadsScreen.kt        → A: DownloaderHubScreen
compose/player/ClassicPlayerBar.kt→ A: ComposeMiniPlayer.kt
compose/player/PlayerDock.kt      → A: ComposeMiniPlayer.kt
compose/player/PlayerScrubber.kt  → A: player/PlayerTimelineScrubber.kt
compose/player/MarqueeText.kt     → A: player/MarqueeTitle.kt
compose/player/PlayerTokens.kt    → fold the constants A lacks into PlayerChromeDimensions.kt
```

### Judgement call — compare before deciding

`compose/player/ArtworkFlow.kt` (B, 473 lines) vs
`compose/player/ArtworkFlowBackground.kt` + `player/PaletteExtractor.kt` (A, 185 lines).

B ports the RN original completely: the swatch ranking with population
weighting, the **two separate luminance ceilings** (base 0.14 / field 0.48 —
clamping them to one value makes the surface uniformly dim and the blobs stop
reading as separate shapes), the chroma boost, the three anchor paths with their
exact frequencies, and the 1500 ms crossfade that prevents the black flash on
track change. A's is shorter; check whether it carries those caps and the
crossfade before choosing. If unsure, keep B's — the constants are load-bearing
and each one has a comment in the RN source explaining what broke without it.

---

## Merge procedure

```bash
git checkout feat/artwork-flow-background      # A is the base

# 1. Data layer — take B's wholesale, A has no competing changes worth keeping
git checkout feat/compose-player-ui -- \
  android/app/src/main/java/com/lyricflow/app/data/LibraryEntities.kt \
  android/app/src/main/java/com/lyricflow/app/data/LibraryDatabase.kt \
  android/app/src/main/java/com/lyricflow/app/data/LegacyLibraryMigrator.kt

# LibraryDao: A modified it too — merge by hand, keep both sets of queries.
# From B add: allIds(), localState(), deleteSongs(), playlist allIds(),
#             allLinkKeys(), deletePlaylists(), deleteLinks().

# 2. Lyrics engine — no conflict, A has nothing here
git checkout feat/compose-player-ui -- \
  android/app/src/main/java/com/lyricflow/app/compose/player/Lyrics.kt \
  android/app/src/main/java/com/lyricflow/app/compose/player/LyricStage.kt
```

Then:

3. Wire `LyricStage` into A's `ComposeMiniPlayer` expanded stage, feeding it
   `buildSongLyrics(repository.getSongWithLyrics(id))`.
4. `NativePlaybackController` — both branches edited it. A's is the base; from B
   take only what A lacks (`playQueue`, `seekTo`, `playQueueIndex`, `currentSong`
   / `queue` StateFlows) if A has no equivalent.
5. Rebuild, install, and **verify the lyric fix end to end**: a line-synced song
   must land on the right line, and `sqlite3 room.db "SELECT COUNT(*) FROM lyrics
   WHERE timestamp != CAST(timestamp AS INTEGER)"` must return **3421**, not 0.
6. Delete B's duplicated files (list above) so there is one implementation.

---

## After merging — what is actually left

`PARITY-GAPS.md` predates A's Home/Search/Settings/Luvs work and overstates what
is missing. Corrected:

**Done:** shell, migration (with B's fixes), Local browse, Playlists browse,
player basics, Settings screen, Luvs feed + vault, Home surface, Search surface,
downloader hub, Spotify hub.

**Still missing:**
- Playlist *management*: create, rename, delete, add/remove songs, drag-reorder,
  per-playlist search/sort, cover editing.
- Local shell has since advanced past this note: native edit info, edit lyrics,
  sync lyrics, offset, retry/version search, cover tools, hide/delete, and
  share actions are now present, and the top queue action now opens its own
  native queue dialog. Remaining Local work is polish, not broad RN bounce-outs.
- Lyrics tooling has since advanced too: provider fetch/race, Edit Lyrics,
  Sync Lyrics, per-song offset UI, offline payload hydration, and plain→synced
  upgrade are landed. Remaining work is provider-depth polish and UAT, not the
  initial tooling surface.
- Player: dynamic island style, swipe-to-skip, route-aware visibility,
  mini-player style preference.
- Transliteration (Phase 4) — nothing.
- Streaming playback (Phase 5) — Home browses, but playing a stream needs the
  `:innertube` + PoToken/NewPipe resolver chain.
- Backup/export v2; RN removal (Phase 8).

**Blocking caveat:** the legacy RN app does not open in a debug build — it lands
on Expo DevLauncher waiting for Metro. Every "opens legacy app" affordance is a
dead end until either Metro runs or a release build is used. That makes the
"still bounces to RN" items above effectively unavailable, not merely unported.

---

## Rules for avoiding this again

1. **One session per surface.** Both agents built Local, Playlists, the player,
   the tab bar and the artwork flow independently. That is three duplicated
   days.
2. Commit early on a shared branch rather than accumulating dozens of
   uncommitted files, so the other session can see what exists.
3. Never build in two places at once — all `node_modules/*` Android modules share
   build directories across worktrees and concurrent Gradle runs corrupt each
   other's outputs.
