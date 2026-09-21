# MCP CONTRACT — the Allegra connector

> This is a **separate, additive surface**. It does not touch `docs/api-contract.md`, which stays
> frozen and browser-facing. This doc covers `POST /mcp` only — the endpoint an MCP client
> (ChatGPT, Claude, or any other MCP-compatible host) talks to. See
> `.planning/19-MCP-CONNECTOR-PLAN.md` for the design rationale.

Endpoint: `POST {API_BASE_URL}/mcp` — a stateless [Streamable HTTP](https://modelcontextprotocol.io)
MCP transport (`@modelcontextprotocol/sdk`). `GET`/`DELETE /mcp` return `405`; there is no session
to fetch or delete.

## Statelessness

A fresh `McpServer` and transport are created for **every** HTTP request and torn down when it
closes (`src/mcp/server.ts`). Nothing about a caller is kept in memory between calls — every tool
re-reads the user fresh from Convex (or the in-memory store in local dev) on every single call,
never a snapshot taken earlier in the request.

## Authentication — `Authorization: Bearer <token>`, not a tool argument

Checked against the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization):
the spec **requires** the bearer token in the `Authorization` HTTP header on every request
(`Authorization: Bearer <access-token>`), and explicitly forbids putting it in the URI query
string. An earlier version of this connector took the token as a plain tool argument instead —
that's fixed. A tool argument is worse than just being non-compliant: it puts the credential
inside the JSON-RPC payload the model itself constructs and reasons over, which means it can end
up in the model's own context, transcripts, and any logging the AI provider does on tool-call
arguments. The header never reaches the model at all.

`POST /mcp` now verifies the bearer token **before** any JSON-RPC is parsed. Missing or invalid →
`401` with `WWW-Authenticate: Bearer realm="allegra-mcp"`, per spec. A valid token resolves to a
`userId`, which every registered tool for that request closes over — each tool still does its own
fresh `auth.getUser(userId)` read rather than trusting a copy taken at the top of the request.

**Setting up a connector (v1 — bearer token, not full OAuth):** call `POST /api/auth/anon` (or log
into an existing account) to get a token, then configure your MCP client to send it as
`Authorization: Bearer <token>` on every request to `/mcp`. This satisfies the header requirement
above but **not** the rest of the spec's OAuth 2.1 machinery — there is no
`/.well-known/oauth-protected-resource` metadata endpoint, no authorization-server discovery, and
no token audience binding (RFC 8707), because Allegra is both its own resource server and its own
authorization server here (a self-issued JWT, not a third-party-issued one). That's a real gap
against a fully spec-compliant OAuth 2.1 resource server, tracked as a v2 stretch goal in the plan
doc — it matters for a client that expects to *discover* how to authenticate automatically, less
for one (like ChatGPT's "API key" custom-connector mode) that just wants a static header configured
once.

## Error shape

Every tool returns a normal MCP `CallToolResult`. On success: `{ content: [{ type: 'text', text:
'<JSON>' }] }` — the JSON is documented per tool below. On failure: the same shape with `isError:
true` and a user-facing sentence in `text` — never a stack trace, never a raw provider error (same
rule as the HTTP API). A tool never throws a protocol-level error for an expected failure
(not-found song, no AI configured); that discipline lives in `withUser()` in `src/mcp/tools.ts`.
Auth failures are the one thing that short-circuits *before* any tool runs — see above.

## Tools

### Read-only

Every tool below also requires the `Authorization: Bearer <token>` header on the HTTP request — it
is never listed as a tool argument.

| Tool | Args | Returns |
|---|---|---|
| `get_taste_profile` | *(none)* | `{ topArtists, languages, signals, onboarded }` — identical shape to `GET /api/me/taste` |
| `get_listening_stats` | *(none)* | `{ totalPlaysLogged, playsLast7Days, minutesListenedLast7Days, distinctSongsLast30Days, topArtists, topLanguages, signals, onboarded }` |
| `search_catalog` | `query`, `limit?` (≤25) | `{ id, title, artist, album?, duration, language?, artwork }[]` — no `streamUrl`, on purpose: an external AI has no reason to hold a playback URL |
| `get_lyrics` | `songId`, `syncedOnly?` | `LyricsPayload` (`{ source, type, matchScore, matchReason, lines }`), same as `GET /api/lyrics` |
| `translate_lyrics` | `songId`, `targetLanguage?` (default `English`) | `{ lines, provider }` |
| `get_recommendations` | *(none)* | `{ reasoning, songs }` — same taste-aware engine as `GET /api/ai/recommendations`, via the shared `buildRecommendationInput` helper |
| `list_playlists` | *(none)* | `{ id, name, description?, isPublic, songIds, createdAt }[]` |

### Write

| Tool | Args | Effect |
|---|---|---|
| `log_listen` | `songId`, `playedSeconds` (0–3600) | Runs the same `playWeight` → `applySignal` fold as the player's own `/api/me/taste/signal`. Returns the updated taste summary. |
| `record_feedback` | `songId`, `action: 'like' \| 'unlike' \| 'skip'` | `like`/`unlike` mirror `/api/me/liked` (mutates the liked list **and** the taste signal); `skip` is signal-only. Returns `{ songId, action, liked? }`. |
| `create_playlist` | `name`, `description?`, `isPublic?` | Adds an empty playlist to the caller's library. Returns the new playlist. |
| `add_song_to_playlist` | `playlistId`, `songId` | Mirrors `POST /api/libraries/:id/songs`, including the `playlistAdd` taste signal on first add. |
| `share_playlist` | `playlistId` | Mirrors `POST /api/libraries/:id/share` — creates or returns the existing share code, and makes the playlist public. |

## Not yet built (see the plan for why)

- `nudge_taste` — free-text taste correction ("more Anuv Jain lately")
- `set_home_feed` — write a personalized override that `/api/home` would prefer
- `blend_taste` — the two-user Duet/Blend feature built on `mergeTaste()`
- `generate_wrapped` — narrative monthly listening summary

## Rate limiting

`/mcp` currently falls into the default `api` rate-limit bucket (120 req/min, see `createRateLimiter`
in `src/app.ts`) — there is no MCP-specific bucket yet (plan work item 8).

## DNS rebinding protection — reviewed, not applicable

The SDK's transport supports `allowedHosts`/`allowedOrigins`/`enableDnsRebindingProtection`. That
guards a server listening on `localhost` from a malicious webpage rebinding DNS to reach it through
a victim's browser. `/mcp` is a public HTTPS App Runner endpoint called server-to-server (by
ChatGPT's backend, not from inside a user's browser tab), so that attack doesn't apply here — noted
so this isn't mistaken for an oversight.

## Known gap before real users

There is **no token revoke/rotate endpoint**. A connector holds a 30-day bearer JWT; if it leaks,
the only recourse today is waiting out the expiry. Ship plan work item 7 before pointing real
accounts at this.
