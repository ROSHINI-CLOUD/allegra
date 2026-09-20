# Convex — user data (likes, recents, playlists, settings)

One table (`users`), keyed by `userId`, holding everything the `UserStore` seam needs
(`apps/api/src/user/store.ts`). Two functions gate every call behind a shared secret
that only the Express API holds — Convex functions are public URLs with no auth of
their own, so `CONVEX_SERVER_SECRET` is the only thing stopping a stranger from
reading or overwriting user rows.

## Local dev

```
npx convex dev
```

First run asks you to log in (browser OAuth) and create a project — this is the one
step that needs a human, it can't be scripted. It prints a deployment URL
(`https://<name>.convex.cloud`) and generates `convex/_generated/`.

Then, in the Convex dashboard → Settings → Environment Variables, set:
```
CONVEX_SERVER_SECRET=<same 16+ char value you'll put in apps/api's CONVEX_SERVER_SECRET>
```

Copy the deployment URL and the secret into `apps/api/.env` (`CONVEX_URL`,
`CONVEX_SERVER_SECRET`). Leave both blank to skip Convex entirely — the API falls
back to in-memory user storage automatically (`apps/api/src/config.ts`).

## Prod

```
npx convex deploy
```

Set the same `CONVEX_SERVER_SECRET` on the production deployment's environment
variables (separate from dev — Convex keeps dev/prod config apart), then put the
production deployment URL + that secret into the API host's env vars (App Runner).

## Schema

`convex/schema.ts` — one `users` table, indexed on `userId`.

## Functions

`convex/users.ts`:
- `get({ secret, userId })` → the user row, or `null` if missing or the secret is wrong.
- `save({ secret, user })` → upsert by `userId`.

Both throw `Unauthorized` on a bad secret; the API's `ConvexUserStore`
(`apps/api/src/db/convex.ts`) treats any thrown/malformed response as "no data"
rather than crashing the request.
