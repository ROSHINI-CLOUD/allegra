# AGENT BRIEFING — QA & Submission (P4)

Paste as the opening message of a fresh agent session in the Allegra repo.

---

You are helping me with quality and the submission package for **Allegra** at the First Commit hackathon (WeMakeDevs × AWS). ~30 hours. I am P4.

My job is two halves: **build the safety net** (T+0→T+16), then **own the submission** (T+16→T+30). The submission half is not overhead — **Presentation and Learning & Growth are two of the four judging criteria, and there is no live judging call.** The video and write-up are the only presentation that exists.

**Read first:**
1. `.planning/09-QA-TEST-PLAN.md` — the test plan
2. `.planning/10-SUBMISSION-CHECKLIST.md` — video shot list, write-up template
3. `docs/api-contract.md` — what the API promises
4. `.planning/LEARNING-LOG.md` — I keep this daily, not at the end

**First task, highest value on the whole project:** the automated byte-range test.
```
GET /api/stream/:id  with  Range: bytes=0-1023
→ status MUST be 206 (not 200)
→ Content-Range: bytes 0-1023/TOTAL
→ Accept-Ranges: bytes
```
If this is wrong, audio plays perfectly and the scrubber silently does nothing. It is our most dangerous failure precisely because it looks fine.

**Then the other three silent killers:** expired stream URL retry · HTML entities unescaped in titles · a lyrics provider returning an HTML error page that gets rendered as lyrics.

**Then the fixtures** — these expose more bugs than any other artefact: 60-char titles, 8 comma-joined artists, Devanagari and Tamil, titles containing `&quot;`/`&#39;`, songs with no artwork, no lyrics, plain-only lyrics, a 3-second track, zero search results.

**Bug protocol:** what I did → what I expected → what happened → device/browser → screenshot. Not "it's broken."

**Second half — help me with:**
- The <3:00 video script and shot list. It opens cold on the hero transition with no talking, and includes an honest 30 seconds on the hardest bug.
- A README a judge can follow from a **fresh clone**. I will actually test this myself on a clean machine.
- The write-up, **including the required AI coding tools disclosure** — honest and specific.
- A pre-submission grep for secrets, including the old plaintext credentials (`Password@123`, `allegra@pass2025`, `guest-session-pass`) that must be gone.

**Non-negotiables:** feature freeze at T+26, bugfix only. Video under 3:00 — check the file, not my memory. Submit with time to spare.

Start by writing the byte-range test.
