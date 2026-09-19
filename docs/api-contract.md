# API CONTRACT — frozen at T+1

> **The single most important document on this project.**
> Frontend builds against a mock of this. Backend builds toward it. Neither is ever blocked on the other.
>
> **To change it:** propose in the channel → update this file → both sides adapt. **Never a silent shape change.** A renamed field at hour 20 costs a night.

Base URL: `VITE_API_BASE_URL` (mock server in dev, App Runner in prod)

## Envelope — every response

```ts
type ApiResponse<T> =
  | { success: true;  data: T }
  | { success: false; data: null; error: string };   // error is USER-FACING copy
```
Never leak provider errors. Map network / timeout / 404 / 429 / 5xx to friendly text server-side.

## Shared types — `packages/shared/types.ts`

```ts
export interface UnifiedSong {
  id: string;
  title: string;          // HTML entities already decoded
  artist: string;         // decoded, comma-joined
  album?: string;
  artwork: string;        // 1000x1000 when available
  streamUrl: string;      // ALWAYS our proxy: /api/stream/:id — never a CDN URL
  duration: number;       // SECONDS
  hasLyrics: boolean;
  language?: string;
  playCount: number;      // 0 for Gaana-sourced
  source: 'Saavn' | 'Gaana';
}

export interface LyricLine {
  timestamp: number;      // SECONDS (float). All-zero ⇒ unsynced
  text: string;           // '[INSTRUMENTAL]' for empty stamped lines
  lineOrder: number;      // 0-based, contiguous
}

export interface LyricsPayload {
  source: string;         // 'LRCLIB' | 'LRCLIB-search' | 'interpolated'
  type: 'synced' | 'plain';
  matchScore: number;     // 0-100
  matchReason: string;    // 'Title match • Synced • Exact duration'
  lines: LyricLine[];     // PRE-PARSED. The browser never parses LRC.
}
```

## Endpoints

### `GET /api/health`
`→ { ok: true, version: string }` — App Runner health check. Must exist before infra can deploy.

### `GET /api/search`
`q` (required) · `limit`=20 · `page`=0
`→ ApiResponse<{ results: UnifiedSong[]; source: 'Saavn'|'Gaana' }>`
Empty results → `success: true` with `results: []`, **not** an error.
Cache 1 h. Budget: <800 ms cold, <200 ms cached.

### `GET /api/songs/:id` → `ApiResponse<UnifiedSong>` · cache 6 h
### `GET /api/songs?ids=a,b,c` → `ApiResponse<UnifiedSong[]>` · batch hydrate
### `GET /api/songs/:id/suggestions?limit=15` → `ApiResponse<UnifiedSong[]>` · cache 24 h

### `GET /api/home`
`→ ApiResponse<{ trending: UnifiedSong[]; madeForYou: UnifiedSong[]; recommended: UnifiedSong[] }>`
Cache 1 h. Fallback = hardcoded curated playlist IDs.

### `GET /api/artwork`
`title`, `artist`, `limit`=5 → `ApiResponse<{ urls: string[] }>` · cache 30 d
Index 0 is the best guess; the array exists for a future "fix artwork" picker.

### `GET /api/lyrics` ⭐
`songId`?, `title` (req), `artist` (req), `duration`?, `syncedOnly`=false
`→ ApiResponse<LyricsPayload>`
No lyrics anywhere → `{ success: false, error: "No lyrics found for this song." }`
Cache 30 d on hit, **24 h on miss**.

### `GET /api/stream/:songId` ⭐⭐ — not JSON
Returns **audio bytes**.

| Request | Response |
|---|---|
| no `Range` | `200` + `Content-Type`, `Content-Length`, `Accept-Ranges: bytes` |
| `Range: bytes=N-M` | **`206`** + `Content-Range: bytes N-M/TOTAL` + `Accept-Ranges: bytes` |

Also sets `Cross-Origin-Resource-Policy: cross-origin` (needed for Web Audio).
**A `206` must never be collapsed to `200` — seeking dies silently.**
Frontend usage: `<audio src={`${API}/api/stream/${song.id}`} crossOrigin="anonymous" />`

### `POST /api/auth/anon`
`→ ApiResponse<{ token: string; userId: string }>`
Called once on first load, token stored client-side and sent as `Authorization: Bearer`. **No login screen.**

### Library — all require `Authorization: Bearer <token>`
```
GET    /api/libraries                  → ApiResponse<Library[]>
POST   /api/libraries                  { name, description?, isPublic? }
PATCH  /api/libraries/:id
DELETE /api/libraries/:id
POST   /api/libraries/:id/songs        { songId }
DELETE /api/libraries/:id/songs/:songId

GET    /api/me/liked                   → ApiResponse<UnifiedSong[]>
POST   /api/me/liked                   { songId }
DELETE /api/me/liked/:songId
GET    /api/me/recently-played
POST   /api/me/recently-played         { songId, playDuration }
GET/PATCH /api/me/settings
```

### `POST /api/ai/mood` ★ stretch
`{ prompt: string }` → `ApiResponse<{ queue: UnifiedSong[]; explanation: string }>`
Bedrock → search terms → hydrate. **Degrades to a plain search on any failure.**

## Errors

| HTTP | When | `error` copy |
|---|---|---|
| 400 | Bad params | "Something's missing from that request." |
| 404 | Not found | "We couldn't find that." |
| 429 | Rate limited | "Too many requests — give it a moment." |
| 502 | All providers down | "Music service is having a moment. Try again shortly." |
| 504 | Timeout | "That took too long. Check your connection and retry." |

## Mock server
P3 stands this up at T+2 from this document. P2 develops against it and **flips one env var** when the real API is live. That's the whole integration.
