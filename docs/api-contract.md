# API CONTRACT — frozen at T+1

> **The single most important document on this project.**
> Frontend builds against a mock of this. Backend builds toward it. Neither is ever blocked on the other.
>
> **To change it:** propose in the channel → update this file → both sides adapt. **Never a silent shape change.** A renamed field at hour 20 costs a night.

Base URL: same-origin `/api`. `NEXT_PUBLIC_API_BASE_URL` is blank everywhere — in dev Next rewrites `/api` to the Express server, and on Vercel it is the Express function.

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
Called once on first load, token stored client-side and sent as `Authorization: Bearer`. Listening never needs an account.

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

`Library` is additive: optional `coverKey` (a Convex storage id) and derived `coverUrl`. `coverUrl` is
never persisted; the API resolves it from Convex on read. `PATCH` accepts the `coverKey` returned by
the authenticated cover-upload flow or `coverKey: null` to clear it.

### `POST /api/ai/mood` ★ stretch
`{ prompt: string }` → `ApiResponse<{ queue: UnifiedSong[]; explanation: string }>`
**Not shipped.** The mood pills in the UI run a plain `/api/search` instead.

### `POST /api/lyrics/translate`
`{ title, artist, lines: LyricLine[], targetLanguage? = "English", language? }` (no auth required)
`→ ApiResponse<{ lines: LyricLine[]; provider: string }>`
Same `lines` length/order/timestamps as the request; `[INSTRUMENTAL]` markers pass through unchanged.
MyMemory is the free keyless primary. A configured, self-hosted LibreTranslate instance is the
fallback; unmanaged public mirrors are never assumed. The legacy `/api/ai/translate-lyrics` path is
an alias for compatibility. `502` means both available providers failed.

### `GET /api/recommendations`
`songId`? (current song, added to taste context if present) · requires `Authorization: Bearer <token>`
`→ ApiResponse<{ songs: UnifiedSong[]; provider: string; reasoning: string }>`
Ranks the catalog's suggestions with the listener's liked/recent songs, artists, and languages. Every
result is a real playable catalog row, never an invented model result. Excludes already-liked or
recently played recordings. `404` means there is no listening context yet. The legacy
`/api/ai/recommendations` path is an alias for compatibility.

## Accounts, taste and sharing — additive, shipped 2026-09-21

Additive only: no existing shape changed. Every response uses `{ success, data, error? }`.

### Accounts — **changed 2026-09-22: Google via Convex Auth replaces email/password**

Two kinds of bearer token reach this API, and every route accepts either:

1. **Guest** — minted by `POST /api/auth/anon`, signed by the API (`JWT_SECRET`).
2. **Account** — minted by **Convex Auth** after Google sign-in. The browser gets it from Convex
   directly; the API verifies it against the deployment's published keys
   (`CONVEX_SITE_URL/.well-known/jwks.json`). **The API never sees a Google secret or a password.**

Convex Auth's subject is `<userId>|<sessionId>`; the profile is keyed on the `userId` half, so a
second device or a re-login is the same listener. The first time an account appears, the API creates
its profile and copies the name and email from Convex.

| Endpoint | Auth | Body → response |
|---|---|---|
| `POST /api/auth/link` | account `Bearer` | `{ guestToken }` → the account profile. Folds that guest's likes, playlists, recents and taste **into the account**. Idempotent (merging is a union). `400` without a guest token, `401` if the bearer is not a verified caller. |
| `GET /api/auth/me` | Bearer | → `{ userId, isGuest, createdAt, displayName?, email? }` |
| `PATCH /api/me/profile` | Bearer | `{ displayName }` → same profile. Empty string clears it. |

**Removed** (no longer routed; they answer `404`): `POST /api/auth/register`, `POST /api/auth/login`.
No stored password hashes remain — `passwordHash` is gone from the user record.

Sign-out is client-side: Convex clears its session, then the browser calls `POST /api/auth/anon` for a
fresh guest session.

### Taste (what the app learns about a listener)

| Endpoint | Auth | Body → response |
|---|---|---|
| `GET /api/me/taste` | Bearer | → `{ topArtists: {name,score}[] (<=12), languages: {name,score}[] (<=5), signals: number, onboarded: boolean }` |
| `POST /api/me/taste/seed` | Bearer | `{ artists: string[] (<=30), languages: string[] (<=8) }` → same as `GET`. Onboarding: strong weight, sets `onboarded: true`. |
| `POST /api/me/taste/signal` | Bearer | `{ songId, seconds }` → `204`. How long a song was really listened to: `<10 s` counts against the artist, most of a song counts for them. |

Taste is also updated **automatically** by existing routes (it never fails them; a lookup error leaves taste unchanged): `POST /api/me/recently-played` (+0.3 when `playDuration` is 0, else by listened time), `POST /api/me/liked` (+3), `DELETE /api/me/liked/:songId` (−2), `POST /api/libraries/:id/songs` (+2). Scores decay ×0.985 on every signal, so recent listening outweighs old. Artist credits: headline artist full weight, featured artists half. Recommendations consume this local taste context directly.

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
| `POST /api/uploads/sign` | Bearer (owner) | `{ libraryId }` → `{ uploadUrl, coverKey }`. The browser uploads the image to the short-lived Convex upload URL, then `PATCH`es the library with its `coverKey`. `503` if Convex is not configured. |

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
