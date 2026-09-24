# MCP CONTRACT — the Allegra connector

> This is a **separate, additive surface**. It does not touch `docs/api-contract.md`, which stays
> frozen and browser-facing. This doc covers `POST /api/mcp` only — the endpoint an MCP client
> (ChatGPT, Claude, or any other MCP-compatible host) talks to. See
> `.planning/19-MCP-CONNECTOR-PLAN.md` for the design rationale.

Endpoint: `POST {API_BASE_URL}/api/mcp` — a stateless [Streamable HTTP](https://modelcontextprotocol.io)
MCP transport (`@modelcontextprotocol/sdk`). `GET`/`DELETE /api/mcp` return `405`; there is no session
to fetch or delete.

## Statelessness

A fresh `McpServer` and transport are created for **every** HTTP request and torn down when it
closes (`src/mcp/server.ts`). Nothing about a caller is kept in memory between calls — every tool
re-reads the user fresh from Convex (or the in-memory store in local dev) on every single call,
never a snapshot taken earlier in the request.

## Authentication — OAuth 2.1, bearer tokens, never tool arguments

Checked against the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization):
the spec **requires** the bearer token in the `Authorization` HTTP header on every request
(`Authorization: Bearer <access-token>`), and explicitly forbids putting it in the URI query
string. An earlier version of this connector took the token as a plain tool argument instead —
that's fixed. A tool argument is worse than just being non-compliant: it puts the credential
inside the JSON-RPC payload the model itself constructs and reasons over, which means it can end
up in the model's own context, transcripts, and any logging the AI provider does on tool-call
arguments. The header never reaches the model at all.

`POST /api/mcp` verifies the bearer token **before** any JSON-RPC is parsed. Missing or invalid →
`401` with a `WWW-Authenticate` header that points the client to
`/.well-known/oauth-protected-resource/api/mcp`.

MCP hosts discover the authorization server from that protected-resource document, then use
`/.well-known/oauth-authorization-server` for the authorization, token, and registration endpoints.
The flow is OAuth 2.1 authorization code with S256 PKCE, RFC 8707 resource binding, and refresh-token
rotation. Dynamic registration accepts public clients only and allows HTTPS redirects or localhost
HTTP redirects; client-ID metadata documents are fetched with redirect, size, and private-address
guards. Authorization codes and refresh tokens are one-time and their spent-token ledger is durable
in Convex in production.

An issued access token is for this exact `/api/mcp` resource and this exact host. App session tokens,
codes, refresh tokens, and tokens minted for another host or resource are refused. A valid token
resolves to a `userId`, which every registered tool for that request closes over — each tool still
does its own fresh user read rather than trusting a request-start snapshot.

## Error shape

Every tool returns a normal MCP `CallToolResult`. On success: `{ content: [{ type: 'text', text:
'<JSON>' }] }` — the JSON is documented per tool below. On failure: the same shape with `isError:
true` and a user-facing sentence in `text` — never a stack trace, never a raw provider error (same
rule as the HTTP API). A tool never throws a protocol-level error for an expected failure
(not-found song, no available translation, or insufficient listening context); that discipline lives
in `withUser()` in `src/mcp/tools.ts`.
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
| `get_recommendations` | *(none)* | `{ reasoning, songs }` — same catalogue-and-taste engine as `GET /api/recommendations`, via the shared `buildRecommendationInput` helper |
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

`/api/mcp` currently falls into the default `api` rate-limit bucket (120 req/min, see `createRateLimiter`
in `src/app.ts`) — there is no MCP-specific bucket yet (plan work item 8).

## DNS rebinding protection — reviewed, not applicable

The SDK's transport supports `allowedHosts`/`allowedOrigins`/`enableDnsRebindingProtection`. That
guards a server listening on `localhost` from a malicious webpage rebinding DNS to reach it through
a victim's browser. `/api/mcp` is a public HTTPS endpoint called server-to-server (by
ChatGPT's backend, not from inside a user's browser tab), so that attack doesn't apply here — noted
so this isn't mistaken for an oversight.

## Token lifetime

Access tokens last one hour. Refresh tokens last 30 days and rotate on every use; replaying a spent
refresh token fails. There is no manual revocation endpoint yet, so removing an existing connector
still requires its access token to expire and its refresh token to become unusable at its next rotation.
