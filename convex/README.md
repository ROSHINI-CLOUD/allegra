# Convex — identity, listener data, covers, and OAuth grants

Convex Auth owns the `users` table. Allegra keeps its listener data in `profiles`, keyed by the
authenticated user's stable ID, with `shares` for public playlists, `oauthGrants` for one-time MCP
authorization-code and refresh-token use, and Convex storage for uploaded covers. The Express API
uses `CONVEX_SERVER_SECRET` for its server-to-server profile and grant calls; browser identity comes
from Convex Auth rather than a user ID supplied by the caller.

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
production deployment URL + that secret into the Vercel project's environment variables.

## Schema

`convex/schema.ts` — `profiles` (indexed by user ID and email), `shares`, and `oauthGrants`
(indexed by token id and expiry). Convex Auth supplies `users`; do not add a competing user table.

## Functions

`convex/profiles.ts` provides the profile read, lookup, save, and identity functions.
`convex/covers.ts` creates upload URLs and manages cover storage. `convex/oauth.ts` atomically
consumes a grant token id once; its expiry sweep is internal. Server-only functions reject an invalid
shared secret, and the API treats an unavailable or malformed Convex response as a safe failure
rather than crashing a request.
