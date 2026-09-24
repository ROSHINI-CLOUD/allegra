# Google sign-in via Convex Auth

Convex holds the Google secret and signs the session token. The Express API only verifies that token
against Convex's published keys, so **no Google credential ever reaches this repo, the API host, or
the browser bundle**.

Until the steps below are done the app runs guest-only: listening, search, playlists, and browser-local
Karaoke all work, and the account dialog says accounts are not switched on.

---

## 1. A Convex deployment

```bash
npx convex dev
```

First run opens a browser to log in and create a project. It prints a deployment URL
(`https://<name>.convex.cloud`) and writes `convex/_generated/`.

For production later: `npx convex deploy`.

## 2. Convex Auth keys

```bash
npx @convex-dev/auth
```

This generates the JWT signing keypair and sets `JWT_PRIVATE_KEY` and `JWKS` in the Convex
deployment. It is what makes the tokens verifiable from outside Convex.

## 3. A Google OAuth client

In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create credentials**
→ **OAuth client ID** → **Web application**.

**Authorised redirect URI** — take the `.convex.site` origin (the `.convex.cloud` URL with the suffix
swapped) and append the callback path:

```
https://<name>.convex.site/api/auth/callback/google
```

Add one for each deployment you use (dev and production are separate Convex deployments, so they need
separate URIs — and, usually, separate OAuth clients).

## 4. Tell Convex about it

In the Convex dashboard → **Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `AUTH_GOOGLE_ID` | the OAuth client ID |
| `AUTH_GOOGLE_SECRET` | the OAuth client secret |
| `CONVEX_SERVER_SECRET` | any 16+ character string, matching the API's value |

`CONVEX_SERVER_SECRET` is unrelated to Google. Convex functions are public URLs with no auth of their
own, so that shared secret is what stops a stranger reading or overwriting listener rows.

## 5. Tell the app about it

`apps/api/.env` (and the Vercel project env):

```
CONVEX_URL=https://<name>.convex.cloud
CONVEX_SERVER_SECRET=<same 16+ chars as above>
# CONVEX_SITE_URL is derived from CONVEX_URL; set it only if yours differs.
```

`apps/web/.env.local` (and Vercel):

```
NEXT_PUBLIC_CONVEX_URL=https://<name>.convex.cloud
```

`NEXT_PUBLIC_*` is public by definition — the deployment URL is fine there, a secret never is.

## 6. Check it

1. Open the app, click the account chip → **Continue with Google**.
2. After the redirect the chip shows the Google name and `Signed in`.
3. `GET /api/auth/me` returns `isGuest: false` with the email.
4. Anything liked as a guest beforehand is still there — `POST /api/auth/link` runs once on first
   sign-in and merges it.

## How it fits together

```
Browser ──► Convex Auth ──► Google ──► session JWT (RS256, iss = <name>.convex.site)
   │
   └──► Express: Authorization: Bearer <jwt>
                 └─ verified against https://<name>.convex.site/.well-known/jwks.json
                    subject "<userId>|<sessionId>" → profile keyed on userId
```

The API also still mints its own guest tokens (HS256, `JWT_SECRET`). Both are checked by one verifier,
so every route accepts either without knowing the difference.

## If sign-in fails

| Symptom | Usual cause |
|---|---|
| Button says accounts are not switched on | `NEXT_PUBLIC_CONVEX_URL` not set in the web build |
| Google returns `redirect_uri_mismatch` | Redirect URI missing, or uses `.convex.cloud` instead of `.convex.site` |
| Signed in, but the API still says guest | `CONVEX_URL` missing on the API, so no `CONVEX_SITE_URL` is derived and the token cannot be verified |
| Signed in, but the library is empty | `CONVEX_SERVER_SECRET` differs between the API and Convex |
