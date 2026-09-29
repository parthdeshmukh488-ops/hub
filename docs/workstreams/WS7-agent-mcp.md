# WS7: Agent tools, MCP server and demo agent (`packages/tools`, `packages/mcp`, `apps/agent-demo`)

## Mission

Put Leash in the agent's hands. Three deliverables share one tool contract:

1. **`@leash/tools`:** the implementation of the four Leash tools (02 §8), usable by any agent framework.
2. **`@leash/mcp`:** an MCP server, so any MCP client (Claude Desktop, Claude Code, Cursor) gets a Leash wallet in one config line. This is our distribution story for first users.
3. **`apps/agent-demo`:** a Claude-powered agent plus a deterministic scenario runner. This is the demo the judges watch.

## Read first

[02-contracts §8](../architecture/02-contracts.md#8-agent-tools-sdk-mcp-server-demo-agent) (the tool contract) · [00-overview §5](../architecture/00-overview.md#5-key-flows) · [03-security](../architecture/03-security.md) (T1, T2, T17) · [04-conventions](../architecture/04-conventions.md) · [WS9 → the demo storyline](WS9-integration-story.md#the-demo-storyline) · **before writing any Anthropic SDK code, load the `claude-api` skill** and follow it (model IDs, tool use, streaming)

## You own

`packages/tools/`, `packages/mcp/`, `apps/agent-demo/`

## You consume and provide

| Consumes | Provides |
| --- | --- |
| `@leash/sdk` (`LeashAgent`), `@leash/x402` (`leashFetch`), `@leash/contracts` (tool schemas, messages, pairing links), `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, merchant-demo (WS8) | Tools, MCP server, demo agent and scenario runner |

## Design notes

**`@leash/tools`**

- `createLeashTools({ agent, fetchImpl?, cluster }) → { definitions, execute(name, input) }`. `definitions` are JSON Schemas generated from the zod input schemas in `@leash/contracts`. `execute` returns the exact output types of 02 §8.
- Convert `amountUsdc` → `bigint` with contract helpers; reject invalid input with `INVALID_INPUT`.
- Denials become `ToolError` with the message templates from `@leash/contracts` ("do not retry, the owner was notified"). `recorded`, `strikes` and `frozen` come from `PaymentDeniedError`.
- `leash_fetch` follows the automatic-approval behaviour of 02 §8 and truncates bodies to 20 000 characters, marking the truncation.
- The key never appears in any output, log or error (T17).

**`@leash/mcp`**

- A stdio MCP server exposing the four tools. Configured by env (`AGENT_KEYPAIR`, `AGENT_OWNER`, `LEASH_CLUSTER`, …).
- On startup, if the Agent PDA does not exist, it prints the pairing link (02 §11) to stderr and polls, and tools return `NOT_PAIRED` until pairing completes.
- The README has copy-paste configuration for Claude Desktop and Claude Code.

**`apps/agent-demo`**

- **LLM mode:** an Anthropic tool-use loop (model from `AGENT_MODEL`, default `claude-opus-5-5`) with the four Leash tools plus a plain `browse(url)` tool for free pages, which is where injected instructions arrive. The system prompt describes a research assistant with a budget; it does **not** mention attacks.
- **Scripted mode** (`AGENT_MODE=scripted`): replays a recorded sequence of tool calls per scene with the same terminal output, for a live demo that can't be derailed by model variance or latency. Recordings are made from real LLM runs (`--record`).
- **Honesty rule:** if a scene needs the model to fall for an injection and the model refuses, the scripted scene says "simulating a successful injection" on screen. We never claim the model was fooled when it wasn't. The point is that the policy holds either way.
- **Terminal UI:** each step on one line (thinking → tool → result); payments in green with an amount and a short explorer link; blocks in red with the reason and the strike count; a clear banner when the tripwire freezes the agent; a final summary (spent, blocked, status).
- **Scenes** (see WS9's demo storyline): `normal` (research purchases), `approval` (premium report above the instant limit), `injection` (poisoned page → attacker payment blocked → strikes → tripwire), `runaway` (loop hits the rate limit), and `all`.

## Build order (quality gates)

1. **Tools package** with unit tests against a mocked `LeashAgent` and `leashFetch` (every error code path).
2. **Demo agent, LLM mode and terminal UI**, against merchant-demo on localnet (or LiteSVM-backed tools for a first pass).
3. **Scenes and scripted mode**, with recordings committed under `apps/agent-demo/scenes/`.
4. **MCP server**, tested with the MCP SDK's client in-process; README with Claude Desktop / Claude Code config.
5. **Pitch polish:** timing, colours and wording tuned with WS9 for the recording.

## Definition of done (in addition to the general one)

- `pnpm --filter agent-demo demo:all -- --scripted` runs the whole storyline reliably with no API key.
- The MCP server works from Claude Code with only the README's instructions.
- Tool messages for denials never suggest a workaround.

## Pitfalls

- Don't put policy logic in the tools; the SDK and the program decide. The tools translate.
- Keep the demo agent honest and the prompts realistic. Judges will notice theatre.

## Starter prompt

```text
You are the WS7 (Agent tools, MCP server and demo agent) engineer on Leash, a spending firewall for AI agents on Solana.

Before anything else:
1. Merge the latest main into your branch.
2. Read CLAUDE.md, docs/architecture/00-overview.md, docs/workstreams/WS7-agent-mcp.md and every document its "Read first" section lists. Load the claude-api skill before writing any Anthropic SDK code.
3. Read docs/workstreams/status/WS7.md (create it from docs/workstreams/status/README.md if missing) and any ADRs newer than it.

Then tell me in a short message: what you understand your job to be, which build step you will do now, your plan for it, and anything in the spec that looks wrong or underspecified. Wait for my OK before writing code.

Rules: only edit packages/tools, packages/mcp, apps/agent-demo and your status file; follow docs/architecture/04-conventions.md; contract changes go through an ADR; end every work block by updating your status file, committing and pushing.
```
