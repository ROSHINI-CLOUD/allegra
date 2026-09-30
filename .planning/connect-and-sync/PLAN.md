# Allegra Connect + Library Sync: implementation plan

Status: planned, not started. Branch base: `chore/import-luvlyrics-mobile` (LuvLyrics copied into
`apps/mobile`, commit `52d50eb`). Written 2026-09-29.

**The goal in one line:** play on the laptop, pick up the phone, and control or move that music
either way, like Spotify Connect. Likes, playlists, the queue, recently played and recommendations
are the same on Allegra web and on LuvLyrics (Android).

---

## 1. Decisions (from the grilling session)

| # | Decision |
|---|---|
| Identity | Google sign-in inside LuvLyrics through **Convex Auth**, the same account and `userId` as the web |
| v1 scope | Remote control **and** transfer, both ways. A phone whose app is closed cannot be woken yet (v2, push) |
| Guests | Connect and sync need a signed-in account. Guests see "Sign in to use your other devices" |
| One player | **Only one device plays per account.** Starting playback anywhere pauses the others |
| Remote picks a song | It plays on the **active** device (Spotify behaviour) |
| Phone-only songs | Transfer a downloaded song by its saved online id. Older downloads fall back to a title + artist search. Local files with no online match stay control-only |
| Repo | One repo. Allegra `main` is home; LuvLyrics lives in `apps/mobile`, copied fresh. The old repo stays as an archive |
| Disk | Repo moves to `C:\dev\allegra` (short path, no space, so Android CMake builds don't break) |
| Installs | `apps/mobile` is **not** a root workspace: own lockfile, own React pin (19.1.0). Shared code arrives through path aliases |
| CI | LuvLyrics workflows move to root `.github/workflows/mobile-*.yml`, running when `apps/mobile/**`, `packages/**` or `convex/**` change |
| Platforms | Web + Android. iOS compiles but isn't a release target |
| Library sync | **In scope**: liked songs, playlists, queue, recently played, recommendations |
| Like vs download | **Separate.** A like never downloads, and a download never likes |
| Local-only songs | Don't sync (they stay on the phone) |
| First sign-in | **Ask**: Merge both (default) / Use my account's library / Use this phone's library. Downloads are never deleted |
| Conflicts | Per item, newest change wins. Deletes are remembered (tombstones) |
| Sync path | Library data goes **through the Allegra API** (one owner, one contract). Connect's live state goes **directly to Convex** |
| Phone storage | SQLite stays the phone's source of truth for the UI. Sync mirrors it in the background, and offline changes queue up |
| Liked online songs on phone | A new SQLite table; the Liked list shows downloaded and online likes together |
| Recommendations | One brain: the phone reports plays to the account, and both apps show the account's Quick Picks |
| Last session | Opening any device shows the last session **paused and ready** (song, position, queue) |
| What a transfer carries | Current song, position, play/pause, up to 50 upcoming songs, shuffle, repeat |
| Remote screen | The full now-playing screen with **synced lyrics** following the remote position, plus a "Playing on Pixel 8" banner |
| Remote volume | Yes: the playing device's player volume |
| Device names | Automatic ("Chrome on Windows", "Pixel 8"); renaming comes later |
| Realtime | **No hand-written WebSockets.** Convex reactive queries, subscribed only while they matter |
| Build order | Tidy the repo, then phone sign-in, then Connect, then library sync |

---

## 2. Architecture

```
 Allegra web (Next.js)                                   LuvLyrics (Expo, Android)
 ┌─────────────────────────┐                            ┌─────────────────────────┐
 │ useAudioPlayer (1 <audio>)                            │ playerStore + Media3     │
 │   ▲ WebPlayerPort        │                            │   ▲ MobilePlayerPort     │
 │ ConnectSession ◄─────────┼── packages/connect ───────►│ ConnectSession           │
 │   ▼ ConvexTransport      │   (pure TS, both apps)     │   ▼ ConvexTransport      │
 └────────┬────────────┬───┘                            └───┬──────────────┬──────┘
          │ live       │ library (HTTP)          library (HTTP)│         live │
          ▼            ▼                                       ▼              ▼
   ┌────────────┐  ┌───────────────────────────────────────────────┐  ┌────────────┐
   │  Convex    │  │ Express API (Vercel Function)                  │  │  Convex    │
   │ connect.ts │◄─┤  /api/me/library/ops · /changes · liked · ... │─►│ (same one) │
   │ devices    │  │  LibraryStore seam ─► ConvexLibraryStore       │  │            │
   │ playerState│  └───────────────────────────────────────────────┘  │            │
   │ commands   │  likes · playlists · playlistItems · profiles        │            │
   └────────────┘                                                      └────────────┘
 Audio never goes device-to-device: each player fetches from /api/stream (web) or the
 catalog/local file (phone). Only commands and state travel.
```

**Why this shape:**
- **Connect needs pushes, not HTTP.** Convex queries rerun only when their data changes, so an idle
  listener costs nothing. The web already holds a Convex connection for sign-in
  (`apps/web/app/ConvexSignInProvider.tsx`).
- **Library data keeps one owner.** Express already owns the listener-data rules, the rate limits
  and `docs/api-contract.md`. A second write path straight from the phone to Convex would drift.
- **Vercel Functions can't hold sockets**, so none of the realtime work touches Express.

---

## 3. Modules (deep modules, one seam each)

### M1 `packages/shared/songRef.ts` — one song identity for both apps
The facts behind it: Allegra stores **bare Saavn ids** (`catalog.getSong` only asks Saavn). The phone
uses `stream:saavn:<id>` / `stream:gaana:<id>`. Downloaded rows keep **no** provider id
(`apps/mobile/src/database/db.ts:115`).

```ts
type SongRef = `saavn:${string}` | `gaana:${string}`;
interface SongSnapshot { ref: SongRef; title: string; artist: string; album?: string;
                         artwork: string; duration: number /* seconds */ }
toRef(allegraSong: UnifiedSong): SongRef          // Saavn: `saavn:${id}`
fromMobileId(id: string): SongRef | null           // 'stream:saavn:x' -> 'saavn:x'
toMobileId(ref): string                             // inverse
toAllegraId(ref): string | null                     // saavn only, else null
matchKey(title, artist): string                     // the ONE title+artist key (moves from mobile songsStore + web songIdentity)
```
Every cross-device payload carries a `SongSnapshot`, so nothing depends on re-hydrating a Gaana id.
Tests: round-trips, and the same `matchKey` output on web and phone.

### M2 `convex/connect.ts` + schema — the "dealer"
Tables (added to `convex/schema.ts`):
```ts
devices:     { userId, deviceId, name, kind: 'web'|'android'|'ios', appVersion, lastSeenAt,
               canPlay: boolean }                          .index('by_user', ['userId','lastSeenAt'])
                                                           .index('by_device', ['deviceId'])
playerState: { userId, activeDeviceId?: string, song?: SongSnapshot, queue: SongSnapshot[] /* ≤50 */,
               isPlaying, positionSec, positionAt /* server ms */, volume /* 0-1 */,
               shuffle, repeat: 'off'|'all'|'one', rev }  .index('by_user', ['userId'])
connectCommands: { userId, targetDeviceId, issuedBy, kind, args?, createdAt, status: 'pending'|'done'|'failed',
               error?: string }                            .index('by_target', ['targetDeviceId','status'])
```
Functions (each one checks `getAuthUserId`, and every device must belong to the caller):

| Function | Kind | Purpose |
|---|---|---|
| `register({deviceId,name,kind,appVersion,canPlay})` | mutation | Upsert the device, touch `lastSeenAt`, return `serverNow` |
| `heartbeat({deviceId})` | mutation | Touch `lastSeenAt` (called every 60 s while subscribed) |
| `devices()` | query | Devices seen in the last 2 min, plus the active one |
| `state()` | query | This user's `playerState` |
| `pendingFor({deviceId})` | query | Pending commands addressed to this device |
| `report({deviceId, patch, rev})` | mutation | **Only the active device** writes its state. A stale `rev` is rejected |
| `claim({deviceId, snapshot})` | mutation | "I started playing here". Sets `activeDeviceId`. The other devices see it and pause themselves |
| `send({targetDeviceId, kind, args})` | mutation | Enqueue a command. Capped at 20 per 10 s per user |
| `ack({commandId, ok, error?})` | mutation | The target marks the command done or failed; the remote shows failures |
| `transfer({toDeviceId})` | mutation | Sends `take_over` (state included) to the target, which then `claim`s |
| `sweep` | internal cron, every 5 min | Delete commands older than 2 min, and devices unseen for 30 days |

Command kinds: `play`, `pause`, `seek {sec}`, `next`, `prev`, `volume {v}`, `shuffle {on}`,
`repeat {mode}`, `play_song {song, queue?}`, `queue_add {song}`, `take_over {state}`.

### M3 `packages/connect` — `ConnectSession` (the deep module)
Pure TypeScript, no React, no Convex import. Both apps use it.
```ts
createConnectSession({ transport, player, device, clock }): ConnectSession
interface ConnectSession {
  view(): ConnectView            // devices, activeDevice, isThisDeviceActive, remote song/queue,
                                  // livePosition(), pendingCommand, lastError
  subscribe(fn): () => void
  control(cmd: RemoteCommand): void   // routed locally if this device is active, else sent
  transferTo(deviceId): Promise<TransferResult>
  setVisible(visible: boolean): void  // drives when to subscribe (see §4)
  dispose(): void
}
```
What stays hidden behind that interface:
- when to subscribe and when to drop the subscription
- heartbeats
- clock offset (from the `serverNow` each mutation returns)
- position extrapolation
- command dedupe and acks
- echo suppression (don't report state caused by a command we just applied)
- the one-player rule (pause when someone else claims)
- `take_over` handling
- the autoplay-blocked state
- "last session paused and ready"

Seams, each with **two real adapters**:
- `ConnectTransport`: `ConvexTransport` (a `ConvexReactClient` wrapper, one per app) and `MemoryTransport` (an in-process fake of M2 for tests and the dev harness).
- `PlayerPort`:
  ```ts
  getSnapshot(); onChange(fn);
  play(); pause(); seek(sec); setVolume(v);
  load(song, queue, {positionSec, play}): Promise<'ok'|'not_found'|'needs_gesture'>
  ```
  Adapters: `WebPlayerPort` (wraps `useAudioPlayer`) and `MobilePlayerPort` (wraps `usePlayerStore` + `playerControls`).

**Both apps' playback invariants hold by construction.** A `PlayerPort` only ever calls
`requestPlayback(...)`, never a raw setter. Seeks capture `wasPlaying` and resume. Load effects never
depend on `isPlaying`. On Android, `MobilePlayerPort.play()` sends the command and lets Media3's
`playWhenReady` update the store, the same way `requestPlayback` does today.

### M4 `apps/api` `LibraryStore` seam — operation-based library
Today every library route does read → modify → `UserStore.save(wholeProfile)`. Two devices writing at
once lose an update. The new seam:
```ts
interface LibraryStore {
  apply(userId, ops: LibraryOp[]): Promise<{ rev: number; rejected: RejectedOp[] }>  // one Convex transaction
  changes(userId, sinceRev, limit): Promise<{ rev; items: LibraryChange[]; more: boolean }>
  snapshot(userId): Promise<LibrarySnapshot>   // what GET /me/liked and GET /libraries read
}
type LibraryOp =
  | { op: 'like' | 'unlike'; song: SongSnapshot; at: number }
  | { op: 'playlist_upsert'; playlistId; name; description?; isPublic?; at }
  | { op: 'playlist_delete'; playlistId; at }
  | { op: 'playlist_add'; playlistId; song: SongSnapshot; position: string /* fractional index */; at }
  | { op: 'playlist_remove'; playlistId; ref: SongRef; at }
```
Adapters: `ConvexLibraryStore` (new tables, below) and `MemoryLibraryStore` (tests, and local dev
without Convex).

New Convex tables: `likes {userId, ref, song, liked, updatedAt, rev}`,
`playlists {userId, playlistId, name, description?, isPublic, coverKey?, deleted, updatedAt, rev}`,
`playlistItems {userId, playlistId, ref, song, position, deleted, updatedAt, rev}`, plus a `libraryRev`
counter on `profiles`.

Conflict rule: an op only applies if `at > stored.updatedAt`. `at` is clamped to server time, so a
phone with a fast clock can't win forever. A delete is a row with `liked:false` / `deleted:true`.

**The web contract doesn't change**: `POST /api/me/liked`, `POST /api/libraries/:id/songs`, etc. become
one-op calls to `apply`.

### M5 `apps/mobile/src/services/sync/LibrarySync` — the phone's sync engine
```ts
LibrarySync.start(session) / stop()
LibrarySync.record(op)        // called by songsStore / playlistStore after a local change
LibrarySync.firstSignIn(choice: 'merge'|'account'|'phone')
```
Hidden inside:
- an **outbox** (SQLite `sync_outbox`), flushed in batches of 100 or fewer, with a 2 s debounce and retry backoff
- a pull cursor (`sync_meta.rev`)
- applying remote changes to SQLite through the existing query modules
- mapping phone rows to a `SongRef` (the `origin_id` column, then `matchKey`)
- skipping local-only songs

It runs on sign-in, when the app comes to the foreground, and after local changes. Tests use real
SQLite, per the mobile rule.

### M6 `apps/mobile/src/services/account/` — phone sign-in
`ConvexAuthProvider` (from `@convex-dev/auth/react`) with `expo-secure-store` storage. The Google
flow:
1. `signIn('google', { redirectTo: Linking.createURL('/auth') })` returns the Google redirect URL.
2. The app opens it with `WebBrowser.openAuthSessionAsync(url, redirectTo)`.
3. It reads `code` from the result and calls `signIn('google', { code })`.

Server side: `convex/auth.ts` gains `callbacks.redirect` that allows `SITE_URL` and the `lyricflow://`
scheme (nothing else). The same web Google client is used; there's no Android OAuth client to set up.
The account token is sent to the Express API as `Bearer`; `ConvexTokenVerifier` already accepts it.

### M7 `apps/mobile/src/services/connect/songMatcher.ts` — `SongRef` → something playable
`resolvePlayable(snapshot): Promise<Song | null>` tries these in order:
1. a library row whose `origin_id` equals the ref (plays the file instantly, offline)
2. a library row with the same `matchKey`
3. a stream song for that ref (`streamIdFor`)
4. for the reverse direction, a phone song with no ref: search the catalog by title + artist through `ytmusic/resolver.ts`, which already rejects covers and slowed versions

`null` means "Couldn't find this song online".

---

## 4. Connect behaviour in detail

**When a device listens.** No listening means no cost.
- **Web tab:** while it's open **and** (visible, playing, or active). One tab per browser registers,
  chosen by `BroadcastChannel`; other tabs show "Allegra is playing in another tab".
- **Phone:** while the app is in the foreground, or while Media3 is playing (the foreground service
  keeps the JS runtime and socket alive). An idle phone in the background is offline in the picker.
- The **remote view** (`playerState`) is subscribed only while the player or Connect sheet is visible.

**Play here on a device (the one-player rule).** Local `requestPlayback(true)` calls
`claim(deviceId, snapshot)`. The previously active device sees `activeDeviceId ≠ me` while playing,
calls `player.pause()`, and becomes a remote.

**Remote control.** On the remote, `session.control({kind:'pause'})` optimistically updates the
view, then calls `send`. The active device's `pendingFor` fires, and it applies the command through
its `PlayerPort`, `ack`s, then `report`s the new state. If there's no ack within 4 s, the remote
rolls back and shows "Couldn't reach Pixel 8".

**Transfer (B takes over from A):**
1. The picker calls `transfer(toDeviceId: B)`, which enqueues `take_over { state }` for B.
2. B calls `resolvePlayable(song)` (phone) or builds a `UnifiedSong` from the snapshot (web). It
   then calls `player.load(song, queue, { positionSec: extrapolated, play: wasPlaying })` and `claim`s.
3. A sees the claim and pauses.
4. On failure B `ack`s `failed` with a reason, A keeps playing, and the picker shows the reason.

**Autoplay (web target).** If `play()` rejects with `NotAllowedError`, the web port returns
`needs_gesture`. The web claims, but reports itself paused, and shows a **"Tap to play here"** bar.
One tap resumes at the right position.

**Position.** Every mutation returns `serverNow`, which gives the clock offset. Remotes show
`positionSec + (serverClock - positionAt) × isPlaying`, and lyrics follow the same function. The
active device reports on play, pause, seek and song change, and every 30 s as a drift fix. It never
reports every second.

**Last session (Q32).** The active device always keeps `playerState` current, even when only one
device exists. On app start, with no local session, the app loads `state.song`, `queue` and position
**paused**. Nothing auto-plays.

**Remote volume.** The web sets `<audio>` volume. The phone sets the Media3 player volume
(`NativeAudioPlayer`), not system volume.

**Not in v1:**
- **Karaoke** stays on the device that plays it; the remote view shows "Karaoke plays on this device only".
- **Listen Together:** while a room is active, Connect shows the phone as "In Listen Together" and disables transfer.
- **LuvLyrics Desktop:** the LAN bridge (`DesktopBridgeService`) is untouched.

---

## 5. Build phases, A to Z

Effort shows both scales: human / CC. Every phase ends green on the Verify line and ships as its own
PR (squash, conventional commit, no AI footer, per `CLAUDE.md`).

### Phase 0 — Repo move and tidy-up
1. **Move the repo** to `C:\dev\allegra`. Close the Claude app, editors and dev servers first, then
   run `Move-Item "...\allegra aws" C:\dev\allegra`. Reopen Claude in the new folder. (human 5 min)
2. **Merge `chore/import-luvlyrics-mobile`** into `main` once the web's own checks pass: `npm run typecheck && npm run lint && npm test`.
3. **CI:** move the workflows out of `apps/mobile/.github/workflows/*` to root `.github/workflows/mobile-ci.yml`,
   `mobile-apk.yml` and `mobile-smoke.yml`, with `defaults.run.working-directory: apps/mobile`, `paths:` filters,
   and `cache-dependency-path: apps/mobile/package-lock.json`. Delete `apps/mobile/.github`. Keep the
   issue templates at the root. (h 2 h / CC 20 min)
4. **Shared-code aliases** in `apps/mobile/tsconfig.json`:
   - `@allegra/shared/*` → `../../packages/shared/*`
   - `@allegra/connect` → `../../packages/connect/src`
   - `@allegra/convex/*` → `../../convex/_generated/*`

   In `metro.config.js`, add `watchFolders` for `packages/` and `convex/`, and put
   `nodeModulesPaths` with `apps/mobile/node_modules` **first**, so `react` / `convex` always resolve
   to the phone's copies. Add `@convex-dev/auth` and `@auth/core` to mobile, because
   `_generated/api.d.ts` type-imports every Convex module. (h 3 h / CC 30 min)
5. **Dev scripts:** root `npm run dev:mobile` (→ `npm --prefix apps/mobile start`). Add an "Everything"
   section to `docs/workflows.md` covering web + API + phone on one Wi-Fi, and the mobile `.env`
   (`EXPO_PUBLIC_CONVEX_URL`, `EXPO_PUBLIC_API_URL`).
6. **Infra test:** assert `apps/mobile/.github` is gone and that the root has the `mobile-*.yml` workflows.

**Verify:**
- `npm ci && npm run typecheck && npm run lint && npm test` at the root
- in `apps/mobile`: `npm ci && npm run ci`
- `cd apps/mobile/android && ./gradlew assembleDebug` from `C:\dev\allegra`
- a Metro bundle that imports `@allegra/shared/types` works on a device

### Phase 1 — One song identity ✅ done
1. Add `packages/shared/songRef.ts` (M1) with tests. The phone's `matchKey` / `leadArtist` moved there
   verbatim. **The web's `songIdentity` stays**: it keys queue dedupe on *all* artists sorted, a
   different job from matching a download to a catalog row (lead artist only), so merging them would
   change behaviour on both sides.
   Note for Phase 8: despite the "real SQLite" rule, the phone's Jest DB tests mock `./db`. The sync
   engine needs a real-SQLite harness (an adapter behind `withDbWrite`/`withDbRead`) before its tests.
2. Mobile SQLite migration (`db_migration.ts`): add `songs.origin_id TEXT` and an index.
   `StreamService.save` and `DownloadManager` write `origin_id` for downloads that came from a stream.
3. Backfill on boot: nothing (the matcher's title + artist fallback covers older rows).

**Verify:** unit tests on both sides. Download a streamed song and confirm the row has `origin_id = 'saavn:…'`.

### Phase 2 — Google sign-in on the phone (h 1.5 d / CC 2 h)
1. Server: add `callbacks.redirect` in `convex/auth.ts` with an allow-list test (`lyricflow://auth`
   yes, `https://evil.com` no). Add the mobile redirect to the docs.
2. Mobile: add deps `convex`, `@convex-dev/auth`, `expo-secure-store`, `expo-web-browser` and
   `expo-linking` (via `npx expo install`). Build `services/account/AccountProvider.tsx` (M6) at the root of
   `App.tsx`, `useAccount()` (`signedIn`, `user`, `signIn`, `signOut`), and
   `services/net/allegraApi.ts` (a `fetchWithTimeout` wrapper that adds `Authorization: Bearer`; it
   returns `null` on failure and never throws).
3. UI: an "Allegra account" row in Settings, and the entry point in the Connect sheet (Phase 6).
   Sentence case, no sparkle icons.

**Verify:**
- Sign in on the phone, then sign in on the web with the same Google account.
- A Convex dashboard query shows one `users` row, and both clients' `profiles.identity` return the same id.
- Sign out clears the secure store.

### Phase 3 — Connect backend (h 2 d / CC 2 h)
1. Add the schema tables (M2) and `convex/connect.ts`, plus the `sweep` cron in `convex/crons.ts`.
2. Tests with `convex-test`:
   - ownership checks (a command can't target another user's device)
   - `report` from a non-active device is rejected
   - `claim` flips the active device
   - the rate cap
   - `sweep`
3. `docs/connect-contract.md`: the tables, functions, command kinds and error codes. The rule is the
   same as for the API contract: propose, update the doc, then change both sides.

**Verify:** `npx convex dev` deploys to a dev deployment and the tests pass.

### Phase 4 — `packages/connect` core (h 3 d / CC 3 h)
1. Build `createConnectSession`, `MemoryTransport` and a `FakePlayerPort` (records calls, with a
   switchable "rejects autoplay").
2. Behaviour tests, all through the public interface:
   - remote pause is applied once, and acked
   - one-player: B claims, so A pauses
   - transfer succeeds, keeping position and queue
   - transfer fails (not found, or offline timeout) and A keeps playing
   - `needs_gesture` path
   - extrapolation with clock skew
   - echo suppression (no report loop)
   - subscriptions stop when not visible and not playing
   - last session loads paused

**Verify:** `npm test` in `packages/connect`, and the web typecheck.

### Phase 5 — Web integration (h 3 d / CC 3 h)
1. `WebPlayerPort` over `useAudioPlayer`: `load` builds a `UnifiedSong` from the snapshot (Saavn →
   `/api/stream/:id`; Gaana → resolve by `matchKey` through `/api/search` first).
2. `ConvexTransport` built on the **existing** `ConvexReactClient` from `ConvexSignInProvider`. Expose
   the client through context; the player still never imports a Convex hook directly.
3. `useConnect()` mounted in the layout next to the audio element (it must not remount
   `<audio>`). Device id: `localStorage['allegra-device-id']`. Name: from `navigator.userAgentData` / UA.
4. UI:
   - a device button in `PlayerPanel`, opening a picker sheet (devices, this device first, active marked)
   - remote mode: `PlayerPanel` and `LyricsPanel` read from `session.view()`, and controls call `session.control`
   - the "Playing on Pixel 8" bar
   - the "Tap to play here" bar
   - clicking a song while remote plays it on the active device (`play_song`)

   Motion uses tokens only (transform/opacity), and reduced motion falls back to opacity.
5. Dev harness: `?connectDevice=b` (development builds only) gives a tab its own device id, so **two
   tabs on :5173 can control and transfer to each other without a phone**.

**Verify:**
- The two-tab harness: pause, seek, next, volume, transfer both ways.
- The autoplay prompt appears after a fresh reload.
- The `<audio>` DOM node survives route changes (see `docs/workflows.md`).
- 360 / 768 / 1280 / 1920 widths.
- typecheck, lint, test.

### Phase 6 — Phone integration (h 3 d / CC 3 h)
1. `MobilePlayerPort` over `usePlayerStore` / `playerControls`. `load` goes through `songMatcher` (M7),
   then `setPlaylistQueue` + `loadSong`. It respects the `beginAudioLoad` / `endAudioLoad` ownership
   and calls `prepareNextInQueue()` after changing the queue.
2. `ConvexTransport` (mobile). Device id is in AsyncStorage; the name comes from `Platform.constants.Model`.
   `AppState` drives `setVisible`, and the store's `isPlaying` keeps the session alive in the background.
3. UI:
   - a device icon in the expanded player, opening a `PlayerSheet` device list
   - remote mode in `MiniPlayer` / `NowPlayingScreen`, with `SynchronizedLyrics` fed by `livePosition()`
   - a "Playing on Chrome on Windows" pill
   - reuse `Tactile` / `RiseIn`; no new shadows on NowPlaying
4. Listen Together guard: while a room is active, the device reports `canPlay:false` with that reason.

**Verify:**
- A physical Android phone plus the web: control both ways, transfer both ways.
- A downloaded song plays from the file (check it works in airplane mode after transfer); a stream-only song streams.
- A local-only song shows the disabled reason.
- Screen off while playing: the laptop can still pause it.
- `npm run ci` in `apps/mobile`.

### Phase 7 — Library sync backend (h 3 d / CC 3 h)
1. Add the `LibraryStore` interface, `MemoryLibraryStore` and `ConvexLibraryStore` (M4), plus the Convex
   mutations `library.apply` and the queries `library.changes` / `library.snapshot` / `library.rev`.
2. Migration (`convex/migrations/libraryV2.ts`): copy `profiles.likedSongIds` and `libraries[].songIds`
   into the new tables. `at` = the profile's `createdAt`, `ref` = `saavn:<id>`, and the snapshot is empty
   (the web hydrates missing snapshots with `/api/songs?ids=` and writes them back lazily). Old fields stay
   until the next release, then get dropped.
3. Routes: the existing library routes call `apply` or `snapshot` with no shape change. New additive routes:
   - `POST /api/me/library/ops` `{ ops: LibraryOp[] ≤100 }` → `{ rev, rejected[] }`
   - `GET /api/me/library/changes?since=<rev>&limit=500` → `{ rev, items[], more }`
   - `POST /api/me/recently-played` accepts an optional `playedAt` within the last 7 days, for offline plays

   **Update `docs/api-contract.md` first**, then implement.
4. Web live refresh: subscribe to `library.rev` (one tiny query while signed in) and refetch liked and
   playlists when it moves. A like on the phone shows on the web within a second.

**Verify:**
- API tests: concurrent likes from two "devices" both land; newest-wins with tombstones; clock clamp;
  ops batch limit; `changes` paging.
- `npm test`, plus contract smoke.

### Phase 8 — Library sync on the phone (h 4 d / CC 4 h)
1. **Like ≠ download.** Rework `songsStore.toggleLike` (`apps/mobile/src/store/songsStore.ts:283`):
   liking a stream song writes to a new `liked_online_songs` table (ref, snapshot, liked_at) and
   **doesn't** call `StreamService.save`. Retire `streamLikesStore`. The Liked screen and the heart state
   merge the library likes and the online likes, matched by `origin_id` / `matchKey` so one song never
   shows twice. Download stays its own button.
2. `LibrarySync` (M5) with `sync_outbox` and `sync_meta` tables. `songsStore` and `playlistStore` call
   `LibrarySync.record(op)` after their local writes. Local-only songs are skipped.
3. The first-sign-in sheet (Q25): Merge both (default) / Use my account's library / Use this phone's
   library. It shows counts ("214 liked songs on this phone, 87 in your account"), says "Downloads are
   never deleted", and asks for a second confirmation for "Use this phone's library" (it removes account
   items on the web).
4. Plays and recommendations: after each play, `POST /api/me/recently-played` (+ `taste/signal` seconds),
   queued offline in the same outbox. The Stream home gains a "Quick picks for you" shelf from
   `GET /api/recommendations` when signed in, and keeps its other shelves.
5. Queue and last session come from Connect's `playerState` (Phase 6); no extra work here.

**Verify:**
- Real-SQLite tests for the outbox, merge modes, tombstones, and origin_id/matchKey dedupe.
- End to end: like on the web → it appears in Liked on the phone; unlike offline on the phone, reconnect →
  gone on the web; a playlist edit on both → newest wins; airplane-mode plays show in the web's Recently played.

### Phase 9 — Hardening and release (h 2 d / CC 2 h)
1. User-facing copy for every failure (§6), with no raw errors.
2. Rate limits: the Convex command cap, and `library/ops` under the existing `api` limiter (240/min).
3. Telemetry (respects the analytics opt-out): counts of connect_transfer_ok / failed(reason), and
   sync_push rejected.
4. Docs:
   - `docs/architecture.md` (a new "Connect" section and the state-owner table)
   - `docs/connect-contract.md`
   - `apps/mobile/CLAUDE.md` file map (Account, Connect, Sync)
   - README "What is real vs demo" (Connect and sync are real)
5. Roll out in order: Convex (additive), then API, then web, then the APK. Old APKs keep working: they
   simply don't show up as devices.

---

## 6. Error copy (problem + what to do)

| Situation | What the listener sees |
|---|---|
| Not signed in, picker opened | "Sign in with Google to play on your other devices." [Sign in] |
| Target went offline | "Pixel 8 isn't reachable. Open LuvLyrics on it and try again." |
| Song not found for transfer | "Couldn't find this song online, so it can't play on Chrome." |
| Local-only song | "This song is only on your phone." (transfer disabled) |
| Web autoplay blocked | "Tap to play here" bar, resumes at the right spot |
| Command not acked in 4 s | UI rolls back. "Couldn't reach Chrome on Windows." |
| Too many commands | "Slow down a little. Try again in a moment." |
| Listen Together active | "Pixel 8 is in a Listen Together room." |
| Sync push rejected | Silent retry with backoff. After 24 h stuck: a Settings row "Sync paused: tap to retry" |

---

## 7. Risks and how they're handled

| Risk | Handling |
|---|---|
| Windows long paths break the Android build | Phase 0 moves the repo to `C:\dev\allegra` first |
| Two Reacts or two Convex copies in Metro | `nodeModulesPaths` puts the phone's modules first, with a bundle smoke test in Phase 0 |
| Android kills the JS runtime and socket when idle | Accepted for v1: an idle phone shows as offline. v2 adds push to wake it |
| Convex usage cost | Event-only writes, subscriptions only while visible or playing, a 60 s heartbeat, a command cap, a 5 min sweep |
| Web autoplay | `needs_gesture` path with a one-tap resume |
| A phone with a fast clock wins every conflict | `at` is clamped to server time |
| The migration changes the storage behind live routes | Additive tables, the old fields are kept for one release, and the contract shape is unchanged |
| Gaana ids don't hydrate on the web | Snapshots on every sync payload, with a `matchKey` search on the web before playing |
| Another Claude session editing the same checkout | Work on branches, and merge Phase 0 before parallel work starts |

---

## 8. DX review (gstack plan-devex-review, triage mode, recommendations auto-accepted)

**The developers here** are the people who work on this repo: one person, or a small team, working
across Next.js, Express, Convex and Expo, mostly on Windows.

**The magical moment:** open two tabs on :5173 with `?connectDevice=b`, press pause in one, and the
other pauses. This is Connect with no phone and no build.

**Journey friction and fixes:**

| Stage | Friction | Fix (in plan) |
|---|---|---|
| Install | Two installs (root + `apps/mobile`); easy to forget the second | `docs/workflows.md` "Everything" section, and `npm run dev:mobile` |
| First run | Connect needs two devices and a phone build | Two-tab dev harness (Phase 5.5) |
| Real usage | The Convex contract lives in another tree from the phone | `docs/connect-contract.md` + typed `@allegra/convex` alias (Phase 0.4) |
| Debug | Silent sync or command failures | `ack` with a reason, the error table in §6, `lastError` in `session.view()`, dev logging behind `__DEV__` / `NODE_ENV` |
| Upgrade | Old APKs vs a new backend | All server changes additive; old clients just don't appear as devices |

| Dimension | Score | What gets it to 10 |
|---|---|---|
| Getting started | 7/10 | One root command that starts API + web + Metro (later) |
| API design | 8/10 | `ConnectSession` has 6 methods, with seams covered by two real adapters |
| Error messages | 8/10 | The §6 table is the spec, with an ack reason on every failure |
| Documentation | 7/10 | The contract doc plus the architecture section land in Phase 3/9 |
| Upgrade path | 8/10 | Additive-only server changes, and old fields kept for one release |
| Dev environment | 6/10 | Windows path fixed in Phase 0; a single `npm run check:all` is still to come |
| DX measurement | 5/10 | Transfer/sync counters (Phase 9) |
| **Overall** | **7/10** | Time to "it works" in the two-tab harness is under 5 min |

## Implementation Tasks
- [ ] **T1 (P1)** — Phase 0: move the repo, move CI, aliases, merge the import branch
- [ ] **T2 (P1)** — Phase 1: `songRef` + `origin_id`
- [ ] **T3 (P1)** — Phase 2: phone Google sign-in
- [ ] **T4 (P1)** — Phase 3: Convex Connect backend + contract doc
- [ ] **T5 (P1)** — Phase 4: `packages/connect` + behaviour tests
- [ ] **T6 (P1)** — Phase 5: web integration + two-tab harness
- [ ] **T7 (P1)** — Phase 6: phone integration
- [ ] **T8 (P1)** — Phase 7: `LibraryStore` + migration + ops/changes routes
- [ ] **T9 (P1)** — Phase 8: like ≠ download, phone sync engine, first-sign-in sheet, plays and Quick picks
- [ ] **T10 (P2)** — Phase 9: copy, limits, telemetry, docs, rollout
- [ ] **T11 (P3)** — v2: FCM push to wake a closed phone; device rename; iOS pass; root `check:all`

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | DONE (triage, auto-accepted) | 5 friction points, all folded into phases |

- **VERDICT:** DX review done in triage mode. Eng review required before Phase 3.

NO UNRESOLVED DECISIONS
