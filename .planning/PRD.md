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
| **Sing (karaoke)** | Two AI-separated stems mixed locally; vocals slider from 0–100% |
| **Google sign-in** | Via Convex Auth; guest data merges into the account on first sign-in |
| Real URLs | Every view is shareable: `/discover`, `/artist/[name]`, `/playlist/[id]`, `/shared/[code]` |

### Deliberately not real

- **Premium page** — a UI demo. No payments, labelled in the UI and the README.

### Not built

- Native apps, offline downloads, social features, collaborative playlists.

## Sing — the one genuinely hard feature

**Requirement.** A listener can turn the voice down on any song and sing over it, without waiting on
anything after the first time, and without the app ever restarting the track.

**What that demands**

1. Two stems (`vocals`, `instrumental`) that are **sample-aligned**. A drift of even a second makes
   the feature unusable, so misaligned output fails the job rather than shipping quietly.
2. Moving a slider must **never** contact the network or run a model. It changes a gain value.
3. Entering Sing mode preserves position, play state, lyrics position, volume and queue. No restart.
4. A song is separated **once, ever**. Same song + same source + same model version reuses the stems,
   for every listener, forever.
5. Under load, 100 people pressing Sing on the same uncached song must produce **one** GPU job.

**Cost.** Target under ₹20 per ~4-minute song, ideally ₹1–5. Unverified until measured on real runs;
`docs/karaoke-aws-cost-benchmark.md` is deliberately empty until then. No cost number is ever
hardcoded into product behaviour.

**Quality.** The metric that matters is how the instrumental sounds with vocals at 0% — leakage,
metallic artefacts, damaged instruments. Secondary is how clean the isolated vocal is. To be judged by
listening across Tamil, Hindi and English material, male and female vocals, duets, heavy reverb,
backing vocals, dense film mixes and older recordings.

## Constraints

- **Vercel only.** One deployment serves the Next.js app and the Express API. No Render, no App Runner.
- **AWS is for karaoke only** (Batch, Spot GPU, S3, ECR, IAM, CloudWatch), plus optional Bedrock and
  a cache table. No always-on GPU. Capacity scales to zero.
- **Convex owns identity and listener data.**
- **No secret may reach the browser.** `NEXT_PUBLIC_*` is public by definition.
- Accessible: keyboard reachable, visible focus, honest `aria` state, colour never the only signal.

## Done means

`npm run typecheck`, `npm run lint` and `npm test` are green; the byte-range rule and the three
playback invariants hold; and the change has been seen working in a browser — not only in tests.
