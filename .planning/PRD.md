# Allegra — product requirements

A music player for finding good music fast: search a song, press play, keep listening. Built as a
real product, not a demo. Originally a hackathon entry (First Commit, Sept 2026); that deadline is
over and this is now the live spec.

## Who it is for

Someone who wants to hear a specific song *now*, and then keep listening without managing anything.
Indian-language catalogue first (Hindi, Tamil, Telugu, Punjabi) alongside English, because that is
where the existing players are weakest at search.

## Principles

1. **Nothing between the listener and the music.** No sign-up wall, no onboarding quiz, no modal
   before the first play. Accounts exist to carry your library across devices, not to gate entry.
2. **Never ship a control that does nothing.** Anything demonstrative is labelled as such.
3. **Honest failure.** When a provider is down the app says so in plain language and keeps playing
   what it can. A user never sees a raw provider error.
4. **It must feel physical.** Motion is part of the product, not decoration — but it is always
   `transform`/`opacity` from a token, and `prefers-reduced-motion` collapses it to opacity without
   removing a feature.

## What it does

### Shipped

| Capability | Notes |
|---|---|
| Search and play | Collapses remasters and duplicate uploads; elects the canonical release rather than the loudest upload |
| Streaming with seek | Range requests preserved end to end (`206`), so scrubbing works on long tracks |
| Lyrics | Synced where available, with translation |
| Library | Likes, playlists, recently played, shareable playlist links |
| Taste | Learned from real listening time, not just taps; drives Home |
| Radio / suggestions | Continues past the end of a queue without repeating remasters |
| **Karaoke** | Real-time, on-device vocal reduction with a worker-first path and local fallback |
| **Google sign-in** | Via Convex Auth; guest data merges into the account on first sign-in |
| Real URLs | Every view is shareable: `/discover`, `/artist/[name]`, `/playlist/[id]`, `/shared/[code]` |

### Deliberately not real

- **Premium page** — a UI demo. No payments, labelled in the UI and the README.

### Not built

- Native apps, offline downloads, social features, collaborative playlists.

## Karaoke — the one genuinely hard feature

**Requirement.** A listener can reduce the voice in real time without uploading track audio, waiting
for a cloud job, or restarting the track.

**What that demands**

1. The browser worker starts near the playhead and keeps the existing audio element as the transport
   clock, so play/pause, seek, queue, and lyrics remain stable.
2. The model runs only on the listener's device. If WebGPU, WASM, memory, track size, or throughput
   is insufficient, a local mid-side reduction is the fallback; the app never silently sends audio
   to a third party.
3. The quality bar is an instrumental with tolerable vocal leakage and no severe damage to drums or
   bass. Validate across Hindi, Tamil, and English tracks, including duets and dense film mixes.

## Constraints

- **Vercel only.** One deployment serves the Next.js app and the Express API. No Render, no App Runner.
- **No AWS runtime or paid LLMs.** Karaoke stays on-device; recommendations use the catalog and
  listener taste; translation uses free machine-translation providers.
- **Convex owns identity and listener data.**
- **No secret may reach the browser.** `NEXT_PUBLIC_*` is public by definition.
- Accessible: keyboard reachable, visible focus, honest `aria` state, colour never the only signal.

## Done means

`npm run typecheck`, `npm run lint` and `npm test` are green; the byte-range rule and the three
playback invariants hold; and the change has been seen working in a browser — not only in tests.
