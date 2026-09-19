# 09 — QA & TEST PLAN (P4 owns, P3 supports)

## Philosophy
In 30 hours you cannot test everything. So test **the things that fail silently** and **the things the demo video shows**. Everything else gets one manual pass.

## The four silent killers — automate these first

| # | Failure | Why it's dangerous | Test |
|---|---|---|---|
| **1** | **Seek returns `200` not `206`** | Audio plays fine, scrubber does nothing. **Invisible until someone drags it — possibly a judge.** | `curl -H "Range: bytes=100-200"` → assert status `206` + `Content-Range` |
| **2** | Stream URL expired | Works in dev, dead an hour later — including mid-judging | Assert `/stream/:id` retries once on 403 and still returns audio |
| **3** | HTML entities unescaped | A title like `Song Name `Tum Hi Ho &quot;Reprise&quot;` shipped to a judgequot;Reprise`Tum Hi Ho &quot;Reprise&quot;` shipped to a judgequot;` rendered raw in front of a judge | Fixture with `&quot;`, `&#39;`, `&#x27;` → assert decoded |
| **4** | Lyrics provider returns an error page | A wall of HTML rendered as lyrics | Feed a `<!DOCTYPE html>` body → assert it's rejected and falls through |

**Write test #1 in the first four hours.** It is the highest-value test on the project.

```ts
it('supports byte-range requests', async () => {
  const res = await fetch(`${API}/api/stream/${KNOWN_ID}`, {
    headers: { Range: 'bytes=0-1023' },
  });
  expect(res.status).toBe(206);                       // NOT 200
  expect(res.headers.get('content-range')).toMatch(/^bytes 0-1023\//);
  expect(res.headers.get('accept-ranges')).toBe('bytes');
});
```

## Contract tests (P3)
For every endpoint in `docs/api-contract.md`: does the live API return the documented shape? Run against **the deployed URL**, not localhost. This is what catches "works on my machine" before it costs an evening.

## Fixtures — build these early, they expose more bugs than any other artefact

| Fixture | Exposes |
|---|---|
| 60-character song title | Truncation, marquee, card overflow |
| 8 comma-joined artists | Line clamping, layout collapse |
| Devanagari (हिन्दी) + Tamil (தமிழ்) | Line-height clipping, font fallback |
| Title with `&quot;` `&amp;` `&#39;` | Entity decoding |
| Song with **no** artwork | Fallback design vs broken-image icon |
| Song with **no** lyrics | Empty state vs blank panel |
| Song with **plain** lyrics | The interpolation path |
| 3-second track | End-of-track / auto-next edge |
| Zero search results | Empty state copy |

## Manual matrix — once per phase

| Surface | Check |
|---|---|
| Search | Debounce, loading skeleton, empty state, error + retry |
| Play | Starts <2 s, correct track, artwork matches |
| **Seek** | **Drag → audio follows. In the deployed build.** |
| Pause | Actually pauses. **No phantom resume** (invariant 2) |
| Next / end | Auto-advances on end; does **not** advance when paused near the end |
| Lyrics | Highlight tracks audio, scroll is smooth, click-to-seek works |
| Hero transition | 60 fps on a real phone |
| Reduced motion | OS setting on → app still fully usable |
| Keyboard | Space, ←, →, Tab, visible focus |
| Offline | Toast, not a crash |

## Device sweep
360 (small Android) · 768 (tablet) · 1280 (laptop) · 1920 (desktop) — **and at least one real phone on mobile data.** Devtools lies about scroll behaviour, safe-area insets and `backdrop-filter` performance.

## Bug protocol
File as: **what you did → what you expected → what happened → device/browser → screenshot.** "It's broken" is not a bug report and will cost more time than it saves.

Severity: **S1** blocks the demo — everyone stops · **S2** visible in the video — fix before T+26 · **S3** cosmetic — fix only if free · **S4** log it in the write-up as known.

After **T+26 only S1 and S2 get touched.**

## Pre-submission gate (P4 runs personally)
- [ ] Fresh clone → follow the README exactly → it runs. **Actually do this. On a clean machine if possible.**
- [ ] Deployed URL works from a phone on mobile data
- [ ] `grep -riE "(password|secret|token|api[_-]?key)\s*[:=]\s*['\"]"` over the repo → clean
- [ ] The old plaintext credentials (`Password@123`, `allegra@pass2025`, `guest-session-pass`) are **gone**
- [ ] Repo is public
- [ ] Video is **under 3:00** (check the file, not your memory)
- [ ] Write-up names the AI tools
- [ ] Learning log committed
