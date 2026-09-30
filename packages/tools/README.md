# @leash/tools

The four Leash agent tools (02-contracts §8) for any agent framework: `leash_fetch`, `leash_pay`, `leash_request_approval`, `leash_status`. The MCP server (`@leash/mcp`) and the demo agent (`apps/agent-demo`) both use them.

Owned by **WS7**. Brief: [docs/workstreams/WS7-agent-mcp.md](../../docs/workstreams/WS7-agent-mcp.md). Status: [docs/workstreams/status/WS7.md](../../docs/workstreams/status/WS7.md).

## Use

```ts
import { createLeashTools } from "@leash/tools";
import { resolveClusterConfig } from "@leash/contracts";

const tools = createLeashTools({ agent, leashFetch, cluster: resolveClusterConfig("devnet") });

// Give Claude the definitions (name, description, input_schema)…
const response = await client.messages.create({ model, max_tokens, tools: [...tools.definitions], messages });
// …and run whatever it calls:
const output = await tools.execute(block.name, block.input);   // the exact output types of 02 §8
```

- `agent` implements `LeashAgentPort` (`status`, `pay`, `requestApproval`). The SDK's `LeashAgent` will implement it (WS2).
- `leashFetch` implements `LeashFetchPort`: an HTTP fetch that pays x402 challenges through Leash (WS3).
- Both throw only the SDK's typed errors. See [`src/ports.ts`](src/ports.ts).

## What the tools do, and what they don't

They translate. The SDK and the program decide.

- **Inputs:** validated with the contract's zod schemas. Invalid input returns `INVALID_INPUT` with the reason. Amounts must be above zero; purposes are cut to the 64-byte on-chain memo at a character boundary.
- **Denials:** each becomes a `ToolError` with the contract's fixed message, which tells the model to stop and never suggests a way around the policy. `recorded`, `strikes` and `frozen` come from the SDK's `PaymentDeniedError`. The sentence "The attempt was recorded and the owner was notified" appears only when `recorded` is true.
- **Approval:** when a payment needs approval, `leash_fetch` and `leash_pay` open the payment request themselves and return `APPROVAL_REQUIRED` with the request's address. A later call pays with the approved request.
- **Limits and truncation:** `leash_fetch` bodies are cut at 20 000 characters, with a note saying how much was left out.
- **Status:** `leash_status` reports the agent's state, allowance, limits, allowed payees with what is left for each, and current strikes. Windows that have ended count as reset.
- **Errors never leak:** text from underlying errors never reaches the model; only the contract's messages do (T17). An error that is not one of the SDK's typed errors is a bug, and is rethrown rather than turned into a guess.

**Tool schemas are not `strict`.** Strict tool schemas can't express `leash_fetch`'s free-form `headers` map, so the tools validate every input themselves instead.

## Test

```bash
pnpm --filter @leash/tools test        # 19 tests: every error code path, against mocked ports
pnpm --filter @leash/tools typecheck
pnpm --filter @leash/tools lint
```
