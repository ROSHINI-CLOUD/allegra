# Remix Allegra — Backend Integration Spec & PRD

**Version:** 1.0
**Prepared for:** Allegra backend engineering
**Source of truth:** the provider stack currently running in production in **LuvLyrics** (React Native / Expo). Every endpoint, header, fallback rule and quirk in Part A is copied from working code, not invented.

---

## 0. TL;DR — what we're actually building

Allegra today is a **100% mocked front-end**. 30 hardcoded songs, `setInterval` faking playback progress, `localStorage` faking a user account, one song with lyric data.

We're replacing all of that with a **real backend** that does four jobs:

| Job | Provider | Key needed? |
|---|---|---|
| Song catalog + search + **streamable audio URL** | JioSaavn (unofficial API) | No |
| Catalog fallback when Saavn is empty | Gaana (unofficial API) | No |
| High-res cover art (1000×1000) | iTunes Search API | No |
| Lyrics — synced (LRC) then plain | Lyrica aggregator → LRCLIB → Genius | Only Genius |

The front-end changes from "render mock array" to "call our API." The backend is a thin, **aggressively cached normalization + proxy layer** in front of providers that are individually flaky.

**The single most important architectural point:** in LuvLyrics these providers are called *directly from the mobile app*. **That will not work in a browser.** Mobile has no CORS, no mixed-content rules, and no `Range`-request seeking problem. Allegra is a web app, so every one of these calls has to move server-side. That is the entire reason this backend exists. See **Part B**.

---

# PART A — The proven provider stack

This is exactly how LuvLyrics does it today. Treat it as reference implementation.

## A1. JioSaavn — catalog, metadata, and the audio URI

### Base URLs

LuvLyrics runs against a community-hosted instance:

```
https://jiosaavn-api-byprats.vercel.app/api
```

The canonical upstream project is **saavn.dev** (OpenAPI spec is checked into the LuvLyrics repo as `savnapi.json`), whose reference deployment is:

```
https://saavn.sumit.co
```

> **Do not ship against a public community instance.** Those Vercel deployments are rate-limited, frequently cold, and can vanish. **Self-host the saavn.dev API** (it's an open-source Hono/Node app, deploys to Vercel/Railway/Fly/Docker in minutes) and point `SAAVN_API_URL` at your own instance. Keep a public instance configured as `SAAVN_SECONDARY_API_URL` for emergency failover only.

### Endpoint surface (from the OpenAPI spec)

| Method | Path | Params | Use in Allegra |
|---|---|---|---|
| GET | `/api/search` | `query` (req) | Global omni-search (songs+albums+artists+playlists) → SearchPage |
| GET | `/api/search/songs` | `query` (req), `page`=0, `limit`=10 | **Primary search** |
| GET | `/api/search/albums` | `query`, `page`, `limit` | Search tabs |
| GET | `/api/search/artists` | `query`, `page`, `limit` | Search tabs |
| GET | `/api/search/playlists` | `query`, `page`, `limit` | Search tabs |
| GET | `/api/songs` | `ids` *or* `link` | Batch hydrate (library, recently-played) |
| GET | `/api/songs/{id}` | `id` (req) | **Refresh a stale/expired stream URL** |
| GET | `/api/songs/{id}/suggestions` | `id` (req), `limit`=10 | **"Made For You" / radio / autoplay queue** |
| GET | `/api/albums` | `id` *or* `link` | Album page |
| GET | `/api/artists` | `id`/`link`, `page`, `songCount`, `albumCount`, `sortBy`, `sortOrder`=desc | Artist page |
| GET | `/api/artists/{id}/songs` | `id`, `page`, `sortBy`=popularity, `sortOrder`=desc | Artist top tracks |
| GET | `/api/artists/{id}/albums` | `id`, `page`, `sortBy`, `sortOrder` | Artist discography |
| GET | `/api/playlists` | `id`/`link`, `page`=0, `limit`=10 | Curated rows on HomePage |

### Required headers — Cloudflare bypass

The upstream is behind Cloudflare bot protection. LuvLyrics sends spoofed browser headers on **every** Saavn/Gaana call. Without these you get intermittent 403s.

```js
const BROWSER_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) ' +
                'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
};
```

### Response shape

```jsonc
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "abc123XY",
        "name": "Song Title",               // sometimes `title` instead — handle both
        "duration": 245,                     // SECONDS, not ms
        "language": "hindi",
        "hasLyrics": true,                   // Saavn's own lyric flag — see A4 note
        "playCount": "12345678",             // string OR number; also seen as `play_count`
        "primaryArtists": "Artist A, Artist B",   // legacy string form
        "artists": { "primary": [{ "name": "Artist A" }] },  // newer object form
        "image": [
          { "quality": "50x50",   "url": "https://c.saavncdn.com/.../50x50.jpg" },
          { "quality": "150x150", "url": "..." },
          { "quality": "500x500", "url": "..." }
        ],
        "downloadUrl": [
          { "quality": "12kbps",  "url": "https://aac.saavncdn.com/.../12.mp4"  },
          { "quality": "48kbps",  "url": "..." },
          { "quality": "96kbps",  "url": "..." },
          { "quality": "160kbps", "url": "..." },
          { "quality": "320kbps", "url": "https://aac.saavncdn.com/.../320.mp4" }
        ]
      }
    ]
  }
}
```

### Selection rules (copy these exactly)

```js
// Best audio: prefer 320kbps, else the LAST entry (array is ascending quality)
const getBestDownload = (downloads = []) =>
  downloads.find(u => u.quality === '320kbps') || downloads[downloads.length - 1];

// Best image: prefer 500x500, else the LAST entry
const getBestImage = (images = []) =>
  images.find(i => i.quality === '500x500') || images[images.length - 1];
```

### Three gotchas that will bite you

1. **HTML entities.** Saavn returns `&quot;`, `&amp;`, `&#39;`, `&#x27;` inside `name` and artist fields. You **must** decode before storing/displaying. LuvLyrics ships a `decodeHtml()` that handles named entities plus decimal (`&#123;`) and hex (`&#x7B;`) numeric refs.

2. **Artist name lives in two places.** Older responses: `primaryArtists` (a comma-joined string). Newer: `artists.primary[]` (array of `{name}`). Handle both, fall back to `"Unknown Artist"`.

3. **`playCount` is sometimes a formatted string.** Strip non-digits before parsing:
   ```js
   parseInt(String(val).replace(/[^0-9]/g, '') || '0', 10)
   ```

### About the audio URL ⚠️ **read this twice**

The `downloadUrl[].url` is a **direct JioSaavn CDN link** (`*.saavncdn.com`). Properties:

- It's a progressive `.mp4`/AAC file — an `<audio>` element can play it directly.
- **It is not permanently stable.** Treat it as a short-lived handle. Always store the **song `id`**, never only the URL. Re-resolve via `GET /api/songs/{id}` whenever a playback attempt 403s/404s.
- **CORS:** the CDN does not send `Access-Control-Allow-Origin` for arbitrary origins. In an `<audio src>` tag that's usually tolerated (media elements are CORS-exempt for plain playback), **but** the moment you want a **Web Audio API visualizer** — which Allegra's `Visualizer.tsx` will want if we make it real — you need `crossOrigin="anonymous"` and **then CORS is enforced and it breaks.** This is the #1 reason we need the audio proxy in **C4**.
- **Seeking** requires HTTP `Range` support. The CDN does support it; **your proxy must forward `Range` and pass through `206 Partial Content`, `Content-Range`, `Accept-Ranges`.** Get this wrong and the scrubber silently dies.

### Timeouts

LuvLyrics wraps every Saavn/Gaana call in a **25-second** `Promise.race` timeout (`'TIMEOUT'` sentinel error). Vercel cold starts are real.

---

## A2. Gaana — catalog fallback (Layer 2)

```
https://gaanaapibyprats.vercel.app/api
```

**Identical response shape** to the Saavn API — the same mapper function handles both, only the `source` tag differs (`'Saavn'` vs `'Gaana'`). Same `BROWSER_HEADERS`, same 25s timeout.

**Trigger rule — this is narrower than people assume:**

> Gaana is called **only when Saavn returns exactly zero results.** Not on Saavn error, not on timeout, not on partial results. A Saavn network failure returns `[]` from its own try/catch, which then naturally cascades into the Gaana attempt.

```js
let results = await searchSaavn(query);
if (results.length === 0) {
  results = await searchGaana(query);   // Layer 2
}
```

`playCount` is **forced to 0** for Gaana results (Gaana's counts aren't comparable to Saavn's, and we sort on it).

### Result filtering & ranking

```js
// 1. Drop anything with no playable URL
results = results.filter(s => s.downloadUrl);

// 2. Optional artist narrowing (bidirectional substring, case-insensitive)
if (artistName) {
  const a = artistName.toLowerCase();
  results = results.filter(s =>
    s.artist.toLowerCase().includes(a) || a.includes(s.artist.toLowerCase())
  );
}

// 3. Sort: authentic first, then by play count desc
results.sort((a, b) =>
  a.isAuthentic !== b.isAuthentic ? (a.isAuthentic ? -1 : 1)
                                  : (b.playCount || 0) - (a.playCount || 0)
);
```

---

## A3. iTunes Search API — cover art

**No API key. No auth. Free. Generous CORS.** The single most reliable provider in the stack.

```
GET https://itunes.apple.com/search
      ?term={query}
      &media=music
      &entity=song
      &limit={5|20}
```

### The 1000×1000 trick

iTunes returns `artworkUrl100` (a 100×100 thumbnail). The artwork host will serve **any** dimension you ask for via simple string substitution:

```js
const highRes = item.artworkUrl100.replace('100x100bb', '1000x1000bb');
```

This is the entire reason LuvLyrics uses iTunes instead of Saavn's own art — Saavn caps at 500×500, iTunes gives 1000×1000 (and `2000x2000bb` works too if you want retina/hero art for Allegra's full-screen player).

### The cleaned-query retry (important for Indian catalogs)

iTunes tokenizes badly on the noisy titles that Saavn returns. LuvLyrics does a **two-pass** search:

```js
// Pass 1: raw
let urls = await searchItunes(`${song.title} ${song.artist}`);

// Pass 2: cleaned, only if pass 1 was empty and the cleaned string differs
if (urls.length === 0) {
  const clean = t => t
    .replace(/\([^)]*\)/g, '')                                    // (From "Movie")
    .replace(/\[[^\]]*\]/g, '')                                   // [Official Video]
    .replace(/\b(ft|feat|featuring|official|video|audio|lyrics)\b.*/gi, '')
    .trim();
  urls = await searchItunes(`${clean(song.title)} ${clean(song.artist)}`);
}

// Pass 3: fall back to Saavn's own 500x500
if (urls.length === 0 && song.highResArt) urls = [song.highResArt];
```

Return the **full array**, not just `[0]` — LuvLyrics shows the user a picker. Allegra should do the same in a future "fix artwork" affordance, and meanwhile just take index 0.

**Timeout:** 20s.

---

## A4. Lyrics — the fallback ladder 🎯

This is the most valuable part of this document. Getting lyrics right is *hard*, and LuvLyrics has a battle-tested ladder.

### Tier 0 — the aggregator (primary)

LuvLyrics calls one service that itself fans out to LRCLIB, YouTube Music, Genius and JioSaavn:

```
GET https://test-0k.onrender.com/lyrics/
      ?artist={artist}
      &song={title}
      &timestamps={true|false}
      &fast={true|false}
      &metadata=true
      &duration={seconds}          // optional but strongly improves matching
```

> ⚠️ That's a free Render instance — **cold starts take 30+ seconds**, which is why the client timeout is **45 s**. It is fine as a reference but is **not** production infrastructure for Allegra. Either self-host the equivalent or implement the fan-out yourself (Tier 1/2 below give you everything you need).

### The 3-strategy ladder

Tried **in order**, first non-empty wins:

| # | `timestamps` | `fast` | Label | Meaning |
|---|---|---|---|---|
| 1 | `true` | `false` | `synced-slow` | Deep search for **time-synced LRC**. Slowest, best result. |
| 2 | `true` | `true` | `synced-fast` | Quick synced lookup. |
| 3 | `false` | `false` | `plain` | Unsynced plain text. Last resort. |

A `syncedOnly` mode filters the ladder down to steps 1–2 (used by the "force synced" re-scan in the UI).

### Query cleaning before the request

```js
let cleanSong = song
  .replace(/\(Lyrics\)/gi, '')
  .replace(/\(Official.*?\)/gi, '')
  .replace(/\(MP3_\d+K\)/gi, '')
  .replace(/\(Audio\)/gi, '')
  .trim();

let cleanArtist = artist === 'Unknown Artist' ? '' : artist;

// If artist unknown and title looks like "Artist - Title", split it
if (!cleanArtist && cleanSong.includes(' - ')) {
  const parts = cleanSong.split(' - ');
  cleanArtist = parts[0].trim();
  cleanSong   = parts.slice(1).join(' - ').trim();
}
```

### Response normalization — **four** shapes to handle

The aggregator returns `{ status: 'success', data: { ... } }` where `data.lyrics` arrives in one of four forms. Normalize all four to a single **LRC string**:

1. **Already an LRC string** → use as-is.
2. **`data.timestamped`** present when `data.lyrics` is empty → use that.
3. **`data.timed_lyrics` is an array** of `{ start_time (ms), text }` → format to LRC.
4. **`data.lyrics` is a JSON string** that parses to that same array → parse, then format.

LRC formatter used in all array cases:

```js
const ms = line.start_time || 0;
const m  = Math.floor(ms / 60000);
const s  = Math.floor((ms % 60000) / 1000);
const cs = Math.floor((ms % 1000) / 10);
const stamp = `[${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}]`;
return `${stamp} ${line.text || ''}`;
```

### Hard rejection rules

- **Reject HTML.** If the body contains `<div`, `<html`, or `<!DOCTYPE`, the provider served an error page or a scrape artifact. Return `null` and fall through to the next strategy. *(This guard exists because it actually happened in production.)*
- **404 → `null`, not an error.** A 404 means "this strategy has nothing," so continue the ladder. Any other non-2xx throws and aborts.
- **Unparseable JSON that starts with `[{"`** → treat as `null`.

### Metadata harvest

Also pull from the response — Allegra should use these to correct its own metadata:

```js
{
  title:    data.data.track_name  || data.data.title,
  artist:   data.data.artist_name || data.data.artist,
  duration: data.data.duration?.seconds || data.data.duration,
  coverArt: data.data.album_art
}
```

---

### Tier 1 — LRCLIB (direct, free, no key, **excellent CORS**)

```
https://lrclib.net/api
```

Docs: `https://lrclib.net/docs`

| Endpoint | Params |
|---|---|
| `GET /api/get` | `track_name`, `artist_name`, `album_name`?, `duration`? |
| `GET /api/search` | `q` **or** any of `track_name` / `artist_name` / `album_name` |

`/get` is precise (404 when no exact match); `/search` is fuzzy and returns an array. **Strategy: try `/get` first with duration, fall back to `/search`.**

Response:

```jsonc
{
  "id": 12345,
  "trackName": "…", "artistName": "…", "albumName": "…",
  "duration": 245,
  "instrumental": false,
  "plainLyrics":  "line\nline\n…",
  "syncedLyrics": "[00:12.34] line\n[00:15.67] line\n…"   // "" when unsynced
}
```

**Headers:** LRCLIB asks for an identifying User-Agent. LuvLyrics sends `LuvLyrics/1.0 (Mobile; Android)`. Use `Allegra/1.0 (+https://your-domain)`. **Timeout 10s** (via `AbortController`).

**This is the best tier to build Allegra on.** Free, no key, real CORS headers, huge synced-LRC corpus, and it has a **contribution endpoint** (`POST /api/publish`) if you ever want to give back.

---

### Tier 2 — Genius (API search + HTML scrape)

Two-step, because the Genius API returns song *URLs*, not lyrics.

**Step 1 — search:**
```
GET https://api.genius.com/search?q={query}
Authorization: Bearer {GENIUS_ACCESS_TOKEN}
```
Returns `response.hits[].result` → `{ id, title, url, primary_artist.name, song_art_image_thumbnail_url }`. Timeout 10s.

If no token is configured, **skip the provider silently** — it's optional, not fatal.

**Step 2 — scrape the page:**
```js
// Modern Genius: many blocks. Attribute-only selector survives class-name churn.
const containerRegex = /<div[^>]*data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/gi;

// Legacy fallback
const legacy = /<div[^>]*class="lyrics"[^>]*>([\s\S]*?)<\/div>/i;
```

Then, in order: strip `<script>`/`<style>`/comments → `<br>` and `</p>`/`</div>` become `\n` → strip remaining tags → decode entities → drop pollution lines:

- `^\d+ contributors?$`
- any line matching `/\bcontributor(s)?\b/i` under 80 chars
- `/\btranslations?\b/i`
- `^embed$`, `^\d*\s*embed$`, `^you might also like$`

Finally collapse `\n{3,}` → `\n\n`. Timeout 15s. **Genius is always plain (unsynced)** — never expect timestamps here.

> Scraping is brittle by nature and sits in a grey area with Genius's ToS. Keep it as a last-resort tier, keep the selector attribute-only, and make it trivially disable-able via env flag.

---

### Tier 3 — JioSaavn's own `hasLyrics`

Saavn song objects carry `hasLyrics: boolean`. Currently LuvLyrics **surfaces the flag but doesn't fetch from it.** If you want a fourth tier, `/api/songs/{id}` on some saavn.dev builds returns a `lyrics` object. Worth a spike; don't depend on it.

---

### LRC parsing — the two paths

**Path 1 — has timestamps.** Regex `\[(\d{2}):(\d{2})\.(\d{2,3})\]` → seconds. The production parser is deliberately permissive (`\d{1,2}` for both minutes and seconds, optional brackets/parens, optional ms) because real-world LRC files are dirty — `[0:3.75]` happens.

```js
const timestamp = minutes * 60 + seconds + milliseconds / 1000;
```
Empty text after stripping the stamp → emit `[INSTRUMENTAL]` so the UI can render a music-note pulse instead of a blank line.

**Path 2 — plain text → interpolate.** This is what makes Allegra's `LyricsPanel` still auto-scroll on unsynced lyrics:

```js
const safeDuration = duration > 0 ? duration : 180;
const timePerLine  = safeDuration / meaningfulLines.length;
lines.forEach((text, i) => out.push({ timestamp: i * timePerLine, text, lineOrder: i }));
```

It's not accurate, but it beats a static wall of text, and it means **one** rendering path in the UI instead of two.

Always re-index `lineOrder` after parsing.

Detector used everywhere:
```js
const hasTimestamps = (s) => /\[\d{2}:\d{2}\.\d{2,3}\]/.test(s);
```

---

### SmartLyricMatcher — the 0–100 scoring model

When multiple candidates come back, rank them. Weights:

| Signal | Points | Rule |
|---|---|---|
| **Title similarity** | 30 / 15 | Dice coefficient (`string-similarity`) > 0.8 → 30; > 0.5 → 15 |
| **Is synced** | 20 | `syncedLyrics` non-empty |
| **User-supplied lyric snippet** | 0–40 | `round(similarity × 40)` comparing first 500 chars, lowercased. Only when the user pasted >50 chars |
| **Duration match** | 10 / 5 | `abs(Δ) ≤ 2s` → 10; `≤ 10s` → 5 |

Capped at 100. `matchReason` is a `' • '`-joined human string (`"Title match • Synced • Exact duration"`) shown in the picker UI. Sort descending.

**Duration is the highest-signal cheap check.** Always pass `duration` to LRCLIB and the aggregator — it's what separates the real track from a cover, a remix, or a sped-up edit.

---

## A5. The normalization contract

Everything above collapses into **one** shape. Allegra's front-end should never see a provider-specific field.

```ts
interface UnifiedSong {
  id: string;
  title: string;          // HTML-decoded
  artist: string;         // HTML-decoded, comma-joined
  highResArt: string;     // iTunes 1000x1000, else Saavn 500x500
  downloadUrl: string;    // best-quality stream URI (proxied — see C4)
  hasLyrics: boolean;
  source: 'Saavn' | 'Gaana';
  duration: number;       // SECONDS
  playCount: number;      // 0 for Gaana
  language?: string;
  isAuthentic?: boolean;  // ranking hint
}

interface LyricLine {
  timestamp: number;      // SECONDS (float). 0 across all lines ⇒ unsynced
  text: string;           // '[INSTRUMENTAL]' for empty stamped lines
  lineOrder: number;      // 0-based, re-indexed after parse
}
```

---

# PART B — Why the mobile approach can't be pasted into a web app

Read this before writing any code. Four hard blockers:

### B1. CORS 🚫
React Native's `fetch` has **no origin and no preflight**. A browser does. Of our providers:

| Provider | Browser-callable? |
|---|---|
| iTunes Search | ✅ Yes, sends permissive CORS |
| LRCLIB | ✅ Yes |
| JioSaavn API (community/self-hosted) | ⚠️ Only if **you** add the CORS header — another reason to self-host |
| JioSaavn CDN audio | ❌ No ACAO for arbitrary origins |
| Genius API + page scrape | ❌ No. Scraping from a browser is impossible anyway |

➡️ **All provider calls move server-side.** The browser talks only to Allegra's own API.

### B2. Secrets 🔑
`GENIUS_ACCESS_TOKEN` and any Spotify secret **cannot** live in a Vite bundle — `import.meta.env.VITE_*` is shipped to the client in plaintext. This is exactly the mistake already sitting in Allegra's `AppContext.tsx` (hardcoded `Password@123` and friends — **scrub those before the repo goes public**, and rotate anything real).

### B3. `Range` requests & the scrubber 🎚️
Seeking an `<audio>` element issues `Range: bytes=N-`. A naive proxy that does `fetch(url).then(r => r.body.pipe(res))` returns `200 OK` with the whole file and **seeking breaks silently** — the user drags the scrubber and nothing happens. Forward `Range`, return `206`, pass through `Content-Range` / `Accept-Ranges` / `Content-Length`.

### B4. Rate limits & cold starts ⏱️
Public Vercel/Render instances cold-start in 10–45s and rate-limit by IP. From mobile that's N users × N IPs. From a server it's **one IP for your whole user base** — you *will* get throttled. **Caching is not an optimization here, it's a correctness requirement.**

---

# PART C — Backend architecture for Allegra

## C1. Shape

`express` is already in Allegra's `package.json` (currently unused). Recommended: **Node 20 + Express + TypeScript**, deployed separately from the Vite static build.

```
allegra-api/
├── src/
│   ├── index.ts                  # express app, CORS, helmet, rate-limit
│   ├── routes/
│   │   ├── search.ts
│   │   ├── songs.ts
│   │   ├── lyrics.ts
│   │   ├── stream.ts             # audio proxy  ← the critical one
│   │   ├── artwork.ts
│   │   ├── auth.ts
│   │   └── library.ts
│   ├── providers/
│   │   ├── saavn.ts              # Layer 1  (Part A1)
│   │   ├── gaana.ts              # Layer 2  (Part A2)
│   │   ├── itunes.ts             # artwork  (Part A3)
│   │   ├── lrclib.ts             # lyrics T1 (Part A4)
│   │   └── genius.ts             # lyrics T2 (Part A4)
│   ├── lib/
│   │   ├── normalize.ts          # → UnifiedSong (Part A5)
│   │   ├── lrc.ts                # LRC parse + plain-text interpolation
│   │   ├── matcher.ts            # SmartLyricMatcher scoring
│   │   ├── decodeHtml.ts
│   │   ├── cache.ts              # Redis (prod) / node-cache (dev)
│   │   └── fetchWithTimeout.ts   # AbortController wrapper
│   └── db/                       # Postgres + Prisma (or SQLite for v1)
└── .env
```

## C2. REST contract — what Allegra's front-end calls

> Every response: `{ success: boolean, data: T | null, error?: string }`. Never leak provider errors to the client; log them, return a friendly string (LuvLyrics has a `getLyricsFriendlyError()` mapping network/timeout/404/429/5xx → human copy — port it).

### Catalog

```http
GET /api/search?q={query}&type=songs&limit=20&page=0
→ { success, data: { results: UnifiedSong[], source: 'Saavn'|'Gaana' } }
```
Runs the Layer 1 → Layer 2 cascade, normalization, ranking. **Cache 1h.**

```http
GET /api/songs/:id            → { success, data: UnifiedSong }   # cache 6h
GET /api/songs?ids=a,b,c      → { success, data: UnifiedSong[] } # batch hydrate
GET /api/songs/:id/suggestions?limit=15
                              → { success, data: UnifiedSong[] } # cache 24h
```

```http
GET /api/home
→ { success, data: { trending: UnifiedSong[], madeForYou: [], recommended: [] } }
```
Backs Allegra's three `MusicCarousel` rows. v1: back it with curated Saavn playlist IDs (`/api/playlists?id=…`). **Cache 1h.** v2: personalize from `recentlyPlayed` + `/suggestions`.

### Artwork

```http
GET /api/artwork?title={t}&artist={a}&limit=5
→ { success, data: { urls: string[] } }
```
Two-pass iTunes + Saavn fallback (A3). **Cache 30 days** — artwork basically never changes.

### Lyrics ⭐

```http
GET /api/lyrics?songId={id}&title={t}&artist={a}&duration={s}&syncedOnly=false
→ {
    success: true,
    data: {
      source: 'LRCLIB' | 'Genius' | 'Lyrica(synced-slow)' | …,
      type: 'synced' | 'plain',
      matchScore: 0-100,
      matchReason: 'Title match • Synced • Exact duration',
      lines: LyricLine[],       // pre-parsed — the browser should NOT parse LRC
      raw: string               // original LRC, for debugging/export
    }
  }
```

**Server runs the whole ladder:** LRCLIB `/get` → LRCLIB `/search` → aggregator (3 strategies) → Genius → interpolated-plain. Scores candidates, returns the winner. **Cache aggressively — 30 days on a hit, 24h on a miss** (negative caching matters; lyric misses are repeat-queried constantly).

```http
GET /api/lyrics/search?title={t}&artist={a}&duration={s}
→ { success, data: SearchResult[] }   # all candidates, score-ranked
```
Powers a "wrong lyrics? pick another" UI. Mirrors LuvLyrics' `LrcSearchModal`.

### Audio ⭐⭐ — see C4

```http
GET /api/stream/:songId          # supports Range
```

### User (replaces the localStorage fiction)

```http
POST /api/auth/register   { email, password, displayName }
POST /api/auth/login      { email, password }  → { token, user }
POST /api/auth/guest                           → { token, user:{isGuest:true} }
GET  /api/auth/me

GET/POST/PATCH/DELETE  /api/libraries[/:id]
POST/DELETE            /api/libraries/:id/songs
GET/POST/DELETE        /api/me/liked
GET/POST               /api/me/recently-played
GET/PATCH              /api/me/settings
GET/POST/DELETE        /api/me/recent-searches
```

`bcrypt` (cost ≥ 12) + JWT, short-lived access + refresh. **Guest mode = a real anonymous user row + JWT**, so guests get server-side persistence and can be upgraded to a full account later without losing their library. Don't reproduce the current fake-auth pattern.

## C3. Caching — non-negotiable

| Key | TTL | Why |
|---|---|---|
| `search:{q}:{type}:{page}` | 1 h | Same queries repeat constantly |
| `song:{id}` | 6 h | Metadata stable; **stream URL is not** — see C4 |
| `suggestions:{id}` | 24 h | Expensive, rarely changes |
| `artwork:{title}:{artist}` | 30 d | Immutable in practice |
| `lyrics:{title}:{artist}:{duration}` | 30 d | Expensive ladder, immutable result |
| `lyrics:miss:{…}` | 24 h | **Negative cache.** Stops hammering 5 providers for a song nobody has lyrics for |
| `home:*` | 1 h | |

Redis in prod. Normalize keys: lowercase, trim, collapse whitespace, strip punctuation — or your hit rate will be terrible.

Add a **provider circuit breaker**: after N consecutive failures, short-circuit that provider for M minutes and go straight to the next tier. Otherwise one dead Render instance adds 45s to every single lyrics request.

## C4. The audio proxy — the make-or-break endpoint

```
GET /api/stream/:songId
```

Flow:
1. Look up `songId` → cached `downloadUrl`. Cache miss/expired → `GET {SAAVN}/api/songs/{id}`, re-select best quality.
2. Forward the client's `Range` header upstream **verbatim**.
3. Send `BROWSER_HEADERS` upstream.
4. Stream the body back; mirror `Content-Type`, `Content-Length`, `Content-Range`, `Accept-Ranges`, and the upstream status (**`206` must stay `206`**).
5. Set `Access-Control-Allow-Origin: {ALLEGRA_ORIGIN}` and `Cross-Origin-Resource-Policy: cross-origin` so Web Audio / `crossOrigin="anonymous"` works.
6. On upstream `403`/`404`: **re-resolve the song once** (URL expired), retry, then fail.

```ts
// Sketch — Node 20 native fetch
router.get('/stream/:songId', async (req, res) => {
  const url = await resolveStreamUrl(req.params.songId);   // cache → saavn → refresh
  const range = req.headers.range;

  const upstream = await fetch(url, {
    headers: { ...BROWSER_HEADERS, ...(range ? { Range: range } : {}) }
  });

  if (upstream.status === 403 || upstream.status === 404) {
    const fresh = await resolveStreamUrl(req.params.songId, { force: true });
    return pipeStream(fresh, range, res);
  }

  res.status(upstream.status);                              // 200 or 206 — preserve it
  for (const h of ['content-type','content-length','content-range','accept-ranges']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  Readable.fromWeb(upstream.body).pipe(res);
});
```

**Do not buffer the whole file into memory.** Stream it. A 320kbps 5-minute track is ~12 MB; 100 concurrent listeners buffered = 1.2 GB and a dead container.

> **Bandwidth warning:** every byte of audio now flows through your server. Budget for it, or (better) have the proxy issue a **short-lived signed redirect** for the non-visualizer case and only true-proxy when the client asks for CORS-clean audio. Plan it now, not after the first bill.

## C5. Data model (v1)

```
users              id, email, password_hash, display_name, is_guest, created_at
libraries          id, user_id, name, description, is_public, cover_url, created_at
library_songs      library_id, song_id, position, added_at
songs_cache        id (saavn id), title, artist, album, duration, art_url,
                   language, play_count, source, raw_json, fetched_at
lyrics_cache       song_id, source, type ('synced'|'plain'), lines_json,
                   raw, match_score, fetched_at
liked_songs        user_id, song_id, liked_at
recently_played    user_id, song_id, played_at, play_duration
user_settings      user_id, stream_quality, download_quality, crossfade,
                   gapless, equalizer_json, data_saver
recent_searches    user_id, query, searched_at
```

`songs_cache` is what makes libraries/liked/recent survive a provider outage — you own the metadata, you only re-fetch the stream URL.

## C6. Environment

```bash
# Server
PORT=8080
NODE_ENV=production
ALLEGRA_ORIGIN=https://allegra.app          # CORS allowlist

# Catalog
SAAVN_API_URL=https://your-saavn.your-domain.com/api    # SELF-HOST THIS
SAAVN_SECONDARY_API_URL=https://saavn.sumit.co/api      # failover
GAANA_API_URL=https://gaanaapibyprats.vercel.app/api    # layer 2

# Lyrics
LRCLIB_API_URL=https://lrclib.net/api
LYRICA_API_URL=                              # optional aggregator, self-hosted
GENIUS_ACCESS_TOKEN=                         # optional; blank = tier skipped
ENABLE_GENIUS_SCRAPE=false

# Infra
REDIS_URL=redis://…
DATABASE_URL=postgres://…
JWT_SECRET=                                  # 32+ random bytes
JWT_REFRESH_SECRET=

# Identity
OUTBOUND_USER_AGENT=Allegra/1.0 (+https://allegra.app)
```

Client side, **only** `VITE_API_BASE_URL` — nothing else. No token, no provider URL, no secret in the Vite bundle.

## C7. Legal / ToS — say it out loud once

The JioSaavn and Gaana APIs are **unofficial** reverse-engineered wrappers; Genius scraping is against Genius's ToS; the audio is licensed content being streamed outside a licensed player. This is fine for a **portfolio / learning / personal** project and is what LuvLyrics is. It is **not** a licensed commercial music service, and shouldn't be marketed as one or monetized (the "Premium" page should stay a UI demo). If Allegra ever goes commercial the catalog layer has to be swapped for a licensed provider — which is exactly why **Part A5's `UnifiedSong` normalization boundary matters**: it's the seam where you'd swap providers without touching the UI.

---

# PART D — Front-end changes in Allegra

| Today (mock) | After |
|---|---|
| `sampleData.ts` — 30 hardcoded songs | `GET /api/home` + `GET /api/search` |
| `setInterval` incrementing `currentTime` | Real `<audio ref>` + `timeupdate` event |
| Unsplash photos as "artwork" | `GET /api/artwork` → iTunes 1000×1000 |
| One song with lyric data | `GET /api/lyrics` → `LyricLine[]` |
| `localStorage` user | JWT + `GET /api/auth/me` |
| Libraries in Context only | `/api/libraries` (keep localStorage as offline cache) |
| Decorative `Visualizer.tsx` | Web Audio `AnalyserNode` on the proxied stream |

### Playback — the invariants LuvLyrics learned the hard way

LuvLyrics broke all three of these at least once. They're written into its `CLAUDE.md` as permanent rules, and they translate directly to a web `<audio>` implementation:

1. **One funnel for play/pause.** Every UI control calls a single `requestPlayback(playing)` action. Never `setIsPlaying(...)` *and* `audio.play()` from a component. The raw setter is reserved for syncing **from** the media element's own events.
2. **Audio-load effects must never depend on `isPlaying`.** A `useEffect` that lists `isPlaying` in its deps and calls `.play()` re-fires on the user's own pause and instantly resumes — pause appears to do nothing. Read play state imperatively inside the effect.
3. **Seek pauses playback. Always resume.**
   ```ts
   const wasPlaying = !audio.paused;
   audio.currentTime = t;
   if (wasPlaying) await audio.play();
   ```

Also port: **auto-next** on `ended`, plus a "within 0.35s of duration" fallback that **only fires when state says playing** (otherwise pausing near the end auto-advances).

### Lyrics rendering
The server returns parsed `LyricLine[]`, so `LyricsPanel` just binary-searches for the last line with `timestamp <= currentTime`. Both synced and interpolated-plain lyrics use that **same** path — that's the whole point of the interpolation fallback. Render `[INSTRUMENTAL]` as an icon, not text.

### Karaoke mode — an honest note
The vocal/instrumental sliders are currently cosmetic, and **real stem separation cannot be done client-side.** It needs Demucs/Spleeter on a GPU, ~10–60s per track, cached as separate files. Options: (a) keep it cosmetic and label it a visual mode, (b) build an offline pre-processing pipeline for a small curated set, (c) cut it from v1. **Recommend (c) for v1, (b) for v2.** Don't ship a slider that does nothing and call it a feature.

### Two cleanups before any of this
- **Scrub the plaintext credentials** in `AppContext.tsx` (`Password@123`) and `Pages.tsx` (`allegra@pass2025`, `guest-session-pass`) — and rotate them if they're real anywhere.
- **The display fonts** (Story Script, Jim Nightshade, Great Vibes, Average Sans) are referenced in `fontFamily` but never imported. Add the Google Fonts `<link>` or `@font-face`, or the branding is silently falling back to system fonts right now.

---

# PART E — PRD

## Goal
Turn Allegra from a mocked UI demo into a working music-streaming web app with real search, real audio playback, real high-res artwork, real time-synced lyrics, and real persistence.

## Non-goals (v1)
Licensed/commercial distribution · real payments · real stem separation · offline downloads · social features · native apps.

## Phases

### Phase 1 — Backend skeleton *(~1 week)*
Express + TS scaffold · Redis + Postgres · `/api/search` with Saavn→Gaana cascade · `UnifiedSong` normalization (HTML decode, artist dual-form, playCount parse) · caching layer · health check.
**Done when:** `GET /api/search?q=…` returns normalized, ranked, playable-URL-filtered results in <500 ms cached.

### Phase 2 — Audio ⭐ *(~1 week)*
`/api/stream/:songId` with full `Range` support · stream-URL refresh on 403/404 · CORS headers for Web Audio · front-end `<audio>` replacing the fake `setInterval` · the three playback invariants · auto-next.
**Done when:** a user searches, clicks a result, hears audio, **and the scrubber seeks correctly**. ← *the real acceptance test*

### Phase 3 — Artwork + Lyrics ⭐ *(~1.5 weeks)*
iTunes two-pass + 1000×1000 upgrade · full lyrics ladder (LRCLIB → aggregator → Genius → interpolated) · LRC parser (permissive) · SmartLyricMatcher scoring · 30-day + negative caching · `LyricsPanel` wired to real `LyricLine[]`.
**Done when:** ≥70% of top-100 Hindi/English tracks return **synced** lyrics; 100% return *something* (interpolated worst case).

### Phase 4 — Auth & persistence *(~1 week)*
bcrypt+JWT register/login/guest · libraries CRUD · liked · recently-played · settings · recent searches · localStorage becomes an offline cache, not the source of truth.
**Done when:** a user creates a library on one device and sees it on another.

### Phase 5 — Polish *(~1 week)*
`/api/home` personalization from suggestions · circuit breakers · rate limiting · friendly error copy · loading skeletons · Web Audio visualizer on real data · Premium page labelled a demo.

## Success metrics
Search p95 < 800 ms (cold) / < 200 ms (cached) · time-to-first-audio < 2 s · lyrics coverage ≥ 90%, synced ≥ 70% · seek success 100% · provider-failure user-visible error rate < 1%.

## Top risks

| Risk | Mitigation |
|---|---|
| Community Saavn instance dies | **Self-host it.** Keep secondary configured. Provider interface is swappable at `UnifiedSong`. |
| Stream URLs expire | Never store URL as identity — store `songId`, re-resolve on 403/404. |
| Audio bandwidth cost | Signed-redirect path for non-visualizer playback; true-proxy only when CORS-clean audio is needed. |
| Lyrics ladder latency (45s cold aggregator) | Circuit breaker + negative cache + put LRCLIB (fast, reliable) first. |
| Rate limiting on one server IP | Aggressive caching; self-hosted Saavn; back-off + jitter. |
| Genius scrape breaks on redesign | Attribute-only selector; env kill-switch; it's the last tier anyway. |

---

# PART F — Starter prompt

Paste this to whoever (or whatever) builds the backend.

````markdown
# Build the Allegra backend

## Context
I have a React 19 + TypeScript + Vite + Tailwind v4 music-streaming SPA called
**Allegra**. It's currently 100% mocked: 30 hardcoded songs, playback progress faked
with `setInterval`, auth and libraries faked in localStorage, one song with lyrics.

I need a real backend. The attached spec (`ALLEGRA_BACKEND_SPEC.md`) documents a
provider stack already proven in production in my React Native app **LuvLyrics** —
exact endpoints, headers, response shapes, fallback rules and known gotchas.
**Follow Part A literally; it's copied from working code, not guessed.**

## Stack
Node 20 · Express · TypeScript · Redis (cache) · Postgres + Prisma · JWT + bcrypt.
Deployed separately from the Vite static build.

## What to build

### 1. Provider layer (`src/providers/`) — per spec Part A
- `saavn.ts`   — Layer 1. Search/songs/suggestions/playlists. MUST send the
                 `BROWSER_HEADERS` (Cloudflare bypass) and use a 25s timeout.
- `gaana.ts`   — Layer 2. Identical response shape. Triggered **only when Saavn
                 returns exactly 0 results** — not on error, not on timeout.
- `itunes.ts`  — Artwork. Two-pass (raw query → cleaned query), and upgrade
                 `artworkUrl100` via `.replace('100x100bb','1000x1000bb')`.
- `lrclib.ts`  — Lyrics tier 1. `/get` (precise, pass `duration`) then `/search`.
                 Identifying User-Agent, 10s timeout, 404 → null not error.
- `genius.ts`  — Lyrics tier 2. API search + HTML scrape with the
                 **attribute-only** `data-lyrics-container` selector. Skip
                 silently when no token. Behind an env kill-switch.

### 2. Normalization (`src/lib/normalize.ts`) — spec Part A5
Everything becomes `UnifiedSong`. Non-negotiable details:
- **Decode HTML entities** in title/artist — named, decimal (`&#39;`) AND hex (`&#x27;`).
- Artist appears as `primaryArtists` (string) OR `artists.primary[]` (array) — handle
  both, default `"Unknown Artist"`.
- `playCount` may be a formatted string → strip non-digits. Force 0 for Gaana.
- Audio: prefer `320kbps`, else last array element. Image: prefer `500x500`, else last.
- Drop any result with no playable URL. Duration is in **seconds**.

### 3. Lyrics pipeline (`src/lib/lrc.ts`, `matcher.ts`) — spec Part A4 ⭐
- Ladder: LRCLIB `/get` → LRCLIB `/search` → aggregator (synced-slow →
  synced-fast → plain) → Genius → interpolated-plain.
- Clean the query first (strip `(Lyrics)`, `(Official …)`, `(Audio)`,
  `(MP3_320K)`; split `"Artist - Title"` when artist is unknown).
- Normalize **all four** response shapes to one LRC string.
- **Reject any body containing `<div` / `<html` / `<!DOCTYPE`** — that's an error
  page, fall through to the next tier. This is a real production bug guard.
- Permissive LRC regex (`\d{1,2}` minutes AND seconds, optional brackets/ms) —
  real files are dirty. Empty stamped line → `[INSTRUMENTAL]`.
- No timestamps → **interpolate** evenly across duration so the UI still
  auto-scrolls. One rendering path for both cases.
- Score candidates 0–100: title 30/15 · synced 20 · user-snippet 0–40 ·
  duration ±2s → 10, ±10s → 5. Return the winner + `matchReason` string.
- Return **pre-parsed `LyricLine[]`** — the browser must never parse LRC.

### 4. Audio proxy (`/api/stream/:songId`) — spec Part C4 ⭐⭐ THE HARD ONE
- Forward the client's `Range` header verbatim; preserve upstream status
  (**`206` stays `206`**) and `Content-Range` / `Accept-Ranges` / `Content-Length`.
  Getting this wrong makes the scrubber silently dead — it's the acceptance test.
- Send `BROWSER_HEADERS` upstream.
- On upstream 403/404 the stream URL expired: re-resolve via
  `GET /api/songs/{id}` **once**, retry, then fail.
- Set CORS + `Cross-Origin-Resource-Policy: cross-origin` so Web Audio works.
- **Stream, never buffer.**

### 5. Caching (`src/lib/cache.ts`) — spec Part C3
Redis prod / node-cache dev. TTLs: search 1h · song 6h · suggestions 24h ·
artwork 30d · lyrics 30d · **lyrics-miss 24h (negative cache)**.
Normalize keys (lowercase/trim/collapse whitespace).
Add a **circuit breaker**: N consecutive provider failures → skip that provider
for M minutes. One dead instance must not add 45s to every request.

### 6. Auth + persistence — spec Part C2/C5
bcrypt (cost ≥12) + JWT access/refresh. **Guest = a real anonymous user row +
JWT**, upgradeable to a full account without losing their library.
CRUD for libraries, liked songs, recently-played, settings, recent searches.

### 7. Endpoints — spec Part C2
`/api/search` · `/api/songs/:id` · `/api/songs?ids=` · `/api/songs/:id/suggestions` ·
`/api/home` · `/api/artwork` · `/api/lyrics` · `/api/lyrics/search` ·
`/api/stream/:songId` · `/api/auth/*` · `/api/libraries*` · `/api/me/*`.
Uniform envelope `{ success, data, error? }`. Never leak provider errors —
map network/timeout/404/429/5xx to friendly copy.

## Rules
- **Self-host the saavn.dev API.** Don't ship against a public Vercel instance;
  put its URL in `SAAVN_API_URL` and keep a public one as secondary failover.
- **No secrets in the Vite bundle.** Client gets `VITE_API_BASE_URL` and nothing else.
- Every outbound call: explicit `AbortController` timeout, per-provider try/catch
  returning empty rather than throwing, so the cascade keeps working.
- TypeScript strict. Provider responses typed as narrow interfaces covering only
  the fields consumed.
- `.env.example` with every variable, no real values.

## Definition of done
1. Search a song → results in <500 ms cached.
2. Click it → audio plays **and the scrubber seeks correctly** (`206` verified
   in DevTools Network).
3. Cover art is 1000×1000 from iTunes.
4. Lyrics appear and highlight in time with playback.
5. Create a library, hard-refresh, log in elsewhere → it's still there.
6. Kill the Saavn provider → app degrades to Gaana without a client-visible error.

Start with Phase 1 + 2 from the spec (catalog + audio). Ship those before
touching lyrics or auth.
````

---

## Appendix — the four snippets worth copying verbatim

**1. Timeout wrapper** (used on every outbound call)
```ts
const createTimeout = (ms: number): Promise<never> =>
  new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), ms));

const res = await Promise.race([fetch(url, { headers }), createTimeout(25000)]) as Response;
```

**2. HTML entity decoder** (mandatory on all Saavn text)
```ts
const decodeHtml = (s: string) => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
```

**3. ms → LRC timestamp**
```ts
const toLrc = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const c = Math.floor((ms % 1000) / 10);
  return `[${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}]`;
};
```

**4. Plain-text interpolation** (so unsynced lyrics still scroll)
```ts
const safeDuration = duration > 0 ? duration : 180;
const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
const per = safeDuration / lines.length;
return lines.map((text, i) => ({ timestamp: i * per, text, lineOrder: i }));
```

---

*Compiled from the LuvLyrics production source: `MultiSourceSearchService.ts`, `LyricaService.ts`, `LrcLibService.ts`, `GeniusService.ts`, `ImageSearchService.ts`, `LyricsRepository.ts`, `SmartLyricMatcher.ts`, `stagingOrchestrator.ts`, `timestampParser.ts`, and the `savnapi.json` OpenAPI spec.*
