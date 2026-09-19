# docs/ — reference material

Research and reference for building Allegra. Planning and schedule live in `.planning/`.

| File | What it's for | Who reads it |
|---|---|---|
| **`api-contract.md`** | ⭐ The frozen FE↔BE contract. **The most important file here.** | Everyone |
| `provider-integration.md` | Music/lyrics/artwork provider essentials | P1 |
| `ALLEGRA_BACKEND_SPEC.md` | Full provider reference, extracted from a working production implementation | P1 |
| `aws-services-reference.md` | What we deploy, why, and the architecture answers to rehearse | P3, everyone before the video |
| `motion-recipes.md` | Copy-paste motion code | P2 |
| `agent-prompts/` | Per-role AI agent briefings | Everyone |

## Working with AI agents
1. Open a fresh session in the repo
2. Paste your role's briefing from `agent-prompts/`
3. The agent reads `CLAUDE.md` + `AGENTS.md` automatically for project rules
4. Work **one ticket at a time** — review each diff before moving on

**You own every diff.** An agent proposes; you read it, run it, and put your name on the commit. *Technical Understanding* is a scored criterion, and "the AI wrote it" is not an answer. Log what you used in `.planning/LEARNING-LOG.md` as you go — the rules require disclosing AI tools in the write-up.
