# 16 — PROGRESS · evidence log against §3 "Definition of 100 percent"

Checklist from `16-FULL-PRODUCT-PROMPT.md` §3. One evidence line per item.
Status: `[x]` verified with evidence · `[~]` partly verified · `[ ]` not started.

Environment for this pass: local — Convex anonymous backend on `:3210`, API on `:8080`,
web on `:5173`, driven in a real Chromium browser at 1440×900 / 1351×918.

---

## 3.1 Functional

- [x] **1. Search** — ⌘K pill opens the palette (`role=combobox`, `aria-expanded=true`); typing
  "tum hi ho" returned live SONGS + ARTISTS sections; ArrowDown moved the active row; Enter played
  "Tum Hi Ho (From Aashiqui 2)" and closed the sheet; focus returned to the pill (focus ring visible).
- [x] **2. Playback** — play, pause (stays paused — invariant 2 holds), next (switched song mid-play
  and kept playing), click-to-seek on the bar (23.6 s → 352.7 s, exactly 60 % of 586 s, and playback
  resumed — invariant 3 holds), Space toggles, ←/→ seek ∓5 s, mute/unmute flips `audio.muted` and the
  label, shuffle off↔on, repeat cycles off → all → one → off, queue panel opens ("Playing Next, 20 songs").
  Seek issued a real `206 Partial Content` through the Vite proxy.
- [ ] **3. Lyrics** — not yet driven.
- [~] **4. Likes** — player-bar heart flips `Add to likes` → `Remove from likes` and the server's liked
  count went 7 → 8. Not yet checked on every surface, nor across a reload.
- [ ] **5. Playlists** — not yet driven (create / add / delete+undo / empty state).
- [ ] **6. Accounts** — not yet driven (register / sign out / sign in / wrong password).
- [~] **7. Home is personal** — first run showed onboarding; picking 3 artists + Hindi rebuilt Home with
  "Your artists" (real photos), "Jump back in", "Pick up where you left off" and an AI picks shelf
  labelled "PICKED FOR YOU, BY NVIDIA". Long-term taste drift not yet observed.
- [ ] **8. Sharing** — not yet driven.
- [ ] **9. Artist / Album / Collection pages** — not yet driven.
- [ ] **10. Theme + rail** — not yet driven.
- [~] **11. No dead controls** — every control exercised so far does something real.

## 3.2 Visual / UX quality

- [ ] **12. 360 / 768 / 1280 / 1920** — only 1440 and 1351 so far.
- [ ] **13. Loading / empty / error states** — not yet driven.
- [~] **14. Accessibility** — all 44 buttons on Home have accessible names (0 without); the scrubber and
  volume are real `range` inputs; the palette exposes `aria-expanded` / `aria-controls`; artist chips
  carry `aria-pressed`. Contrast and full keyboard path not yet audited.
- [ ] **15. `prefers-reduced-motion`** — not yet emulated.
- [ ] **16. Motion under CPU throttle** — not yet profiled.

## 3.3 Backend / data

- [x] **17. Gates green** — `npm run typecheck`, `npm run lint`, `npm test` all exit 0; 94 API tests +
  5 infra tests pass (was 90; four added this pass).
- [ ] **18. Contract spot-check** — not yet curl-checked against `docs/api-contract.md`.
- [ ] **19. Convex production** — still local-anonymous only; needs the human step (task B1).
- [x] **20. Byte-range** — `curl -H "Range: bytes=0-10" -I /api/stream/YiVML4Zo` → `206` with
  `content-range: bytes 0-10/15091015` and `accept-ranges: bytes`; confirmed again in-browser on seek.
- [~] **21. Rate limits / no raw provider errors** — `RateLimit` headers present on `/api/stream`
  (300/min) and `/api/ai` (120/min); the 500 below returned only user-facing copy, never provider text.
  `/api/shared` dedicated limit (task B6) not yet added.

## 3.4 Deploy (AWS)

- [ ] **22. Hosting** — App Runner + Amplify not started (needs human GitHub connect + console).
- [~] **23. Bedrock primary** — code done (`AI_PRIMARY=bedrock` in `buildAiClient`); runtime enablement
  still needs human `aws configure` + Bedrock model access + IAM. Not verified live.
- [~] **24. S3 playlist covers** — code path landed this session:
  hand-rolled SigV4 query-string presigner (`apps/api/src/lib/s3Presign.ts`),
  `POST /api/uploads/sign`, additive `coverKey`/`coverUrl` on libraries (Convex + contract),
  Change cover glass popover on playlist page, covers shown on Home tiles / Library cards / hero.
  Gates green (111 API + 5 infra). **Not verified against a real bucket** — waiting on `aws configure`
  then bucket + CloudFront + env (`S3_COVERS_BUCKET`, `S3_COVERS_PUBLIC_BASE_URL`).
- [ ] **25. README "How we used AWS"** — not started.
- [~] **26. Sing / Karaoke (AWS Batch dual-stem)** — code + CFN + worker on `fe/karaoke-aws`
  (Scarleta removed). Unit/route tests green; **not deployed / not E2E on GPU**. See
  `docs/karaoke-aws-decisions.md` and `.planning/23-HANDOFF-KARAOKE.md`.

---

## Defects found and fixed this pass

1. **AI recommendations returned 500 on every single call.** `sendFailure` discarded the error it was
   handed, so nothing reached the logs and the browser saw only "Something went wrong". Unexpected
   failures are now logged against the request; the browser still sees only the friendly sentence.
   → `apps/api/src/routes/common.ts`
2. **The recommender threw on, and then silently discarded, every NVIDIA answer.** The prompt asks for
   `{"queries": string[]}`; NVIDIA's Llama consistently returns one comma-separated *string*, so
   `.filter` threw on a non-array. Both shapes are accepted now. Recommendations went from failing on
   100 % of calls to succeeding on 100 %. → `apps/api/src/services/recommendations.ts`
3. **Home shelves were built from label-shaped searches.** `search('made for you')` returned ten
   unrelated songs literally *titled* "Made For You". Reseeded with phrases that match real music and
   ranked by play count; the shelves now hold Tum Hi Ho, Apna Bana Le, Zaalima.
   → `apps/api/src/catalog/catalog.ts`
4. **The same recording appeared up to three times in a row** on a shelf, because the provider returns
   one row per release (artist credits sometimes reordered). Added a shared identity key and applied it
   to the home shelves, the AI shelf, and to what the AI shelf excludes — it was recommending songs the
   listener already had liked. → `apps/api/src/lib/normalize.ts`
5. **A guaranteed 404 on every first load.** A brand-new guest has no likes, no history and no taste, so
   `/api/ai/recommendations` could only answer "not enough listening history". The call is now gated on
   there being a signal worth sending. → `apps/web/src/App.tsx`

## Verified as NOT defects (checked, then cleared)

- Buttons reporting no accessible name in the a11y tree — the tool does not compute names from
  descendants; the real computed names are all present (0 of 44 missing).
- Artist tiles and palette row artwork rendering blank — lazy-load timing in the screenshot only;
  0 broken images, all `naturalWidth` 500.
- Onboarding chips appearing to select the wrong artist — a stale-coordinate artifact of the test
  harness after a scroll; selecting causes no scroll jump and no chip movement.

## Notes for the human

- `GEMINI_API_KEY` in `apps/api/.env` starts `AQ.Ab8…`, which is not the usual `AIza…` Gemini API key
  shape. The cascade falls through to NVIDIA/Groq correctly, so nothing is broken, but Gemini is
  effectively never used. Worth re-issuing the key if Gemini is meant to be first.
- The harness used for this pass cannot send named keys (Space/Arrow/Enter arrive with `key: ""`), so
  keyboard behaviour was verified with dispatched `KeyboardEvent`s instead of synthetic key presses.
