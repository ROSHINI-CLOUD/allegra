# Luvs — Compose rebuild PRD

**Status:** not started. Everything below is unbuilt.
**Branch context:** `feat/compose-player-ui` (Compose shell, player, Local, Playlists, Downloads all done).
**Audience:** the agent implementing this. Read the whole file before writing code — several constraints will silently waste a day if discovered late.

---

## 1. What Luvs is

A full-screen, vertically-paged music discovery feed — reels for songs. One
track per page, artwork full-bleed, tap to play/pause, swipe up for the next.
The feed is personalised from the user's own library (top artists, language
weights, skip history). Any track can be saved to a "vault" or **downloaded
immediately** into the local library.

It already exists and works in the React Native app (`src/screens/LuvsScreen.tsx`,
616 lines). It is **not** wired in the Compose app at all — the Luvs tab is still
a placeholder card.

---

## 2. The one constraint that shapes everything

**The existing Expo modules cannot be used from Compose.**

`LuvsEngineModule` and `LuvsPlayerModule` are Expo `Module` classes. Every entry
point resolves `appContext.reactContext`, and the Compose-first launch never
initialises the React context — `MainApplication.initializeExpoLifecycle()` only
runs when the legacy `MainActivity` opens. Calling them from Compose returns
null or throws.

**Therefore:**

| Do NOT use | Use instead |
|---|---|
| `LuvsEngineModule` | `LuvsEngine(LuvsPrefs(context))` — plain Kotlin, instantiate directly |
| `LuvsPlayerModule` | A Compose-owned ExoPlayer pool (spec in §6) |
| `DownloaderModule` | `WorkManager.enqueueUniqueWork` + `DownloadWorker` directly (§7) |
| `LuvsPagerView` (React view) | New Compose `VerticalPager` |

This is the same wall hit by the voice mic and the downloader earlier in this
branch; `DownloaderScreen.kt` already shows the working pattern for the
WorkManager half — copy its approach.

The underlying engine classes are pure Kotlin and **are** reusable:
`LuvsEngine`, `LuvsPrefs`, `LuvsModels`, `SaavnClient`.

---

## 3. Existing Kotlin API (all reusable as-is)

### `com.lyricflow.app.luvs.LuvsEngine`

```kotlin
class LuvsEngine(private val prefs: LuvsPrefs) {
    fun setLibrary(songs: List<LocalSong>)      // seed personalisation
    fun feedSnapshot(): List<LuvSong>
    fun setCurrentIndex(index: Int)
    suspend fun fetchPersonalizedFeed(): List<LuvSong>
    suspend fun refresh(): List<LuvSong>        // replaces feed
    suspend fun loadMore(): List<LuvSong>       // appends, dedups on matchKey
    suspend fun discoverSimilar(songId: String): List<LuvSong>
}
```

Feed generation already handles: weighted language selection, top-artist and
skipped-artist pools, query modifiers (`Trending`, `Hit Songs`, `Melody`,
`Love Songs`, `Party Songs`), parallel per-query fetch, and interleaving so the
same artist doesn't cluster. **Do not reimplement any of this.**

### `com.lyricflow.app.luvs.LuvsPrefs`

```kotlin
class LuvsPrefs(context: Context) {
    fun languageWeights(): List<LanguagePreference>
    fun activeLanguages(): List<String>
    fun isLanguageRestricted(): Boolean
    fun topArtistNames(limit: Int = 5): List<String>
    fun skippedArtistNames(): List<String>
    fun isSeen(songId: String): Boolean
    fun setLanguages(selected: List<String>)
    fun recordInteraction(interaction: LuvInteraction)
    fun markSeen(songId: String)
    fun flush()                                  // persist — call on pause/dispose
    fun seedFromLibrary(library: List<LocalSong>)
}
```

Backed by `SharedPreferences("luvs_prefs")`. Independent of Room and of the live
RN database, so there is **no** one-writer conflict here — Luvs may write freely.

### `com.lyricflow.app.luvs.LuvsModels`

```kotlin
data class LuvSong(
    val id: String, val title: String, val artist: String,
    val highResArt: String, val downloadUrl: String,
    val hasLyrics: Boolean = false, val source: String = "Saavn",
    val duration: Int? = null, val playCount: Long = 0,
    val language: String? = null,
    val isLocal: Boolean = false, val isAuthentic: Boolean = false,
) { val matchKey: String }   // "title_artist", lowercased+trimmed — dedup key

data class LocalSong(
    val id: String, val title: String, val artist: String,
    val coverImageUri: String?, val audioUri: String?,
    val duration: Int?, val hasLyrics: Boolean,
) { val matchKey: String }

data class LuvInteraction(
    val songId: String, val title: String, val artist: String,
    val timestamp: Long, val watchDuration: Double, val totalDuration: Double,
)
```

`downloadUrl` is a **direct, playable HTTPS URL** from JioSaavn — ExoPlayer can
take it straight, and `DownloadWorker` can fetch it straight. No resolution step,
no PoToken, none of the YouTube fragility.

---

## 4. Files to create

All under `android/app/src/main/java/com/lyricflow/app/compose/luvs/`.

| File | Responsibility |
|---|---|
| `LuvsViewModel.kt` | Owns `LuvsEngine`, feed list, current index, vault, loading/error state. Survives config change. |
| `LuvsPlayerPool.kt` | ExoPlayer pool + preload window (§6). No Compose types in here. |
| `LuvsScreen.kt` | `VerticalPager` host, index tracking, interaction recording, load-more trigger. |
| `LuvCard.kt` | One page: artwork, gradient scrim, centre play/pause, right action rail, bottom metadata. |
| `LuvsVaultSheet.kt` | Saved-luvs bottom sheet. |
| `LuvsLanguageSheet.kt` | Language weight picker → `prefs.setLanguages(...)`. |

Then wire into `LyricFlowComposeApp.kt` → `ShellTabScene` → `ShellDestination.LUVS`.

---

## 5. UX spec

Numbers are from `src/screens/LuvsScreen.tsx` and `src/components/LuvCard.tsx`.
Match them; they are tuned.

### Page
- One song fills the **entire screen height** (`LUV_HEIGHT = SCREEN_HEIGHT`).
  Full-bleed, edge-to-edge, under the status bar. The page must sit **above** the
  tab bar visually but still let the tab bar remain reachable — verify against
  the existing `LuvTabBar` height (64dp + navigation-bar inset).
- Artwork: `song.highResArt`, `ContentScale.Crop`, fills the page. When absent,
  a music-note glyph at ~64dp, `rgba(255,255,255,0.3)`.
- Vertical gradient scrim bottom-up so the metadata stays legible over any cover.

### Centre control
- Tap anywhere on the page toggles play/pause.
- Play/pause glyph ~46dp, white, shown on the tap and while paused; fades out
  while playing.

### Right action rail (bottom-right, vertical)
Each item is an icon + small label, with a spring scale-bounce on press.

| Action | Icon | Notes |
|---|---|---|
| Like | heart / heart-outline | Active tint `#FF2D55`. Bounces on activate. |
| Magic | sparkle | Calls `engine.discoverSimilar(song.id)` and splices results in after the current index. |
| Share | share-outline | Android `ACTION_SEND` with "Title — Artist". |
| Save | bookmark-outline | **Downloads immediately** (§7) — this is the "download right away" behaviour. |

### Bottom-left metadata
- Title, 1 line, ellipsised, bold.
- Artist, 1 line, ellipsised, muted.
- A small music-note badge (~18dp) beside them.
- If `song.hasLyrics`, a small heart/lyrics indicator (`#FF2D55`, ~13dp).

### Top bar (overlay)
- Vault button (opens `LuvsVaultSheet`).
- Language button (opens `LuvsLanguageSheet`).
- Reload button → `engine.refresh()`.

### Empty / loading / error
- First load: full-screen spinner over black.
- Empty feed: message + Reload.
- Network failure: message + Retry. Never leave a blank black page with no
  affordance.

---

## 6. Playback model

This is the fiddliest part. The RN version keeps a **pool of ExoPlayers keyed by
index**, not one player being re-pointed:

- `enterLuvsMode()` — pauses/silences the main `PlaybackService` player, so Luvs
  audio and the docked player never overlap.
- `updateActiveIndex(newIndex, urls, shouldPlay)` — pauses the outgoing index,
  creates or reuses the player for the new index, plays it.
- **Preload window: 1 behind, 4 ahead.** Players outside the window are released.
- `exitLuvsMode()` — releases every player and restores the main player.

### Requirements for the Compose port
1. `LuvsPlayerPool` owns `Map<Int, ExoPlayer>`, honours the 1-behind/4-ahead
   window, and releases everything on dispose.
2. **Starts paused.** The RN screen sets `isPlaying = false` initially — Luvs must
   not blast audio the moment the tab is opened.
3. On entering the tab: pause the docked player via `NativePlaybackController`
   (add a `pause()` if one is not exposed) and remember whether it *was* playing.
4. On leaving the tab (or the screen losing focus): release the pool and restore
   the docked player's previous state.
5. Tie the lifecycle to Compose properly — `DisposableEffect` plus a
   `LifecycleEventObserver`, so backgrounding the app stops Luvs audio.

**Trap:** the Luvs tab is inside a `Crossfade` in `LyricFlowComposeApp`. Leaving
the tab may not dispose immediately during the fade. Guard for double-pause and
for a pool released while a page is still visible.

---

## 7. Download-right-away

The "Save" action must put a real file in the library, not just bookmark it.

Copy the working pattern from `DownloaderScreen.kt` on this branch:

```kotlin
val songDir = File(context.filesDir, "songs/${song.id}").absolutePath
val work = OneTimeWorkRequestBuilder<DownloadWorker>()
    .setInputData(workDataOf(
        "id" to song.id,
        "audioUrl" to song.downloadUrl,
        "coverUrl" to song.highResArt,
        "songDir" to songDir,
        "lyrics" to null,
        "safDir" to null,
    ))
    .addTag(song.id)
    .build()
WorkManager.getInstance(context)
    .enqueueUniqueWork(song.id, ExistingWorkPolicy.REPLACE, work)
```

- Progress is observable on `ProgressBus.events` (`SharedFlow<ProgressEvent>`),
  filtered by `event.id == song.id`. Show inline progress on the Save button and
  flip it to a green tick on `"succeeded"`.
- The existing `DownloadsScreen` (Queue) will pick these up automatically — it
  already listens to the same bus.
- **Open question to decide during implementation:** whether a completed Luvs
  download should be inserted into Room as a `SongEntity` so it appears in Local.
  It should — but Room is currently overwritten from the legacy DB on a payload
  bump, and only `is_liked` / `play_count` / `last_played` are preserved
  (`LegacyLibraryMigrator`). A Luvs-inserted song would be **pruned** by the
  delete-propagation step because it does not exist in legacy. Either add an
  `origin` column and exempt non-legacy rows from pruning, or defer library
  insertion until the Phase 8 cutover. Do not silently insert and let it vanish.

---

## 8. Interaction telemetry (drives personalisation)

The feed quality depends entirely on this being recorded correctly.

- `SKIP_THRESHOLD_SECONDS = 3`. A page viewed for **less than 3 s** is a skip;
  the artist feeds `prefs.skippedArtistNames()` and is down-weighted.
- On every index change, record for the **outgoing** song:
  ```kotlin
  prefs.recordInteraction(LuvInteraction(
      songId, title, artist,
      timestamp = System.currentTimeMillis(),
      watchDuration = secondsOnPage,
      totalDuration = song.duration?.toDouble() ?: 0.0,
  ))
  prefs.markSeen(songId)
  engine.setCurrentIndex(newIndex)
  ```
- Track "seconds on page" with a timestamp captured when the page becomes
  current — not with a ticking timer.
- Call `prefs.flush()` on screen dispose and on app pause. Without it the
  session's learning is lost.
- Seed once per session: `engine.setLibrary(localSongs)` and
  `prefs.seedFromLibrary(localSongs)`, mapping Room `SongEntity` → `LocalSong`.

---

## 9. Feed paging

- Initial: `engine.refresh()`.
- Prefetch more when the user reaches **within 3 pages of the end** → `engine.loadMore()`.
- `loadMore()` already dedups on `matchKey`; do not filter again.
- Guard against overlapping loads with an `isLoadingMore` flag — the pager fires
  the trigger repeatedly while settling.

---

## 10. Conventions to follow on this branch

- Colours: `LuvColors` in `ShellSurfaceTheme.kt` (`TextMuted #6E6E6E`,
  `ArtworkPlaceholder #2A2A2A`, `Divider #1F1F1F`, `Success #7ED957`). Background
  is true black `#000000`; accent is monochrome white. **No Material tonal surfaces.**
- Images: Coil `AsyncImage`.
- Clickables: `clickable(interactionSource = remember { MutableInteractionSource() }, indication = null)` — the app does not use ripples.
- Screens are plain composables taking a repository/callbacks; no Hilt on this branch.
- Wordmark/heading style: weight `Black`, negative letter-spacing (see `ScreenTitle`).

---

## 11. TODO checklist

### Data + engine
- [ ] `LuvsViewModel` holding `LuvsEngine`, `LuvsPrefs`, feed, index, vault, loading/error
- [ ] Map Room `SongEntity` → `LocalSong`; call `setLibrary` + `seedFromLibrary` once
- [ ] `refresh()` on first open; `loadMore()` within 3 pages of the end, guarded
- [ ] `discoverSimilar()` splice for the Magic action
- [ ] Interaction recording with the 3-second skip rule; `markSeen`; `flush()` on dispose

### Playback
- [ ] `LuvsPlayerPool` with 1-behind/4-ahead window and full release on dispose
- [ ] Starts paused
- [ ] Pause + restore the docked player on enter/exit (add `pause()` to `NativePlaybackController` if missing)
- [ ] Lifecycle-aware stop on background
- [ ] Verify no double-audio during the tab `Crossfade`

### UI
- [ ] `VerticalPager`, one full-screen page per song
- [ ] `LuvCard`: artwork, scrim, tap-to-toggle, 46dp centre glyph
- [ ] Action rail: Like (`#FF2D55`, bounce), Magic, Share, Save
- [ ] Bottom metadata: title, artist, lyrics indicator
- [ ] Top overlay: vault, language, reload
- [ ] Loading / empty / error states
- [ ] `LuvsVaultSheet`
- [ ] `LuvsLanguageSheet` → `prefs.setLanguages`

### Download
- [ ] Save enqueues `DownloadWorker` directly
- [ ] Inline progress from `ProgressBus`, green tick on success
- [ ] **Decide and document** the Room-insertion question in §7

### Wiring
- [ ] `ShellTabScene` → `ShellDestination.LUVS` → `LuvsScreen`
- [ ] Confirm the docked `PlayerDock` does not overlap the Luvs page badly

---

## 12. Acceptance criteria

1. Opening Luvs shows a personalised feed drawn from the user's own artists —
   not a generic chart — and does **not** auto-play.
2. Tap plays; swipe up advances; audio follows the visible page with no overlap
   and no audible gap on a fast swipe.
3. The docked player pauses on entering Luvs and returns to its previous state on
   leaving.
4. Swiping past a song in under 3 s down-weights that artist — verify by checking
   `prefs.skippedArtistNames()` grows.
5. Save downloads a real file; progress is visible on the card and the track
   appears in the Queue screen.
6. Reaching the end loads more without a visible stall or duplicates.
7. Backgrounding the app stops Luvs audio; returning does not double-play.
8. Language picker changes which languages appear in the next `refresh()`.

---

## 13. Traps

1. **Expo modules are unusable from Compose** (§2). This is the big one.
2. **`SaavnClient.initCache(cacheDir)`** — call it once at startup or the HTTP
   cache is absent; search still works but is slower and hits the network harder.
3. **Concurrent Gradle builds corrupt each other.** All `node_modules/*` Android
   modules share build directories across worktrees. Never build in two places at
   once.
4. **CMake path length** kills `:app:buildCMakeDebug[arm64-v8a]` at the worktree
   path. Copy prebuilt `.so` from the main checkout (same config hash) and pass
   `-x "buildCMakeDebug[arm64-v8a]"` — note the ABI qualifier; plain
   `-x buildCMakeDebug` does not match the task.
5. **`debug.keystore` is gitignored**, so a fresh worktree cannot sign until it is
   copied from the main checkout.
6. **The JioSaavn base URL is a third-party proxy**
   (`jiosaavn-api-byprats.vercel.app`) hardcoded in `SaavnClient`. It can and will
   go down. Handle failure with a retryable error state, never an infinite spinner.
7. **Do not open a PR** until the user has tested on device — that is an explicit
   standing instruction on this project.

---

## 14. Out of scope

- Home streaming feed (`:innertube` / Echo) — separate piece.
- Any change to the live RN SQLite database.
- Lossless/FLAC — Echo's catalogue is offline (404) and the real ceiling is
  Opus ~160 kbps.
