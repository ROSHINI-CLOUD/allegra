# Roadmap — state, blockers, next

Updated 2026-09-24.

## Where things stand

| Area | State |
|---|---|
| Next.js App Router + real routes | **Done.** Verified: playback survives navigation on the same `<audio>` element. |
| One Vercel deployment (web + Express) | **Ready to deploy.** `vercel.json` keeps the `/api` rewrite ahead of Next's catch-all; confirm the production build and Range `206` after each deploy. |
| npm workspaces, one lockfile | **Done.** |
| Browser-local Karaoke | **Done in code.** A worker separates near the playhead and falls back locally; no cloud job or API polling exists. |
| Free translation + recommendations | **Done in code.** MyMemory with optional self-hosted LibreTranslate fallback; catalog + listener taste, no LLM. |
| Google sign-in via Convex Auth (code) | **Done and tested locally.** Never run against a real Google client. |
| Render / App Runner removal | **Done.** No container deploy path remains. |

## Blocked on someone with credentials

These are finished in code and cannot be verified further from here.

### Google sign-in — first real sign-in

Needs: a Convex deployment and a Google OAuth client.

Follow `docs/auth-convex-google.md`. Then check that a guest who likes a song *before* signing in
still has it afterwards — that is the path most likely to be wrong in a way tests cannot see.

## Next, once those are verified

1. **Device Karaoke QA.** Check WebGPU and WASM fallback on a real desktop and a small phone, and
   record model-load time, first ready chunk, seek behavior, and local fallback result.
2. **A shared cache.** Serverless instances each keep their own memory cache, so a cold start re-fetches
   search and lyrics. If this becomes material, use Convex through one cache seam.
3. **Server-rendered content.** The shell is client-only (`ssr: false`), so `/artist/x` has no HTML for
   a crawler and nothing paints until JS loads. Rendering the static half of a view on the server is
   the single biggest first-paint and SEO win available.

## Deliberately not doing

- Cloud GPU, Batch jobs, a karaoke worker image, or an AWS runtime.
- Paid/provider-key LLMs for translation or recommendations.
- A second infrastructure framework or an event queue for Karaoke.
