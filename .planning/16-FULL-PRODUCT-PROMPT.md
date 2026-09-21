# 16 — FULL PRODUCT PROMPT · "100 percent" definition · self-test loop

Paste **section 1** to the next AI as its instruction. Sections 2–6 are the reference it must follow.
Read order for that AI: `CLAUDE.md` → `14-HANDOFF-BACKEND.md` → `15-BACKEND-REMAINING.md` → this file.

---

## 1. The prompt to paste

> You now own **Allegra end to end, frontend and backend**, and your goal is a **complete, working, production-ready
> music-streaming product for the First Commit hackathon (WeMakeDevs × AWS)**. Not a demo, not a mock: every button
> does what it says, every screen has loading / empty / error states, and it is live on an AWS URL.
>
> **How to work: build, test it yourself in a real browser, fix, repeat, until every item in
> `16-FULL-PRODUCT-PROMPT.md §3 "Definition of 100 percent"` is true.** Do not stop at "it compiles". After every
> change: run the app, drive it with Chrome DevTools (or Playwright, or the `/browse` skill, whichever you have),
> **click every button, take screenshots at 360 / 768 / 1280 / 1920 px, read the console and network panels**, compare
> what you see to the vibe in §2, fix what is wrong, and go again. Follow §4 exactly. You may only report "done"
> with the evidence listed in §5.
>
> **Frontend:** web-search **Watermelon UI** (`https://ui.watermelon.sh/animated-components`, catalogue JSON at
> `https://ui.watermelon.sh/api/catalog/entries?kind=animated-components&category=<cards|buttons|tabs|navigation|lists|media|inputs>`,
> component source at `https://registry.watermelon.sh/r/<slug>.json`) and any other current, well-regarded React
> motion/UI references. Choose the components that genuinely fit a music product, **copy their source, and rebuild them in
> Allegra's own style (§2)**: our tokens, our glass, our springs, our reduced-motion behaviour. Never paste them in their
> default light/Tailwind look. Already adopted: Command Search (⌘K palette), Continuous Tabs (mood pills), Expandable
> Profile Card (artist cards), Onboarding Setup (taste onboarding), Floating Input (auth fields), Timed Undo Action
> (playlist delete), Save Toggle idea (like heart). Candidates still open: `waveform-scrub` (only if the waveform is real
> audio data, otherwise skip), `pin-item` / `shuffle-pinned-item` (pin playlists on Home), `split-button` (Play + menu),
> `morphing-button`, `stepper`, `macos-sidebar`, `fluid-tabs`. Add a component only when a real screen needs it.
>
> **Backend:** finish everything in `15-BACKEND-REMAINING.md`: production Convex, tests, hardening, and **AWS (§6)**.
>
> Rules never to break: `CLAUDE.md` hard rules, the three playback invariants, the byte-range (206) rule, `docs/api-contract.md`
> (additive changes only, documented in the same commit), no secrets in the frontend, animate only `transform`/`opacity`,
> every duration/easing from `apps/web/src/motion/index.ts`, `prefers-reduced-motion` collapses to opacity, no `any`, no
> `console.log` in production paths, conventional commits with **no AI footers**, `main` stays green.

---

## 2. The Allegra vibe (build everything in this style)

**One sentence:** a dark, cinematic, glass-on-light music room where the artwork of what you are hearing colours the whole page.

- **Canvas:** near-black (`#050506`–`#0e0e10`). Behind everything is the VibeRoom WebGL flow shader
  (`apps/web/src/components/shader/MusicFlowShader.tsx`, mounted by `DynamicAura`), **tinted by the dominant colour of the current cover art**
  (`lib/palette.ts` → `shaderPalette`). On an artist page it uses that artist's photo colours even if another song plays; on leaving, it returns to the playing song.
  Playlist, Liked, Album and Shared pages sit **directly on the shader** (no slab).
- **One material: frosted glass.** Every card, row list, field, popover and sheet is translucent (`--surface*` tokens,
  `backdrop-filter: blur(26px) saturate(170%)`, 1px hairline border, inset top highlight). Nothing is a flat opaque grey box.
  Dialogs/popovers are portalled and carry their own dark-glass tokens (`.glass-sheet`, `.cmdk-sheet`).
- **One primary action colour:** yellow `--wave: #e8ee59` with dark text (`.btn-primary`). Everything else is glass (`.btn-glass`). Never two yellow buttons side by side.
- **Layout:** full-height frosted left rail (`.site-header`, 224 px, collapses to a 44 px pill), main column on the shader, Apple-Music-style floating bottom player bar, Now Playing column on Browse. **Artist page only** gets the cinematic full-bleed hero (opaque, rounded bottom, photo to the screen edges, compact bar on scroll).
- **Type:** Geist (loaded in `index.html`); big tight headlines (`letter-spacing -0.04em`), quiet uppercase eyebrows (11 px, `+0.14em`).
- **Motion language:** springs from `motion/index.ts` (`spring.tactile/sheet/hero`), 150–300 ms for UI, pages arrive with `page-in` (fade + 14 px rise), press = `scale(.97)`, shared-layout morphs (search pill → palette, tabs pill, artist card → sheet). Only `transform` and `opacity`. Reduced motion → opacity only, never removing a feature.
- **Copy:** plain, warm, specific ("Pick 3 more", "Songs you love"). Errors are user-facing sentences from the API envelope, never raw provider text.
- **CSS architecture:** `apps/web/src/styles/app.css` is the authoritative **unlayered** sheet, imported last; older CSS is inside `@layer legacy`. New styles go at the end of `app.css`, use tokens, and must not add `!important`.
- **Themes:** dark is default; light theme must still be readable (glass tokens fall back to paper). Portalled dialogs stay dark in both.

If a screen you build does not look like it belongs to the screens above, it is not done.

---

## 3. Definition of 100 percent

The product is 100 % ready when **every line below is true and you can show the evidence in §5**. Tick them in `.planning/16-PROGRESS.md` (create it) as you go.

### 3.1 Functional — every control works
1. **Search:** ⌘K / Ctrl+K opens the palette; typing shows songs + artists live; Enter plays; "Search all" goes to Browse; Esc closes; focus returns to the pill.
2. **Playback:** play, pause, next, previous, seek (drag **and** click on the bar — must be a real `206`), volume, mute, shuffle, repeat off/all/one, queue panel, keyboard Space/←/→. Switching songs mid-play works; ending a song advances.
3. **Lyrics:** synced lyrics scroll and highlight; provider fallback works; translate toggle works or shows a clear "not available".
4. **Likes:** heart on every surface (row, tile, player bar, now-playing, album, artist top songs) toggles, animates, and survives reload.
5. **Playlists:** create (Home tile, Library form, "+" menu on a song), rename if offered, add/remove songs, open page, play/shuffle, **delete with 5 s undo** (undo really cancels), empty state.
6. **Accounts:** guest by default → Create account keeps everything → sign out → sign in on a clean browser shows the same likes/playlists/taste. Wrong password shows the friendly error. Display name editable.
7. **Home is personal:** opening the site (no hash) shows **their** artists, recents, playlists, likes, AI picks; trending is last. First run shows onboarding; after picking, Home reflects the picks; playing and liking visibly shifts "Your artists" over time.
8. **Sharing:** Share creates a link; opened in a private window it plays with no login; "Save to my library" copies it; "Stop sharing" makes the link 404 immediately; a shared playlist's new songs appear for the viewer.
9. **Artist / Album / Collection pages:** open from every entry point (artist chip, name click, palette, Home), Back always goes somewhere sensible, cinematic hero + compact bar on scroll (artist), tracks playable.
10. **Theme + rail:** light/dark toggle, rail collapse/expand, motion pause toggle, all persisted sensibly.
11. **No dead controls.** If a button exists it does something real. Remove or label anything that does not (`CLAUDE.md` "What's real vs demo").

### 3.2 Visual / UX quality
12. Every screen matches §2 at **360, 768, 1280, 1920 px**: no overlap, no clipped text, no horizontal scroll, 16 px side gutters on phones, tap targets ≥ 44 px.
13. Every list/section has **loading (skeleton), empty, and error** states written in plain copy.
14. Focus rings visible, full keyboard path through search → play → like → playlist; dialogs trap/restore focus; `aria-label`s on icon buttons; contrast ≥ 4.5:1 for body text.
15. `prefers-reduced-motion: reduce` (emulate it in DevTools) removes all movement but keeps every feature.
16. Motion: no jank on a mid-range phone profile (DevTools CPU 4× throttle) — hero, palette morph and page transitions stay smooth; no layout thrash from animating width/height/top.

### 3.3 Backend / data
17. `npm run typecheck`, `npm run lint`, `npm test` all exit 0; new code has tests (accounts, taste, sharing, Convex store).
18. `docs/api-contract.md` matches the real responses (spot-check five endpoints with curl).
19. Convex **production** deployment holds the data; secret set only in host env; restarting the API loses nothing.
20. Byte-range: `curl -H "Range: bytes=0-10" -I $API/api/stream/<id>` → `206` + `Content-Range`.
21. Rate limits on `/api/auth` and `/api/shared`; no raw provider errors reach the browser; every outbound call has a timeout and never throws.

### 3.4 Deploy (AWS)
22. Live on AWS (§6): web on Amplify, API on App Runner, the Amplify URL works end to end, CORS correct, HTTPS.
23. Bedrock is the primary AI provider on the deployed API (`provider: "bedrock"` in `/api/ai/recommendations`).
24. The chosen small AWS feature (S3 playlist covers) works on the live URL.
25. README has "How we used AWS", the run instructions, and the honest "what's real vs demo" list. `LEARNING-LOG.md` has the lessons.

**"100 percent" = 1–25 all true, zero console errors on the golden path, zero 4xx/5xx on the network panel except intentional ones (wrong password → 401, revoked share → 404).**

---

## 4. The self-test loop (run it until §3 is fully true)

Tools: Chrome DevTools MCP (`navigate_page`, `take_screenshot`, `take_snapshot`, `click`, `fill`, `press_key`, `evaluate_script`, `list_console_messages`, `list_network_requests`, `emulate`, `resize_page`, `lighthouse_audit`, `performance_start_trace`) or Playwright, or the `/browse` skill. If the tool needs the dev servers: `CONVEX_AGENT_MODE=anonymous npx convex dev` and `npm run dev`.

```
LOOP
  1. Pick the next unchecked item in §3 (start with 3.1, then 3.2, then 3.3, then 3.4).
  2. Implement or fix it (smallest correct change; reuse existing components/tokens).
  3. Reload the app in the browser (Vite HMR does not always recover hook changes: do a full reload).
  4. Drive it like a user: click every button on that screen, type in every field, use the keyboard, try the empty and error case
     (stop the API to see the error state; sign out to see the guest state).
  5. Screenshot at 1440×900 and 390×844; also 768 and 1920 for layout items. LOOK at the screenshots — compare with §2.
  6. Read console messages (must be clean) and the network list (no unexpected 4xx/5xx, no failed images).
  7. If anything is wrong or ugly: fix it and go back to step 3. Do not move on with a known defect.
  8. When the item is genuinely right: write one line of evidence in `.planning/16-PROGRESS.md`
     ("3.1.5 playlists: created via Home tile, undo cancelled a delete, screenshots in output/qa/…"), run typecheck+lint+tests, commit.
  9. Next item.
END when §3 has no unchecked line. Then run the full golden path once more from a wiped browser profile and a fresh Convex deployment.
```

Golden path to replay at the end (also the demo video): fresh browser → Home onboarding → pick 3 artists + Hindi → Home shows them → play two songs, like one → create a playlist, add songs → Share → open link in a private window and play it → second account saves a copy → reload → everything is still there → light theme → phone width.

Screenshots go in `output/qa/<date>/<item>.png` (git-ignored). Keep a running list of defects you found and fixed in `16-PROGRESS.md`; the learning log is scored.

---

## 5. Evidence required before saying "done"

- `16-PROGRESS.md` with every §3 line ticked and one evidence line each.
- The three commands green (paste the summary lines) and the two `curl` checks (206, contract spot-check).
- Screenshots of: Home (first run and personalised), Browse, Library, Playlist, Shared (private window), Artist, Album, Liked, palette open, auth dialog, at 390 and 1440 px, dark and light.
- Console + network clean on the golden path (state how you checked).
- The live AWS URL and the CloudWatch / Bedrock evidence from §6.

---

## 6. AWS — exactly what we integrate (and nothing more)

We use AWS for **three things**, in this priority. Do them in this order; stop adding AWS after these.

1. **Hosting (required — the "Ship It" gate):** **AWS Amplify** for the web app, **AWS App Runner** for the Express API. Runbook: `infra/README.md`, `infra/aws/*.yaml`. Detail: `15-BACKEND-REMAINING.md` A1.
2. **Amazon Bedrock as the primary AI provider (config flip, no new dependency):** recommendations and lyric translation run on a Claude Haiku model in Bedrock first, other providers stay as fallbacks. Detail: A2 (`AI_PRIMARY=bedrock`, model access enabled, IAM role/user with `bedrock:InvokeModel` only).
3. **The one small extra feature: Amazon S3 (+ CloudFront) for custom playlist covers.** A listener can upload an image for a playlist; the API hands the browser a **short-lived presigned PUT URL** (`POST /api/uploads/sign`), the browser uploads straight to S3, the key is stored on the library (`coverKey`, additive field), and Home/Library/Playlist show it through CloudFront. Validate type (jpeg/png/webp) and size (≤ 2 MB) server-side; no AWS keys ever reach the browser. Detail: A4 first row. Add a small "Change cover" control to the playlist page in the Allegra style (glass popover, drag-and-drop or file picker, progress, error state).
   Also add CloudWatch alarm from A3 (five minutes, no code).

Everything else (SES, Translate, Polly) is **out of scope**. Do not add the AWS SDK unless you also update `tests/infra` and explain why; hand-rolled SigV4 for presigning is acceptable and matches `bedrock.ts`.

Convex stays the database (users, taste, playlists, shares). It is not replaced by any AWS database.
