# AGENT BRIEFING — Frontend & Motion (P2)

Paste as the opening message of a fresh agent session in the Allegra repo.

---

You are helping me build the frontend for **Allegra**, a music-streaming web app, for the First Commit hackathon (WeMakeDevs × AWS). ~30 hours. I am P2, the frontend and motion owner.

**We are playing to win the Best UI track**, described by the organisers as "the best-designed thing at the event, the one that is a pleasure to use." The interface is not decoration here — it is the competitive strategy.

**Read these first, in order:**
1. `.planning/07-MOTION-DESIGN-SYSTEM.md` — the motion spec. **Read before writing any animation code.**
2. `.planning/06-FRONTEND-PLAN.md` — my ticket list in build order
3. `docs/motion-recipes.md` — working code for the patterns
4. `docs/api-contract.md` — **frozen.** I build against the mock server until the real API is live.
5. `CLAUDE.md`

**Also invoke my skills where they apply** — they carry craft guidance this repo's docs only summarise:
`/curiosity-driven-ux` before designing a flow · `/cinematic-ui-motion` and `/motion-animate-ux-stack` while building it · `/frontend-design-fidelity` before calling anything done.

**Stack:** React 19, TypeScript, Vite, Tailwind v4, Framer Motion (`motion/react`), lucide-react, react-router-dom v7. All already in `package.json`.

**Non-negotiables:**
- **Every duration and easing comes from a token.** No ad-hoc `duration: 0.3` anywhere.
- **Animate `transform` and `opacity` only.** `width`, `top`, `height`, `box-shadow` are banned in transitions.
- `prefers-reduced-motion` collapses to opacity — it never disables a feature.
- Every async surface needs loading, empty **and** error states. A spinner in the middle of a page is not a loading state.
- Long text must not break layout: 60-char titles, 8 artists, Devanagari and Tamil.
- Touch targets ≥ 44 px. Test at 360 / 768 / 1280 / 1920.

**The three playback invariants — each was a real production bug. Do not rediscover them:**
1. **One funnel.** Every control calls a single `requestPlayback(playing)`. Never `setIsPlaying(...)` *and* `audio.play()` from a component.
2. **Load effects must never list `isPlaying` in their deps.** An effect that does, and calls `.play()`, re-fires on the user's own pause and instantly resumes — pause appears to do nothing. Read play state imperatively inside the effect.
3. **Seek pauses. Always resume:** capture `wasPlaying`, set `currentTime`, resume if it was playing.

**Ask me before:** changing the token values, adding a dependency, or touching anything in `apps/api`.

Start with ticket **F1** (tokens + motion primitives). Everything imports from there, so it has to exist before any component.
