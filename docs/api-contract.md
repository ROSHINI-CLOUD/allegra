# API CONTRACT — frozen at T+1

> **The single most important document on this project.**
> Frontend builds against a mock of this. Backend builds toward it. Neither is ever blocked on the other.
>
> **To change it:** propose in the channel → update this file → both sides adapt. **Never a silent shape change.** A renamed field at hour 20 costs a night.

Base URL: `VITE_API_BASE_URL` (mock server in dev, the Render API in prod)

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
  /** Other release rows for the same recording (search / suggestions only). Never nested. */
  variants?: UnifiedSong[];
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
`→ { ok: true, version: string }` — Render health check.

### `GET /api/search`
`q` (required) · `limit`=20 · `page`=0
`→ ApiResponse<{ results: UnifiedSong[]; source: 'Saavn'|'Gaana' }>`
Empty results → `success: true` with `results: []`, **not** an error.
Cache 1 h. Budget: <800 ms cold, <200 ms cached.

**Recording collapse (2026-09-21):** the provider lists one row per release, so the
same song can appear ~20 times with different compilation covers. Search groups by
recording identity (title without bracketed trailers + sorted artists), elects one
canonical row per group, and attaches the rest as `variants`. Election order:
1. **Meaningful** `playCount` lead (near-ties within 2% / 2 000 plays count as equal —
   Saavn often stamps the same count on every compilation placement).
2. Prefer album name matching the song title (the official single) over editorial
   playlist placements.
3. Prefer a real primary artist over "Various Artists".
4. Prefer albums that are not shared across many different artists in the same
   result set.
Over-fetches from the provider so `limit` is filled after collapse when possible.
The UI may expose `variants` behind a small "N other versions" control — they are
never listed as separate top-level search hits.

### `GET /api/songs/:id` → `ApiResponse<UnifiedSong>` · cache 6 h
### `GET /api/songs?ids=a,b,c` → `ApiResponse<UnifiedSong[]>` · batch hydrate
### `GET /api/songs/:id/suggestions?limit=15` → `ApiResponse<UnifiedSong[]>` · cache 24 h
Same recording collapse as search — suggestions never return twenty copies of one song.

### `GET /api/home`
`→ ApiResponse<{ trending: UnifiedSong[]; madeForYou: UnifiedSong[]; recommended: UnifiedSong[] }>`
Cache 1 h. Fallback = hardcoded curated playlist IDs.

### `GET /api/artists/:name` → `ApiResponse<ArtistProfile>` · cache 6 h — added 2026-09-21
Additive endpoint (no existing shape changed). `name` is the lead artist as shown on a song. Resolves the name through the provider's artist search (exact match preferred), then returns `ArtistProfile` from `packages/shared/types.ts`: a real `image` (500×500 photo or `null`), `isVerified`, `followerCount`, optional `bio`, `songs` (most popular first, all playable), `albums` (with cover + year) and `similar` artists. `404` when no artist matches.
### `GET /api/artists/faces?names=a,b,c` → `ApiResponse<ArtistSummary[]>` · cache 24 h — added 2026-09-21
Up to 12 comma-separated names; returns `{ id, name, image }` for each one that has a photo. Unmatched names are simply omitted. Used for avatars on lists.

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
PATCH  /api/libraries/:id              { name?, description?, isPublic?, coverKey? }
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

`Library` is additive: optional `coverKey` (S3 object key) and derived `coverUrl` (CloudFront / public base + key). `coverUrl` is never persisted — the API adds it on read when uploads are configured. `PATCH` accepts `coverKey` from a prior `/api/uploads/sign` (must be under `covers/<userId>/<libraryId>/`) or `coverKey: null` to clear.

### `POST /api/ai/mood` ★ stretch
`{ prompt: string }` → `ApiResponse<{ queue: UnifiedSong[]; explanation: string }>`
**Not shipped.** The mood pills in the UI run a plain `/api/search` instead.

### `POST /api/ai/translate-lyrics` — shipped 2026-09-20
`{ title, artist, lines: LyricLine[], targetLanguage? = "English" }` (no auth required, same as `/api/lyrics`)
`→ ApiResponse<{ lines: LyricLine[]; provider: string }>`
Same `lines` length/order/timestamps as the request — only `text` changes, translated for **meaning**, not word-for-word. `[INSTRUMENTAL]` markers pass through unchanged. `provider` names whichever of the cascade actually answered (`gemini` | `openrouter` | `nvidia` | `groq` | `bedrock`) — surface it in the UI, it's a nice "how this works" detail.
`503` if no AI provider is configured at all. `502` if every configured provider failed or replied with something unparseable.

### `GET /api/ai/recommendations` — shipped 2026-09-20
`songId`? (current song, added to taste context if present) · requires `Authorization: Bearer <token>`
`→ ApiResponse<{ songs: UnifiedSong[]; provider: string; reasoning: string }>`
Infers taste from the caller's liked + recently-played songs, asks the AI cascade for search queries reflecting that taste, then runs those through the existing catalog search — every returned song is a real, playable catalog result, never AI-invented. Excludes songs already liked or recently played. `404` if the listener has no liked/recent/current song yet (nothing to infer from). `503` if no AI provider is configured.

Cascade for both: **Gemini → OpenRouter → NVIDIA → Groq → Bedrock**, first success wins. All optional — with none configured, both routes degrade to `503` and nothing else in the app is affected.

## Accounts, taste and sharing — additive, shipped 2026-09-21

Additive only: no existing shape changed. Every response uses `{ success, data, error? }`.

### Accounts (a guest can become an account without losing anything)

| Endpoint | Auth | Body → response |
|---|---|---|
| `POST /api/auth/register` | optional guest `Bearer` | `{ email, password (>=8), displayName? }` → `201 { token, userId }`. **Converts the caller's guest session into the account** (same `userId`, `isGuest` flips to false, likes/playlists/plays/taste kept). No/expired guest token → a fresh account. `400` bad email/short password, `409` email already registered. |
| `POST /api/auth/login` | optional guest `Bearer` | `{ email, password }` → `{ token, userId }`. If a guest token is sent and differs from the account, the guest's likes, playlists, recents and taste are **merged into the account**. `401` on any mismatch, with the same copy for "no such email" and "wrong password". |
| `GET /api/auth/me` | Bearer | → `{ userId, isGuest, createdAt, displayName?, email? }` (never the hash) |
| `PATCH /api/me/profile` | Bearer | `{ displayName }` → same profile. Empty string clears it. |

Passwords are stored as `scrypt$<salt>$<hash>` (Node `crypto.scrypt`, per-user salt). Sign-out is client-side: drop the token and call `POST /api/auth/anon`.

### Taste (what the app learns about a listener)

| Endpoint | Auth | Body → response |
|---|---|---|
| `GET /api/me/taste` | Bearer | → `{ topArtists: {name,score}[] (<=12), languages: {name,score}[] (<=5), signals: number, onboarded: boolean }` |
| `POST /api/me/taste/seed` | Bearer | `{ artists: string[] (<=30), languages: string[] (<=8) }` → same as `GET`. Onboarding: strong weight, sets `onboarded: true`. |
| `POST /api/me/taste/signal` | Bearer | `{ songId, seconds }` → `204`. How long a song was really listened to: `<10 s` counts against the artist, most of a song counts for them. |

Taste is also updated **automatically** by existing routes (it never fails them; a lookup error leaves taste unchanged): `POST /api/me/recently-played` (+0.3 when `playDuration` is 0, else by listened time), `POST /api/me/liked` (+3), `DELETE /api/me/liked/:songId` (−2), `POST /api/libraries/:id/songs` (+2). Scores decay ×0.985 on every signal, so recent listening outweighs old. Artist credits: headline artist full weight, featured artists half. `GET /api/ai/recommendations` now also sends the top artists/languages to the model.

### Sharing a playlist

| Endpoint | Auth | Body → response |
|---|---|---|
| `POST /api/libraries/:id/share` | Bearer (owner) | → `{ code, path: "#shared/<code>" }` (`201` first time, `200` after). Sets the playlist `isPublic: true`. The link is **live**: it points at the owner's playlist. |
| `DELETE /api/libraries/:id/share` | Bearer (owner) | → `204`. Link stops working immediately; `isPublic: false`. |
| `GET /api/shared/:code` | **none** | → `{ code, name, description?, coverUrl?, ownerName, songs: UnifiedSong[] }`. `404` if the code is unknown, malformed, or sharing was turned off. |
| `POST /api/shared/:code/save` | Bearer | → `201 LibraryRecord`. Copies the playlist into the caller's own library (`isPublic: false`, new id). |

Codes are 8 characters from `abcdefghjkmnpqrstuvwxyz23456789`.

### Playlist cover uploads — additive, shipped 2026-09-21

| Endpoint | Auth | Body → response |
|---|---|---|
| `POST /api/uploads/sign` | Bearer (owner) | `{ libraryId, contentType: "image/jpeg"\|"image/png"\|"image/webp", contentLength }` → `{ uploadUrl, coverKey, coverUrl, headers: { "Content-Type", "Content-Length" }, expiresInSeconds }`. Browser `PUT`s the bytes straight to `uploadUrl` with those exact headers, then `PATCH /api/libraries/:id` with `{ coverKey }`. `400` if type/size invalid (`contentLength` 1..2 MB). `503` if S3 is not configured. No AWS keys ever reach the browser. |

## Errors

| HTTP | When | `error` copy |
|---|---|---|
| 400 | Bad params | "Something's missing from that request." |
| 401 | Wrong email/password, or no session | "That email and password did not match." / "Please start a guest session first." |
| 404 | Not found | "We couldn't find that." |
| 409 | Email already registered | "That email already has an account. Try signing in instead." |
| 429 | Rate limited | "Too many requests — give it a moment." |
| 502 | All providers down | "Music service is having a moment. Try again shortly." |
| 504 | Timeout | "That took too long. Check your connection and retry." |

## Mock server
P3 stands this up at T+2 from this document. P2 develops against it and **flips one env var** when the real API is live. That's the whole integration.
