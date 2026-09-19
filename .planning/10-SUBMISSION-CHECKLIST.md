# 10 — SUBMISSION (P4 owns)

> **There is no live judging call. Only what you submit gets evaluated.**
> The video and the write-up *are* your presentation. There is no chance to explain in person, no follow-up question you get to answer. Two of the four judging criteria — **Presentation** and **Learning & Growth** — live entirely in this document's deliverables.

## Deliverables

| # | Item | Owner | Due |
|---|---|---|---|
| 1 | Public GitHub repo | P3 | T+0 |
| 2 | Demo video, **under 3:00** | P4 | T+28 |
| 3 | Write-up, **naming the AI coding tools** | P4 | T+28 |
| 4 | README a judge can follow to run it | P4 + P3 | T+27 |
| 5 | Live AWS URL | P3 | T+6, kept alive |
| 6 | Learning log | All, daily | continuous |

---

## 🎬 The demo video — shot list

**Start filming at T+22. Not T+29.** You will need at least two takes, and the first one is always too long.

**Budget: 170 seconds. Leave 10 seconds of headroom under the 3:00 limit.**

| Time | Shot | Notes |
|---|---|---|
| 0:00–0:12 | **Cold open — the hero transition.** No talking. Card → full player, music audible. | Lead with the best thing you built. Do not open with a title card. |
| 0:12–0:25 | Who you are, what Allegra is, in one sentence | "We turned a mocked music-app UI into a live streaming app on AWS." |
| 0:25–0:55 | **Live demo on the deployed URL.** Search → play → **drag the scrubber** → lyrics syncing | Show the real URL in the address bar. Drag the scrubber deliberately — it proves the hardest part works. |
| 0:55–1:20 | The interface: reduced-motion toggle, a phone view, a long-title card, the lyric click-to-seek | This is your Best UI argument. Show craft, don't claim it. |
| 1:20–1:50 | **Architecture diagram**, narrated. Amplify → App Runner → DynamoDB. **Why App Runner and not Lambda.** | The clearest 30 seconds you can give the Technical Understanding score. |
| 1:50–2:20 | One hard problem, honestly: the `206` byte-range bug. What broke, how you found it, how you fixed it | Judges reward a real debugging story over a feature list. This beats another feature demo. |
| 2:20–2:45 | What each of you learned. **One sentence each, four faces.** | Learning & Growth is a named criterion. Say the words. |
| 2:45–2:50 | The live URL on screen, held still | Let them read it |

**Rules:** record at 1080p, capture real audio from the app (not a voice-over over a silent screen), show the URL bar, **never show localhost**. Speak over the demo rather than cutting to talking heads — screen time is the scarce resource.

**Don't:** open with a logo animation · read your feature list aloud · apologise for what isn't finished · run over 3:00.

---

## ✍️ The write-up

```markdown
## Allegra
One sentence: what it is.

## The problem
Allegra existed as a beautiful but entirely mocked front-end — 30 hardcoded songs,
playback faked with a timer, accounts faked in localStorage. We made it real.

## What we built
- Real catalog and audio from a multi-provider pipeline with automatic fallback
- Time-synced lyrics with a graceful degradation path
- A motion system built around continuity — elements transform rather than cut
- Deployed on AWS: Amplify → App Runner → DynamoDB

## Architecture
[diagram]
Why App Runner over Lambda: the audio proxy needs HTTP byte-range streaming,
which is straightforward in a long-lived HTTP server and genuinely awkward in Lambda.

## Hardest problem
Seeking silently did nothing. The proxy was collapsing the upstream 206 Partial
Content into a 200 with the whole body, so the browser had no byte-range to seek
within. Audio played perfectly, which is what made it hard to spot. Fixed by
forwarding the Range header and preserving the upstream status and Content-Range.

## What each of us learned
- P1: …
- P2: …
- P3: …
- P4: …

## AI coding tools used          ← REQUIRED BY THE RULES
- <tool>: <what it did — e.g. scaffolding provider clients, drafting tests>
- We reviewed, ran and own every line committed.

## Known limitations
- Audio proxies through our server; wouldn't scale without a signed-redirect path
- Karaoke mode is a visual mode — real stem separation needs GPU processing
- Unofficial community APIs; this is a learning project, not a licensed service

## Live: <url>    Repo: <url>
```

**The AI disclosure is a rule, not a formality. Write it honestly.** A specific, honest disclosure reads as confidence. A vague one invites doubt about the rest.

---

## 📄 README

A judge must be able to clone and run it. Include: one-line description · screenshot or GIF of the hero transition · live URL · architecture diagram · **setup that actually works from a fresh clone** · `.env.example` · what's real vs demo (karaoke, premium) · the legal note · team + roles · AI tools.

**P4 must personally do a fresh clone and follow their own README.** Every team believes their README works. Most don't.

---

## Final gate — all four, 60 minutes out

- [ ] Live URL works **from a phone on mobile data**
- [ ] Repo public, `main` green
- [ ] Fresh clone + README → runs
- [ ] Video **under 3:00** (check the file)
- [ ] Write-up names the AI tools
- [ ] No secrets in the repo
- [ ] Learning log committed
- [ ] **Submitted with time to spare** — never in the last 10 minutes
