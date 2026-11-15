# docs/ — reference material

**Start here:** [Current codebase map](./current-codebase.md) for the subsystem owner, source entry
point, and recent changes. Open the corresponding contract before changing behavior.

| File | What it is |
|---|---|
| [api-contract.md](./api-contract.md) | The contract for Express, web and Android callers. Propose behavior and shape changes first. |
| [Connect](./connect-contract.md) and [LuvLink](./luvlink-contract.md) | Account-device control and room playback contracts. |
| [Audit reference](../audit/CODEBASE-KNOWLEDGE.md) and [backlog](../audit/FIX-BACKLOG.md) | Dated traces, test results, coverage and actionable findings. |
| [LuvLyrics](../apps/mobile/README.md), [mobile rules](../apps/mobile/CLAUDE.md), and [mobile design](../apps/mobile/DESIGN.md) | Current Android entry points and development rules. |
| [architecture.md](./architecture.md) | End-to-end design: state owners, playback, karaoke, auth, seams |
| [decisions.md](./decisions.md) | Choices that are easy to undo by accident (glass, matching, Spotify sync, Blend design), with why |
| [LEARNING-LOG.md](../.planning/LEARNING-LOG.md) | Session incidents, confirmed causes and checkable prevention rules |
| [Blend/Spotify handoff](../.planning/blend/HANDOFF-2026-10-05.md) | Historical 2026-10-05 branch/release snapshot; recheck Git and release state before relying on it |
| [Integration status and agent context](../.planning/INTEGRATION-STATUS.md) | October 2026 recheck notes and context setup. Use the current map for checkout status. |
| [dj.md](./dj.md) | Your DJ, front to back: page UX, mascot, session, commands, local and BYOK brains, voice, API routes |
| [workflows.md](./workflows.md) | Develop, verify, ship — including how to prove Range/206 and playback survival |
| [circleci-android-preview.md](./circleci-android-preview.md) | Manual CircleCI workflow: universal preview APK plus emulator smoke test, dashboard setup, credits |
| [auth-convex-google.md](./auth-convex-google.md) | Setting up Google sign-in through Convex Auth |
| [motion-design-system.md](./motion-design-system.md) | The motion language: tokens, easing, choreography |
| [motion-recipes.md](./motion-recipes.md) | Copy-paste motion patterns, then tune |
| [provider-integration.md](./provider-integration.md) | Adding or repairing a music/lyrics provider |
| [Allegra for Windows](../apps/desktop/README.md) | Build and run the Windows desktop app around the hosted site |
| [mcp-contract.md](./mcp-contract.md) | The Allegra MCP connector |
| [data-breach-plan.md](./data-breach-plan.md) | Incident containment and notification runbook |
| [grievance-handling.md](./grievance-handling.md) | Report queue, takedown commands and response clocks |
