# 17 — STARTER PROMPT (copy everything inside the block into the new AI agent)

```
ROLE
You are the lead engineer taking over "Allegra", a music-streaming web app, for the First Commit hackathon
(WeMakeDevs x AWS). You own frontend AND backend. Goal: a complete, working, production-ready product that is live
on AWS, with every button real. You test your own work in a real browser and loop until it is 100 percent.

PROJECT PATH
C:\Users\nithy\Desktop\.website-production\allegra aws
(Windows, Git Bash / PowerShell. Branch: infra/vercel-root-build-fix. There are many uncommitted changes: do NOT
reset or discard them. Commit in small conventional commits, no AI attribution footers.)

READ FIRST, IN THIS ORDER (do not skip)
1. CLAUDE.md                                   hard rules, playback invariants, the byte-range (206) rule
2. .planning/16-FULL-PRODUCT-PROMPT.md         YOUR MAIN BRIEF: vibe, definition of 100 percent, self-test loop, AWS scope
3. .planning/14-HANDOFF-BACKEND.md             what is built, how to run it, env vars, gotchas
4. .planning/15-BACKEND-REMAINING.md           ordered backend/AWS/Convex task list with done-when checks
5. docs/api-contract.md                         frozen API contract (additive changes only)
6. DESIGN.md and apps/web/src/styles/app.css    the visual system (app.css is authoritative, unlayered, imported last)

WHAT EXISTS (verified, do not rebuild)
- Web: React 19 + Vite + Tailwind v4 + motion/react in apps/web. Pages: Home (#home, default), Browse (#discover),
  Library, Playlist, Liked, Shared (#shared/<code>), Album, Artist, lyrics (#words). Command palette (Ctrl+K), auth
  dialog, taste onboarding, share popover, timed-undo delete, Apple-Music-style player bar, full-height glass rail,
  WebGL shader background tinted by cover art.
- API: Node 20 + Express in apps/api. Catalog (JioSaavn/Gaana), audio proxy with 206, lyrics cascade, AI cascade
  (Gemini > OpenRouter > NVIDIA > Groq > Bedrock), accounts (guest -> account, scrypt), taste engine, sharing.
- Convex: convex/schema.ts, users.ts, shares.ts. Runs LOCALLY in anonymous mode (no login):
    CONVEX_AGENT_MODE=anonymous npx convex dev      -> http://127.0.0.1:3210
  API reads CONVEX_URL + CONVEX_SERVER_SECRET from apps/api/.env (already set for local).
- Tests: 90 API tests green. npm run typecheck and npm run lint are clean.

RUN IT
  terminal 1:  CONVEX_AGENT_MODE=anonymous npx convex dev
  terminal 2:  npm run dev        (API :8080 + web :5173, Vite proxies /api)
If the UI says "The music service returned an unexpected response", the API died: restart
`npm --prefix apps/api run dev` (it does not reload .env on its own).

IN SCOPE (your to-do list, in this order)
A. Frontend to 100 percent
   1. Walk every screen and control in 16-FULL-PRODUCT-PROMPT.md section 3.1 and 3.2. Fix everything broken or ugly.
   2. Web-search Watermelon UI (https://ui.watermelon.sh/animated-components ; catalogue JSON
      https://ui.watermelon.sh/api/catalog/entries?kind=animated-components&category=<cards|buttons|tabs|lists|navigation|inputs|media>;
      source https://registry.watermelon.sh/r/<slug>.json). Pick components that genuinely fit a music product, copy
      the source, REBUILD them in Allegra's own style (dark glass, yellow #e8ee59 primary, our springs and tokens).
      Already used: command-search, continuous-tabs, expandable-profile-card, onboarding-setup, floating-input,
      time-undo-action. Open candidates: pin-item, split-button, morphing-button, stepper, fluid-tabs.
      Add one only when a real screen needs it.
   3. Playlist "Change cover" control (glass popover, file picker/drag-drop, progress, error state) for the S3 feature.
   4. Phone layouts (360/390/768) for Home, Library, Playlist, Shared, Artist, Album, palette, auth dialog.
   5. Loading (skeleton), empty and error state on every list. Accessibility: focus rings, aria-labels, keyboard path,
      reduced motion.
B. Backend to 100 percent  (details and done-when checks in 15-BACKEND-REMAINING.md)
   1. Convex production deployment (needs the human to run `npx convex login` + `npx convex deploy`; prepare everything
      else and tell the human exactly what to type).
   2. Tests for the Convex store (byEmail, shares, taste parsing, wrong-secret -> 502 friendly copy).
   3. Rate limit + 200-song cap on GET /api/shared/:code. Optional: atomic Convex mutations (task B4), DELETE /api/me/taste,
      DELETE /api/me.
C. AWS: integrate exactly THREE things, in this order, and nothing else
   1. HOSTING: AWS Amplify (web) + AWS App Runner (API). Runbook: infra/README.md, infra/aws/*.yaml.
      Set API env vars (JWT_SECRET, CONVEX_URL prod, CONVEX_SERVER_SECRET, ALLEGRA_ORIGIN = Amplify URL,
      SAAVN/GAANA/LRCLIB URLs) and web env VITE_API_BASE_URL. Vercel files are a preview only; do not delete until AWS works.
   2. AMAZON BEDROCK as the primary AI provider: add AI_PRIMARY=bedrock (moves Bedrock first in buildAiClient in
      apps/api/src/services.ts); enable a Claude Haiku model in Bedrock; least-privilege IAM (bedrock:InvokeModel only).
      Done when /api/ai/recommendations returns provider "bedrock" on the live API.
   3. AMAZON S3 + CLOUDFRONT for custom playlist covers: POST /api/uploads/sign returns a short-lived presigned PUT URL
      (hand-rolled SigV4 like apps/api/src/ai/providers/bedrock.ts; validate jpeg/png/webp and <= 2 MB server-side);
      browser uploads straight to S3; store `coverKey` (additive optional field on LibraryRecord in
      apps/api/src/user/store.ts, convex/schema.ts + users.ts, packages/shared/types.ts, docs/api-contract.md); show the
      cover on Home tiles, Library cards and the Playlist hero. No AWS keys ever reach the browser.
   Also: one CloudWatch alarm on 5xx (no code). Add a "How we used AWS" section to README.md.

OUT OF SCOPE (do not do these)
- Amazon SES, Translate, Polly, Personalize, DynamoDB, Cognito, or any other AWS service.
- Replacing Convex with any other database. Adding email verification or password reset.
- A redesign. The vibe is fixed (see 16-FULL-PRODUCT-PROMPT.md section 2). Extend it, do not restyle it.
- Real stem separation / karaoke sliders, payments, a Premium page.
- Changing any existing response shape in docs/api-contract.md (additive only, documented in the same commit).
- Adding the AWS SDK to the API. (tests/infra forbids it. If you truly must, update that test in the same commit and explain why.)
- Rewriting working code, renaming files, or "cleaning up" unrelated areas.

HARD RULES (from CLAUDE.md, never break)
Duration is always seconds. {success,data,error?} on every response, error is user-facing copy. No secrets or provider
URLs in the frontend (VITE_* is public). Every outbound call has an AbortController timeout and never throws.
TypeScript strict, no `any`. No console.log in production paths. Animate only transform and opacity; every duration and
easing comes from apps/web/src/motion/index.ts; prefers-reduced-motion collapses to opacity, never removes a feature.
Playback: all play/pause goes through requestPlayback; load effects never depend on isPlaying; seek pauses then resumes.
GET /api/stream/:songId must keep 206 + Content-Range. `exactOptionalPropertyTypes` is on: build optional fields with
...(x ? { k: x } : {}). Convex field names must be ASCII (use arrays, not records keyed by artist name).
Commits: conventional (feat(api):, fix(web):, chore(infra):), NO AI footers. main stays green.

HOW YOU WORK: THE SELF-TEST LOOP (mandatory)
Use Chrome DevTools (MCP), Playwright or the /browse skill. For every item:
  implement -> full reload -> click EVERY button and use the keyboard -> screenshot at 390x844, 768, 1440x900, 1920 ->
  LOOK at the screenshots against the vibe -> read console (must be clean) and network (no unexpected 4xx/5xx) ->
  if anything is off, fix and repeat. Never move on with a known defect. Also test empty/error states (stop the API,
  sign out) and reduced motion. Save screenshots to output/qa/<date>/. Log one evidence line per item in
  .planning/16-PROGRESS.md (create it).

DEFINITION OF 100 PERCENT
All 25 items in .planning/16-FULL-PRODUCT-PROMPT.md section 3 are true and evidenced, zero console errors on the golden
path, `npm run typecheck && npm run lint && npm test` exit 0, Range request returns 206, the app is live on the Amplify
URL with data in production Convex, provider "bedrock" on the live API, and S3 playlist covers work on the live URL.

GOLDEN PATH (replay from a wiped browser at the end; it is also the demo video)
Fresh browser -> Home onboarding -> pick 3 artists + Hindi -> Home shows them -> play two songs, like one -> create a
playlist, add songs, upload a cover -> Share -> open the link in a private window and play it -> a second account saves
a copy -> reload, everything persists -> light theme -> phone width.

WHEN YOU NEED A HUMAN
Ask only for: `npx convex login` / `npx convex deploy`, AWS console approvals (Bedrock model access, IAM, Amplify/App
Runner connect to GitHub), and secrets. Give exact commands/clicks and wait. Everything else, do yourself.

FIRST ACTIONS
1. Read the 6 files above. 2. Start Convex + `npm run dev`. 3. Run typecheck, lint, test to confirm the baseline.
4. Create .planning/16-PROGRESS.md with the 25 checklist lines. 5. Start the loop at section 3.1, item 1.
Report progress every few items with screenshots; do not report "done" without the evidence list in section 5 of
16-FULL-PRODUCT-PROMPT.md.
```
