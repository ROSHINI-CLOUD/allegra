# LuvLyrics Desktop — Product Requirements Document

**Version:** 1.1  
**Date:** 2026-05-16  
**Status:** Ready for Development

---

## 1. Overview

LuvLyrics Desktop is a **Windows Electron companion app** for the LuvLyrics mobile app.  
It does two things:

1. **Remote control** — control your phone's music playback from your laptop (play/pause, skip, volume, lyrics, audio source switching) over the same WiFi network.
2. **Remote download** — search for songs on the desktop and send them to the phone to download. The phone runs the download through its own existing pipeline and stores the song in its library. No file transfer between devices needed.

Think Spotify Connect + a download manager, but fully local, no internet required (other than the song download itself from the source).

---

## 2. Mobile App Reference

**Repo path:** `c:\Users\nithy\Desktop\apps\LuvLyricsApp\LuvLyrics`

The desktop app must feel like a natural extension of the mobile app. Match the design system exactly.

### 2.1 Design Tokens (copy these into the Electron app)

```ts
// Colors — from src/constants/colors.ts
background:     '#000000'   // True Black
card:           '#1C1C1E'   // Dark Gray
cardHover:      '#2C2C2E'
textPrimary:    '#FFFFFF'
textSecondary:  '#AAAAAA'
textMuted:      '#666666'
accent/primary: '#7f13ec'   // Purple — brand color
accentBlue:     '#3EA6FF'
divider:        '#2C2C2E'
border:         '#3A3A3C'
lyricCurrent:   '#FFFFFF'
lyricPrevious:  'rgba(255,255,255,0.25)'
lyricUpcoming:  'rgba(255,255,255,0.35)'
success:        '#34C759'
error:          '#FF3B30'
warning:        '#FF9500'
overlay:        'rgba(0,0,0,0.7)'

// Typography — from src/constants/typography.ts
Font:           System (Segoe UI on Windows — closest to SF Pro)
Weights:        400 / 500 / 600 / 700
Sizes:          10 / 12 / 14 / 16 / 18 / 20 / 24 / 28 / 32 / 36 / 42px
Lyrics current: 34px bold
Lyrics others:  24px medium
Line height:    2.0 for lyrics, 1.5 for body

// Gradients — from src/constants/gradients.ts
24 gradient presets, same IDs (midnight, ocean, sunset, forest, fire, aurora, neon, etc.)
Default: deterministic gradient from song ID hash — same algorithm as mobile
```

### 2.2 Key Mobile Types (use same shape in desktop)

```ts
// from src/types/song.ts
interface LyricLine {
  timestamp: number;  // seconds
  text: string;
  lineOrder: number;
}

interface Song {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  gradientId: string;
  duration: number;
  lyrics: LyricLine[];
  coverImageUri?: string;
  audioUri?: string;
}

// from src/types/song.ts — used for download commands
interface UnifiedSong {
  id: string;
  title: string;
  artist: string;
  highResArt: string;
  downloadUrl: string;
  source: 'Saavn' | 'Wynk' | 'NetEase' | 'SoundCloud' | 'Audiomack' | 'Gaana';
  duration?: number;
}
```

### 2.3 Player State Shape (what the phone sends over WebSocket)

```ts
// Mirror of src/store/playerStore.ts
interface PlayerState {
  currentSong: Song | null;
  position: number;       // seconds
  duration: number;       // seconds
  isPlaying: boolean;
  volume: number;         // 0.0 to 1.0
  audioSource: 'phone' | 'desktop';
  queue: Song[];
  currentQueueIndex: number;
}
```

---

## 3. Architecture

```
┌─────────────────────────────────────┐       WiFi (same network)
│         PHONE (React Native)        │◄──────────────────────────────────►
│                                     │                                    │
│  ┌──────────────┐  ┌─────────────┐  │                 ┌──────────────────────────┐
│  │ WebSocket    │  │ HTTP File   │  │                 │   DESKTOP (Electron)     │
│  │ Server :8765 │  │ Server:8766 │  │                 │                          │
│  └──────────────┘  └─────────────┘  │                 │  ┌──────────────────┐   │
│  ┌──────────────┐                   │                 │  │ WebSocket Client │   │
│  │ mDNS         │                   │                 │  └──────────────────┘   │
│  │ _luvlyrics   │                   │                 │  ┌──────────────────┐   │
│  │ ._tcp.local  │                   │                 │  │ mDNS Discovery   │   │
│  └──────────────┘                   │                 │  └──────────────────┘   │
│                                     │                 │  ┌──────────────────┐   │
│  playerStore ──► broadcasts STATE   │                 │  │ Audio Player     │   │
│  downloadQueueStore ──► DOWNLOAD_   │                 │  │ (if source=desk) │   │
│    PROGRESS updates                 │                 │  └──────────────────┘   │
│  receives CMD ──► executes          │                 │  ┌──────────────────┐   │
└─────────────────────────────────────┘                 │  │ Search + Download │   │
                                                        │  │ Queue UI         │   │
                                                        │  └──────────────────┘   │
                                                        └──────────────────────────┘
```

### 3.1 Playback Control Protocol

**Phone → Desktop (state broadcast):**
```json
{
  "type": "STATE",
  "payload": {
    "currentSong": { "id": "...", "title": "...", "artist": "...", "gradientId": "...", "duration": 213 },
    "position": 47.3,
    "duration": 213,
    "isPlaying": true,
    "volume": 0.8,
    "audioSource": "phone",
    "lyrics": [{ "timestamp": 45.0, "text": "some lyric line", "lineOrder": 5 }]
  }
}
```

**Desktop → Phone (playback commands):**
```json
{ "type": "CMD", "action": "PLAY" }
{ "type": "CMD", "action": "PAUSE" }
{ "type": "CMD", "action": "NEXT" }
{ "type": "CMD", "action": "PREV" }
{ "type": "CMD", "action": "SEEK", "position": 92.5 }
{ "type": "CMD", "action": "SET_VOLUME", "volume": 0.6 }
{ "type": "CMD", "action": "SET_SOURCE", "source": "desktop" }
{ "type": "CMD", "action": "SET_SOURCE", "source": "phone" }
```

**Audio streaming (when source = desktop):**
- Desktop fetches `http://<phone-ip>:8766/audio` → streams the current song file
- Phone pauses its own audio output, continues sending STATE
- Desktop plays audio locally via Howler.js

### 3.2 Remote Download Protocol

**Key insight:** The desktop never downloads anything itself. It only sends a `UnifiedSong` object to the phone over WebSocket. The phone feeds it directly into its existing `DownloadManager.finalizeDownload()` pipeline (`src/services/DownloadManager.ts`) and `downloadQueueStore` (`src/store/downloadQueueStore.ts`) — exactly the same as if the user tapped Download on the phone. No file transfer between devices ever happens.

**Desktop → Phone (initiate download):**
```json
{
  "type": "CMD",
  "action": "DOWNLOAD",
  "song": {
    "id": "saavn_xyz123",
    "title": "Song Name",
    "artist": "Artist Name",
    "highResArt": "https://...",
    "downloadUrl": "https://...",
    "source": "Saavn",
    "duration": 213
  }
}
```

**Phone → Desktop (progress updates):**  
Mirrors the `QueueItem` shape from `src/store/downloadQueueStore.ts`.  
Status values: `pending | staging | downloading | completed | failed`

```json
{ "type": "DOWNLOAD_PROGRESS", "id": "saavn_xyz123", "progress": 0.1,  "status": "staging",     "stageStatus": "Fetching Lyrics..." }
{ "type": "DOWNLOAD_PROGRESS", "id": "saavn_xyz123", "progress": 0.45, "status": "downloading", "stageStatus": "Downloading Audio..." }
{ "type": "DOWNLOAD_PROGRESS", "id": "saavn_xyz123", "progress": 0.9,  "status": "downloading", "stageStatus": "Saving Lyrics..." }
{ "type": "DOWNLOAD_PROGRESS", "id": "saavn_xyz123", "progress": 1.0,  "status": "completed" }
{ "type": "DOWNLOAD_PROGRESS", "id": "saavn_xyz123", "progress": 0.3,  "status": "failed",      "error": "Network error" }
```

**Settings toggle (in phone's SettingsScreen):**  
`"Allow desktop to initiate downloads"` — when OFF, phone rejects all `DOWNLOAD` commands silently. Default: ON when Desktop Connect is enabled.

---

## 4. Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| App shell | **Electron** (latest) | Cross-platform, same JS/TS stack as mobile |
| UI framework | **React + TypeScript** | Same as mobile, reuse types |
| Styling | **CSS Modules or Tailwind** | No StyleSheet in Electron; match tokens manually |
| State | **Zustand** | Same library as mobile, familiar patterns |
| WebSocket client | **ws** or native `WebSocket` | Connect to phone's server |
| mDNS discovery | **bonjour-service** npm | Auto-find phone on network |
| Audio playback | **Howler.js** | Reliable, works well in Electron |
| Build/package | **electron-builder** | Produces `.exe` installer for Windows |
| Dev bundler | **Vite + electron-vite** | Fast HMR, TS support out of the box |

---

## 5. Screens and UI

### 5.1 Connection Screen (shown when not connected)
- LuvLyrics logo + purple accent (`#7f13ec`)
- "Searching for your phone..." spinner
- Auto-connects via mDNS when phone found
- Manual IP fallback input field
- Background: `#000000`

### 5.2 Now Playing Screen (main screen when connected)

```
┌─────────────────────────────────────────────────────┐
│  LuvLyrics          [↓ Download]    [Phone] [Desk]  │  ← nav + source toggle
│                                                      │
│         ┌─────────────────────┐                      │
│         │  Cover Art / Gradient                      │
│         │     (400×400)       │                      │
│         └─────────────────────┘                      │
│                                                      │
│         Song Title (bold, 28px)                      │
│         Artist Name (secondary, 18px)                │
│                                                      │
│    [─────────●──────────────────]                    │  ← seek bar
│    0:47                      3:33                    │
│                                                      │
│         [⏮]   [⏸]   [⏭]                            │  ← controls (48px icons)
│                                                      │
│    🔊 [───────●───────────────]                     │  ← volume
│                                                      │
│  ┌───────────────────────────────────────────────┐   │
│  │         Synchronized Lyrics                   │   │
│  │  previous line (25% opacity)                  │   │
│  │  ► CURRENT LINE (100%, 34px bold)             │   │  ← auto-scrolls
│  │  upcoming line (35% opacity)                  │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

- Gradient background from `gradientId` using same 24 presets as mobile
- Cover art fetched from phone's HTTP server at `:8766/cover`
- Lyrics panel scrolls in sync with `position` from STATE

### 5.3 Download Screen (accessed via "↓ Download" button in nav)

```
┌─────────────────────────────────────────────────────┐
│  ← Now Playing          Download to Phone           │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  🔍  Search songs...                         │    │  ← search bar
│  └─────────────────────────────────────────────┘    │
│                                                      │
│  Results                                             │
│  ┌────────────────────┐  ┌────────────────────┐     │
│  │ [Cover] Song Name  │  │ [Cover] Song Name  │     │  ← same grid card
│  │ Artist · 3:21      │  │ Artist · 4:05      │     │    design as mobile
│  │ [Saavn]  [↓ Send]  │  │ [NetEase] [↓ Send] │     │
│  └────────────────────┘  └────────────────────┘     │
│                                                      │
│  Download Queue (on phone)                           │
│  ┌─────────────────────────────────────────────┐    │
│  │ ▓▓▓▓▓▓▓░░░░  Song Name · 45%  Downloading   │    │
│  │ ▓▓▓▓▓▓▓▓▓▓▓  Other Song · Done  ✓           │    │
│  │ ░░░░░░░░░░░  Third Song · Waiting...        │    │
│  └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

- Search calls the same multi-source APIs the mobile app uses (Saavn, NetEase, etc.) — but from the desktop directly, no phone involvement for search
- "Send to Phone" button sends the `DOWNLOAD` command over WebSocket
- Queue panel shows live `DOWNLOAD_PROGRESS` updates from phone
- Source badge colors match mobile (`DownloadGridCard.tsx`): Saavn=green `#2ecc71`, NetEase=red `#e60026`, etc.

### 5.4 Mini / Taskbar Mode (Phase 6)
- Compact 300×80px overlay — always on top
- Shows song name + play/pause + next only
- Lives in system tray or screen corner

---

## 6. Phone-side Changes (in this repo)

These are the only changes needed in `LuvLyrics` (mobile):

| Task | File | What to add |
|---|---|---|
| WebSocket server | `src/services/DesktopBridgeService.ts` (new) | Start WS server on WiFi IP:8765 |
| HTTP file server | same file | Serve audio file at `:8766/audio`, cover at `:8766/cover` |
| mDNS broadcast | same file | Advertise `_luvlyrics._tcp.local` |
| Broadcast playback state | `src/store/playerStore.ts` | On every state change, send STATE to all connected clients |
| Handle playback commands | same service | Parse CMD messages, call `play()`, `pause()`, `seekTo()` from playerStore |
| Handle DOWNLOAD command | same service | Call `useDownloadQueueStore.getState().addToQueue([song])` — reuses existing pipeline |
| Broadcast download progress | `src/store/downloadQueueStore.ts` | On every queue item update, send DOWNLOAD_PROGRESS to all connected clients |
| Settings toggles | `src/screens/SettingsScreen.tsx` | "Desktop Connect" on/off + "Allow desktop downloads" on/off |

**Library to add to mobile:** `react-native-tcp-socket` (WebSocket + TCP server in RN)

---

## 7. Feature Phases

### Phase 1 — Phone server foundation
- [ ] `DesktopBridgeService` starts WebSocket server when on WiFi
- [ ] Broadcasts `STATE` on every playerStore change
- [ ] Accepts `PLAY`, `PAUSE`, `NEXT`, `PREV`, `SEEK`, `SET_VOLUME` commands
- [ ] mDNS advertisement (`_luvlyrics._tcp.local`)

**Deliverable:** Any WebSocket client (even browser dev tools) can connect and control the phone.

---

### Phase 2 — Desktop app shell + basic remote
- [ ] Electron + Vite + React + TypeScript scaffolded
- [ ] mDNS discovery finds phone automatically
- [ ] WebSocket client connects, receives STATE
- [ ] Renders song title + artist + play/pause status
- [ ] Play/pause/next/prev buttons send commands

**Deliverable:** Minimal working remote — connect, see what's playing, control it.

---

### Phase 3 — Full Now Playing UI
- [ ] Seek bar synced to position, draggable to seek
- [ ] Volume slider → sends SET_VOLUME
- [ ] Gradient background from `gradientId` (same 24 presets)
- [ ] Cover art fetched from `:8766/cover`
- [ ] Synchronized lyrics panel — scrolls in sync with `position`

**Deliverable:** Full remote that feels identical to the mobile Now Playing screen.

---

### Phase 4 — Audio source switching
- [ ] Phone serves current song file at `:8766/audio`
- [ ] "Play here" → desktop fetches file, plays via Howler.js, sends `SET_SOURCE desktop`
- [ ] Phone mutes when `audioSource = desktop`
- [ ] "Play on phone" → `SET_SOURCE phone`, phone unmutes, desktop stops
- [ ] Volume works regardless of active source

**Deliverable:** True Spotify Connect equivalent — switch audio between phone speaker and laptop speaker.

---

### Phase 5 — Remote download
- [ ] Phone handles `DOWNLOAD` command → calls `downloadQueueStore.addToQueue()` (existing logic, zero new download code)
- [ ] Phone sends `DOWNLOAD_PROGRESS` updates as queue item status changes
- [ ] Desktop Download Screen: search bar calls multi-source APIs directly
- [ ] Results grid — same card design as `DownloadGridCard.tsx` on mobile
- [ ] "Send to Phone" button → sends DOWNLOAD command, adds to queue panel
- [ ] Queue panel shows live progress bars per song
- [ ] Settings toggles on phone: "Desktop Connect" + "Allow desktop downloads"

**Deliverable:** Search on laptop, one click, song downloads on phone and appears in library.

---

### Phase 6 — Polish
- [ ] System tray icon + mini player overlay (300×80px, always on top)
- [ ] Auto-reconnect when phone disconnects
- [ ] Windows installer (`.exe`) via electron-builder
- [ ] Keyboard shortcuts: `Space`=play/pause, `→`=+10s, `←`=-10s, `N`=next, `P`=prev
- [ ] Toast notifications: "Song downloaded to phone ✓"

---

## 8. Repo Structure (Desktop — new repo)

```
luv-lyrics-desktop/
├── electron/
│   ├── main.ts            # Electron main process
│   └── preload.ts         # Context bridge
├── src/
│   ├── App.tsx
│   ├── screens/
│   │   ├── ConnectionScreen.tsx
│   │   ├── NowPlayingScreen.tsx
│   │   └── DownloadScreen.tsx     # Search + send-to-phone + queue panel
│   ├── components/
│   │   ├── SeekBar.tsx
│   │   ├── VolumeSlider.tsx
│   │   ├── LyricsPanel.tsx        # Port of SynchronizedLyrics.tsx logic
│   │   ├── GradientBackground.tsx
│   │   ├── SongCard.tsx           # Matches DownloadGridCard.tsx design
│   │   └── DownloadQueuePanel.tsx # Shows DOWNLOAD_PROGRESS updates
│   ├── services/
│   │   ├── PhoneConnection.ts     # mDNS + WebSocket client
│   │   └── MusicSearchService.ts  # Calls Saavn/NetEase/etc. APIs directly
│   ├── store/
│   │   ├── playerStore.ts         # Read-only mirror of phone playerStore
│   │   └── downloadStore.ts       # Tracks active download queue from phone
│   └── constants/
│       ├── colors.ts              # Exact same tokens as mobile
│       ├── gradients.ts           # Exact same 24 gradients
│       └── typography.ts          # Exact same scale
├── package.json
├── electron-builder.yml
└── vite.config.ts
```

---

## 9. Non-Goals

- No cloud sync — everything is local WiFi only
- No internet dependency for playback — songs already downloaded on phone play fully offline
- Desktop does not store or manage any music files itself
- No Windows Media Player or system audio library integration
- Streaming-only (non-downloaded) songs play on phone as normal; desktop just controls them

---

## 10. Success Criteria

- [ ] Phone and desktop connect automatically within 5 seconds on same WiFi
- [ ] Play/pause/next/prev commands execute on phone within 200ms
- [ ] Lyrics scroll is within 500ms of phone's actual position
- [ ] Audio source switch (phone ↔ desktop) completes within 2 seconds
- [ ] "Send to Phone" download starts on phone within 1 second of clicking
- [ ] Download progress updates appear on desktop within 500ms of phone state change
- [ ] App works with no internet — WiFi only (except the song download from source)
