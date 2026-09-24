# PROVIDER INTEGRATION — the essentials

> The checked-in source and [`api-contract.md`](./api-contract.md) are authoritative. Keep this page
> aligned with provider code; do not rely on an external or untracked backend specification.

This page is the on-call summary.

## Layers

| Layer | Provider | Key? | Browser-callable? |
|---|---|---|---|
| 1 | **JioSaavn** (unofficial) — catalog, metadata, audio URL | No | ❌ server-side only |
| 2 | **Gaana** (unofficial) — fallback catalog | No | ❌ |
| — | **iTunes Search** — 1000×1000 artwork | No | ✅ (we proxy anyway, for consistency) |
| — | **LRCLIB** — synced lyrics | No | ✅ |
| — | **Lyrica / BetterLyrics** — lyrics fallback | Optional | ❌ server-side only |
| — | **MyMemory** — lyrics translation | No | ❌ server-side only |
| — | **LibreTranslate** — self-hosted translation fallback | No managed key | ❌ server-side only |

## Non-negotiable details

**1. `BROWSER_HEADERS` on every Saavn/Gaana call.** Cloudflare bot protection. Without them you get intermittent 403s that look like random flakiness.
```js
{
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
}
```

**2. Gaana fires only on *zero results*** — not on error, not on timeout. A Saavn failure already returns `[]` from its own try/catch, so it cascades naturally.

**3. Quality selection**
```js
downloads.find(u => u.quality === '320kbps') || downloads[downloads.length - 1]
images.find(i => i.quality === '500x500')   || images[images.length - 1]
```

**4. HTML entities.** Saavn returns `&quot;`, `&amp;`, `&#39;`, `&#x27;` in titles and artists. Decode named, decimal **and** hex forms.

**5. Artist is two shapes.** `primaryArtists` (string) or `artists.primary[]` (array). Handle both → `"Unknown Artist"`.

**6. `playCount` may be a formatted string.** Strip non-digits. Force 0 for Gaana (incomparable scale, and we sort on it).

**7. Duration is SECONDS**, everywhere, on every provider.

**8. Stream URLs expire.** Store the **song id**, never the URL as identity. Re-resolve on 403/404.

**9. iTunes 1000×1000:** `artworkUrl100.replace('100x100bb','1000x1000bb')`. Two-pass — raw query, then a cleaned one (strip parens/brackets/`ft|feat|official|video|audio|lyrics`), then Saavn's 500×500 as last resort.

**10. Lyrics ladder:** LRCLIB `/get` (pass `duration` — it's the highest-signal cheap check) → LRCLIB `/search` → Lyrica and BetterLyrics fallback → interpolate plain text across the duration so the UI still scrolls.

**11. Translation and recommendations stay free.** MyMemory is the keyless translation primary;
an explicitly configured self-hosted LibreTranslate instance is fallback only. Recommendations rank
catalog suggestions with listener taste; neither feature calls an LLM or paid AI provider.

**12. Reject HTML in a lyrics body.** If it contains `<div` / `<html` / `<!DOCTYPE`, the provider served an error page. Fall through to the next tier. This guard exists because it happened in production.

**13. Permissive LRC regex.** `\d{1,2}` for **both** minutes and seconds, optional brackets and ms. Real-world LRC files are dirty — `[0:3.75]` happens.

## Timeouts
Saavn/Gaana **25 s** · iTunes **20 s** · LRCLIB **10 s**. Always `AbortController`. Every provider owns its try/catch and returns empty rather than throwing — that's what keeps the cascade alive.

## Caching — a correctness requirement, not an optimisation
One server IP serves the whole user base against rate-limited community providers.

| Key | TTL |
|---|---|
| `search:{q}` | 1 h |
| `song:{id}` | 6 h |
| `suggestions:{id}` | 24 h |
| `artwork:{title}:{artist}` | 30 d |
| `lyrics:{title}:{artist}:{duration}` | 30 d |
| **`lyrics:miss:{…}`** | **24 h — negative cache** |

Normalise keys: lowercase, trim, collapse whitespace. Add a circuit breaker — N consecutive failures skip that provider for M minutes, or one dead provider adds its full timeout to every request.

## Legal
Unofficial community APIs; licensed audio played outside a licensed player. Fine for a learning/hackathon project — which this is. **Say so in the README.** The `UnifiedSong` boundary is deliberately the seam where a licensed provider would swap in; that's the answer if a judge asks.
