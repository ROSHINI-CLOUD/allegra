# 11 — RISK REGISTER & CUT LIST

> Agreed **now**, while everyone is calm and rested. At 3 AM you don't get to renegotiate.

## Risks

| # | Risk | P | Impact | Mitigation | Trigger → action |
|---|---|---|---|---|---|
| R1 | **Seek silently broken** (`206`→`200`) | High | Demo-killing | Automated range test in the first 4 h | Fails → P1 + P3 stop everything |
| R2 | **Nothing deployed until late** | High | **Loses Ship It entirely** | URL live by T+6 even if it renders "hello" | Not live at T+8 → P3 drops all else |
| R3 | Community Saavn instance dies | Med | Blocks everything | Self-host, secondary configured, provider interface swappable | Flaky → switch to secondary; both dead → demo against cache |
| R4 | Stream URLs expire mid-judging | Med | Embarrassing | Store `id`, re-resolve on 403/404 | — |
| R5 | Rate-limited (one server IP) | Med | Intermittent failures | Aggressive + negative caching, circuit breaker | 429s → raise TTLs |
| R6 | App Runner won't cooperate | Med | Delays Ship It | **Time-box to 90 min**, then EC2 + Caddy | T+8 not live → switch, no debate |
| R7 | Hero transition janks on mobile | Med | Hurts Best UI | transform/opacity only; profile on a real phone | <50 fps → simplify to crossfade + blur |
| R8 | Lyrics coverage poor for regional tracks | Med | Weak demo | Interpolated fallback; **pick demo songs with confirmed synced lyrics** | — |
| R9 | **Video rushed** | **High** | **Loses Presentation** | Film at T+22, hard freeze T+26 | Not filming at T+24 → freeze features immediately |
| R10 | Integration breaks late | Med | Chaos | Frozen contract + shared types + contract tests | Contract change → doc first, announce, both adapt |
| R11 | Builder Center verification not done | Low | **Eligibility** | Do it at T+0 | Not verified T+4 → escalate to organisers |
| R12 | Secrets committed | Low | Public repo | P4 greps pre-submission; SSM not `.env` | Found → rotate **and** purge history |
| R13 | Scope creep | **High** | Everything | This document | Anything not in `01-GOAL.md` must-ship → no |

**R1, R2 and R9 are the three that actually lose hackathons.** They are all preventable by doing the boring thing early.

## Cut list — in this exact order

1. ★ Bedrock AI feature
2. Library persistence → in-memory
3. `/api/home` → one hardcoded playlist ID
4. Gaana fallback → Saavn only
5. Lyrics → LRCLIB `/get` only (no `/search`, no interpolation)
6. Suggestions / autoplay queue
7. Queue sheet UI
8. Web Audio visualizer → keep the decorative canvas

## Never cut

| | Why |
|---|---|
| **The deployed URL** | Ship It scores zero without it, and an undeployed app is invisible |
| **Audio playback + seek** | It's a music player. This is the product. |
| **Motion polish on the ONE screen in the video** | Best UI is our track |
| **The <3:00 video** | Presentation is a quarter of the score |
| **The AI tools disclosure** | It's a rule |

## Decision log

Append as you go — this is raw material for both the write-up and Technical Understanding.

| T+ | Decision | Why | Who |
|---|---|---|---|
| | | | |
