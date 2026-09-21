# 01 — GOAL

## ⏰ Timeline reality check

**First Commit (Bharat Builds Tour, WeMakeDevs × AWS) runs 17–20 September 2026.**

If you are reading this on **19 September**, you have **~30 working hours**, one of which is probably spent at the Bengaluru in-person venue (Polaris School of Technology, 8 AM–8 PM, optional).

> ⚠️ **Verify the exact submission cut-off on the official schedule page before you plan your last night.** The schedule page noted the precise time as "to be finalised," and everything in `03-DELIVERY.md` is expressed as **T+hours from your start**, not wall-clock, so it survives whatever the real deadline turns out to be. Put the confirmed deadline at the top of this file the moment you know it:
>
> **CONFIRMED DEADLINE: `____________`**

## What we're building

**Allegra** — a music-streaming web app with a real catalog, real audio, real time-synced lyrics, and a deliberately cinematic interface. It already exists as a fully mocked React 19 + Vite + Tailwind SPA. This hackathon turns the mock into a working, AWS-hosted product.

## What winning looks like

The event runs three tracks and **one submission is considered for all three**:

| Track | What it rewards | Our position |
|---|---|---|
| **Ship It** | Deployed live on AWS with a public URL. **The architecture is part of the score.** | Must-have. Non-negotiable. |
| **Build It** | The thing you actually built | Must-have. |
| **Best UI** | "The best-designed thing at the event, the one that is a pleasure to use." | 🎯 **This is our shot.** |

**Best UI is the track we are playing to win.** A music player is one of the few app categories where motion, depth and tactility are the product rather than decoration — and our team's strength is frontend. Everything else is built to a *sufficient* standard; the interface is built to an *exceptional* one.

That is a strategy, not an excuse. Ship It is a hard gate: an undeployed app scores nothing anywhere.

## Judging criteria (and who owns each)

| Criterion | What it actually measures | Owner |
|---|---|---|
| **Learning & Growth** | What you learned, how far you stretched | P4 — the learning log, kept daily |
| **Creativity** | Original idea, or an interesting solution | P2 + P1 — the motion system and the Bedrock feature |
| **Technical Understanding** | **Can you explain your own decisions?** | Everyone — you must be able to defend your own module |
| **Presentation** | How well you communicate the project and the journey | P4 — the <3 min video and the write-up |

Two of four criteria are about **communication**, not code. This is why one of four people owns the submission artifacts full-time and is not a luxury.

## Hard requirements (checklist)

- [ ] Public GitHub repo
- [ ] Demo video **under 3 minutes**
- [ ] Short write-up
- [ ] Write-up **names the AI coding tools used**
- [ ] `README.md` with setup instructions a judge can follow to run it
- [ ] Deployed on AWS with a live public URL (Ship It)
- [ ] Every member: WeMakeDevs account + AWS Builder Center profile with university enrollment verified
- [ ] Team of ≤ 4 ✅ (we are 4)
- [ ] All core work done **during** the hackathon window

> **On prior work:** the rules allow — and encourage — learning, planning and practice *before* the clock starts, but the project must be new once it opens. **These planning documents are exactly the permitted kind of preparation. The code is not.** Don't paste in a pre-existing codebase; the mocked Allegra shell should be re-created inside the window or be an explicitly-declared starting template. Check the current rules page on this point and say so plainly in the write-up either way — an honest note costs nothing, a surprise costs the submission.

- [ ] **No live judging call.** Only what is submitted gets evaluated. The video and write-up *are* the presentation — there is no chance to explain in person.

## Explicit non-goals

Licensed/commercial distribution · real payments · offline downloads · social features · native apps · an admin panel · full OAuth · always-on GPU inference · SageMaker/EKS for karaoke.

**Exception (2026-09-21):** on-demand **Sing** dual-stem separation via **AWS Batch Spot GPU** is in scope on branch `fe/karaoke-aws` (not Scarleta). It is lazy, cached once per song+source+model version, and disabled (503) until Batch env is configured. See `docs/karaoke-aws-decisions.md`.

## The one-sentence pitch

> *Allegra turns a static music-app mockup into a live, AWS-hosted streaming experience — real catalog, real audio, time-synced lyrics — wrapped in an interface designed to feel like an instrument rather than a list.*
