# 19 — MCP CONNECTOR PLAN

Written 2026-09-21. Adds a stateless MCP (Model Context Protocol) server so ChatGPT — or any
MCP-compatible client — can read and shape a listener's Allegra taste profile directly, instead of
building a second AI chat surface inside the website. Everything below is **additive**: it does not
touch `docs/api-contract.md` (frozen) or any existing route. It gets its own contract doc,
`docs/mcp-contract.md`, written alongside Phase A.

## Why this instead of an in-app AI chat

Allegra already computes taste server-side — `apps/api/src/user/taste.ts` turns
`playedSeconds / songSeconds` into a decaying per-artist/per-language score
(`playWeight` → `applySignal`), persisted on the Convex user doc. An MCP connector exposes that
same engine to a model the listener already has open (ChatGPT), so "understand my taste and act on
it" doesn't require Allegra to own a chat UI, a model subscription, or a second inference bill —
it reuses the AI the user already pays for.

## Architecture decisions

1. **One new route, no new service.** Mount the MCP server (`@modelcontextprotocol/sdk`'s
   streamable-HTTP transport) at `POST /mcp` on the existing `apps/api` Express app. Same App
   Runner deployment, same config, same CORS story (server-to-server, not browser-facing — no
   `VITE_*` involvement, satisfying hard rule 2 by construction).
2. **Actually stateless.** The MCP process keeps no per-connection session. Auth is the
   `Authorization: Bearer <token>` HTTP header, verified once per request **before any JSON-RPC is
   parsed** — checked against the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization),
   which requires the header and forbids the query string. **Not** a tool argument: an earlier
   draft of this plan floated "else an explicit `authToken` argument" as a fallback, and the first
   implementation pass actually shipped that way before this got checked against the spec — a tool
   argument puts the credential inside the JSON-RPC payload the *model itself* constructs, which
   means it can land in the model's own context and any provider-side tool-call logging. The header
   never reaches the model. Every tool still does its own fresh `auth.getUser(userId)` read rather
   than trusting a copy taken earlier in the request — no in-memory user object survives between
   calls, and none survives across a batch of calls in one HTTP request either. This is what makes
   it safe for ChatGPT's scheduled Tasks to hit on a timer and safe to run on the same instance as
   the streaming proxy.
3. **Reuse the existing auth, don't build a second one.** `AuthService` already issues 30-day JWTs.
   V1 ships **API-key-style auth**: the listener pastes their Allegra token as the connector's
   credential in ChatGPT. Full OAuth 2.1 (letting someone log in with Allegra credentials from
   inside ChatGPT's connector setup) is real but bigger — tracked as a v2 stretch goal, not a v1
   blocker.
4. **Convex schema additions** (new fields only, nothing existing renamed — `convex/schema.ts`):
   - `homeOverride` on `users`: `{ songIds: string[], reason: string, updatedAt: string }`,
     optional. `GET /api/home` prefers this when present and fresh (e.g. < 24h old), falls back to
     today's algorithm otherwise.
   - `blends` table (new): `{ id, userIdA, userIdB, songIds, createdAt }`, written only after both
     sides have consented (see Phase C).
5. **`nudge_taste` never writes raw text into the taste table.** Free-text correction goes through
   the AI cascade already wired in `aiClient.ts`, gets turned into artist/language names, and is
   applied through the existing `applySeeds`/`applySignal` functions — the taste table stays "a few
   dozen numbers," per the existing doc comment in `taste.ts`, not a text blob.

## Tool list, phased

### Phase A — read-only wrappers (adapter code only, zero new business logic)

| Tool | Backed by |
|---|---|
| `get_taste_profile` | `user.taste` (Convex) |
| `get_listening_stats` | new small aggregation over `user.recentlyPlayed` |
| `search_catalog` | `CatalogService.search` |
| `get_lyrics` | existing lyrics ladder route |
| `translate_lyrics` | `TranslationService` |
| `get_recommendations` | `RecommendationService.recommend` |
| `explain_recommendation` | the `reasoning` string `RecommendationService` already returns |
| `list_playlists` | `user.libraries` |

### Phase B — write tools (extend the existing taste/library engine)

| Tool | What it does | New code needed |
|---|---|---|
| `log_listen` | Runs `playWeight` + `applySignal`, saves `user.taste` | A public entry point — today this logic only fires from the player's own recent-play update path |
| `record_feedback` | like / unlike / skip signal, `SIGNAL_WEIGHT` | Small |
| `nudge_taste` | Free-text correction ("more Anuv Jain lately") → AI extracts names → `applySeeds` | Medium — one AI prompt + parser |
| `create_playlist` / `add_song_to_playlist` | `user.libraries` | Thin, mirrors existing library routes |
| `share_playlist` | `shares.ts` | Thin |

### Phase C — new product surface (the genuinely new features)

| Tool | What it does | New code needed |
|---|---|---|
| `set_home_feed` | Writes `homeOverride`, read by `/api/home` | Medium — schema field + one read-path branch |
| `blend_taste` (Duet) | Both users consent → `mergeTaste()` (already exists, built for guest merge) → generates a shared playlist | Medium/large — consent flow + `blends` table |
| `generate_wrapped` | Narrative monthly summary from `get_listening_stats` + `get_taste_profile` | Small — pure reasoning, no write |

### Explicitly out of scope for v1

- Full OAuth 2.1 for the connector (ship paste-a-token auth first)
- Event-triggered ChatGPT Tasks (only time-based scheduling is relevant here; event triggers only fire on specific supported connector events, not arbitrary MCP state)
- Anything that has ChatGPT message the user outside of a Task run it owns

## Security / hard-rule compliance

- Handing a 30-day Allegra JWT to ChatGPT as a connector credential is a real bearer-credential
  exposure — there is currently **no token revoke/rotate endpoint**. Add one (`POST
  /api/auth/revoke` or shorten MCP-issued tokens to a separate, shorter-lived scope) before this
  ships to real users, not after.
- Every MCP tool handler gets the same `AbortController` timeout + try/catch-return-empty
  discipline as every other outbound call in this codebase (hard rule 9) — one bad tool call must
  not take down the MCP connection.
- Add per-token rate limiting on `/mcp` — it's a new authenticated-but-public surface, and unlike
  the browser it isn't behind the CORS allowlist.
- No `console.log` in the handler path (hard rule 10) — MCP tool errors go through the existing
  logger.

## Work list

| # | Task | Status |
|---|---|---|
| 1 | `docs/mcp-contract.md` — every tool's name, args, return shape, error shape | **Done** |
| 2 | `apps/api/src/mcp/server.ts` — mounts `@modelcontextprotocol/sdk` streamable-HTTP transport at `POST /mcp`, verifies the bearer token per HTTP request from the `Authorization` header, before any JSON-RPC is parsed | **Done** — fresh `McpServer` + transport per request, `GET`/`DELETE /mcp` return 405, missing/invalid token returns `401` + `WWW-Authenticate` per spec |
| 3 | Phase A tools wired as thin adapters over existing services | **Done** — `get_taste_profile`, `get_listening_stats`, `search_catalog`, `get_lyrics`, `translate_lyrics`, `get_recommendations`, `list_playlists`, covered by `src/mcp/server.test.ts` (real MCP `Client` + `StreamableHTTPClientTransport` over a live HTTP server, not a mock) |
| 4 | `log_listen` + `record_feedback` public entry points, plus `create_playlist` / `add_song_to_playlist` / `share_playlist` | **Done** — reuses `learn()` and `tasteSummary()` exported from `routes/user.ts` and `newCode()` from `routes/shared.ts`, so the MCP path and the HTTP path can't drift. `routes/ai.ts`'s recommendation handler was refactored to share `buildRecommendationInput` (new `services/recommendationContext.ts`) with the MCP tool instead of duplicating it. |
| 4a | **Hardening pass:** moved auth off tool arguments and onto the `Authorization` header, per the MCP authorization spec | **Done** — see decision 2 above. Caught by checking the implementation against `modelcontextprotocol.io`'s authorization spec after the fact; the first pass had shipped `authToken` as a tool argument, which is spec-non-compliant and leaks the credential into the model's own context. Tests added: a request with no header gets 401, a bad token is rejected before any tool runs, and a second listener's session never sees the first listener's taste (proves the per-request `userId` closure carries no cross-request state). |
| 5 | `nudge_taste` prompt + parser | Not started |
| 6 | Convex: `homeOverride` field + `/api/home` read-path branch | Not started |
| 7 | Token revoke/rotate endpoint | **Not started — still do this before any real (non-test) token is ever configured on a ChatGPT connector.** The header fix in 4a reduces exposure (the token no longer leaks into model context) but doesn't remove the need to revoke a token if the *header value itself* leaks some other way (a compromised client config, a logged request somewhere upstream of us). |
| 8 | Rate limiting on `/mcp` | Not started — currently shares the default `api` bucket (120/min), see `docs/mcp-contract.md` |
| 9 | `blend_taste` consent flow + `blends` table | Not started |
| 10 | `generate_wrapped` | Not started |
| 11 | Full OAuth 2.1 resource-server compliance (protected resource metadata, authorization-server discovery, token audience binding) | Not started — the spec gap called out in decision 3 / `docs/mcp-contract.md`. Matters for a client that expects to discover auth automatically; the current static-header approach is a deliberate v1 shortcut, not an oversight. |
| 12 | Connect a real ChatGPT developer-mode connector to a deployed `/mcp` and run each shipped tool from an actual chat | Not started — needs a deployed URL, cannot be done from this session |

**Shipped this pass:** `@modelcontextprotocol/sdk` added to `apps/api`; `src/mcp/{context,server,stats,tools}.ts`
+ `src/mcp/{server,stats}.test.ts`; `services/recommendationContext.ts`; `learn`/`tasteSummary`
exported from `routes/user.ts`, `newCode` exported from `routes/shared.ts`; `/mcp` mounted in
`app.ts`; then hardened against the actual MCP authorization spec (auth moved from a tool argument
to the `Authorization` header, gated before JSON-RPC parsing). All 132 API tests, typecheck, and
lint are green.

## Needs a human

- Decide paste-token vs. OAuth for v1 (this plan recommends paste-token — say so explicitly if you disagree before work starts).
- Register the connector in ChatGPT (Developer mode → Add connector → your deployed `/mcp` URL) — cannot be done from this session.
- Consent-copy for Blend/Duet: this shares one listener's taste data with another named account. Needs an actual sentence a real user would read and agree to, not a placeholder.
- Confirm whether the token-revoke endpoint (work item 7) ships *before* or *gated on* item 9 (Blend) — item 9 is the one where a leaked token does the most damage (it can write, not just read).
