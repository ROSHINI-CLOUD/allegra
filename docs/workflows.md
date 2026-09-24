# Workflows — develop, verify, ship

## Local development

```bash
npm install          # once, at the root: one lockfile covers every workspace
npm run dev          # API on :8080, web on :5173
```

`npm run dev` starts both. The web app calls same-origin `/api`, which Next rewrites to the API in
development — so there is no CORS setup and no `localhost` vs `127.0.0.1` trap.

Nothing needs credentials to run. With no Convex the app is guest-only and user data is in memory.
Karaoke runs on the listener's device, so it has no API or cloud configuration.

| Want | Add to `apps/api/.env` |
|---|---|
| Durable user data + Google sign-in | `CONVEX_URL`, `CONVEX_SERVER_SECRET` (+ `NEXT_PUBLIC_CONVEX_URL` in `apps/web/.env.local`) — see [auth-convex-google.md](./auth-convex-google.md) |
| Recommendations, lyric translation | No key. Recommendations use catalog + listener taste; MyMemory translates lyrics. Set `LIBRETRANSLATE_API_URL` only for a self-hosted fallback. |

## The gate

```bash
npm run typecheck    # exit 0
npm run lint         # exit 0
npm test             # all green
```

All three before opening a PR. They run across every workspace from the root.

Frontend work is also checked at 360 / 768 / 1280 / 1920, and the hero transition is profiled on a
**real phone**, not a laptop.

## Verifying a change end to end

The two things worth proving by hand, because both fail invisibly:

**Range requests still return 206.** Collapse it to 200 and audio plays perfectly while seeking does
nothing.

```bash
curl -s -D - -o /dev/null -H "Range: bytes=0-1023" http://localhost:5173/api/stream/<songId>
# expect: HTTP/1.1 206 Partial Content + content-range + accept-ranges
```

**Playback survives navigation.** The single `<audio>` element lives in the layout; if a change
remounts it, music stops on every route change. In the browser console, after pressing play:

```js
document.querySelector('audio').__probe = 1;
document.querySelector('a[href="/library"]').click();
// after navigating: the same element must still be there and still playing
document.querySelector('audio').__probe === 1 && !document.querySelector('audio').paused;
```

## Inspecting a Vercel build without deploying

`vercel build` produces the real deployment output locally. Use it whenever routing changes:

```bash
vercel build
node -e "require('./.vercel/output/config.json').routes.forEach((r,i)=>console.log(i, r.handle||r.src||''))"
```

The `/api` rewrite must appear **before** Next's `[[...slug]]` catch-all. If it does not, every API
call will 404 in production while the site still renders.

## Branching and commits

`main` is always deployable and always green. Work on `feat/`, `fix/`, `chore/`, `docs/` branches.
Small PRs, squash-merge, reviewed by a non-author.

Conventional commits: `feat(api):`, `fix(web):`, `chore(infra):`. Short imperative subject; a body
only when the *why* needs explaining.

## Shipping

```bash
vercel deploy            # preview
vercel deploy --prod     # production — only when asked
npx convex deploy        # Convex functions and schema
node scripts/sync-vercel-env.mjs   # push apps/api/.env to Vercel (prints names only)
```

Smoke the production alias afterwards:

```bash
curl -s https://allegravibe.vercel.app/api/health
curl -sI -H "Range: bytes=0-1023" https://allegravibe.vercel.app/api/stream/<songId>
```

Preview deployments sit behind Vercel's SSO protection, so a public `curl` against one returns a
login redirect rather than your app. Verify against the production alias.

## Scope

Anything that ships a control which does nothing is out. The Premium page is a labelled UI demo with
no payments. Karaoke is real: it separates locally in a browser worker, with a mid-side fallback
when the model cannot run on the current device.
