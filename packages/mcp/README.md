# @leash/mcp

An MCP server that gives any MCP client (Claude Code, Claude Desktop, Cursor) a Leash wallet: four tools that pay from the owner's allowance, under the owner's on-chain spending policy ([02-contracts §8](../../docs/architecture/02-contracts.md#8-agent-tools-sdk-mcp-server-demo-agent)). The client's model decides what to buy; the Leash program decides whether it may.

Owned by **WS7**. Brief: [docs/workstreams/WS7-agent-mcp.md](../../docs/workstreams/WS7-agent-mcp.md). Status: [docs/workstreams/status/WS7.md](../../docs/workstreams/status/WS7.md).

| Tool | What it does |
| --- | --- |
| `leash_fetch` | Fetches a URL. If the service charges over x402 (HTTP 402), it pays and returns the content with a receipt. |
| `leash_pay` | Pays USDC to a wallet. |
| `leash_request_approval` | Asks the owner to approve one payment above the instant limit. |
| `leash_status` | Frozen or active, allowance left, limits, allowed recipients, strikes. |

A blocked payment comes back as an error result carrying the contract's JSON, for example:

```json
{ "ok": false, "code": "PAYEE_NOT_ALLOWED", "recorded": true, "strikes": 1, "frozen": false, "retryable": false,
  "message": "Blocked by the owner's spending policy: this recipient is not on the allowlist. The attempt was recorded and the owner was notified. Do not retry this payment or try another way to pay. Continue the task without paying, or ask the owner." }
```

## Configure

Only `AGENT_OWNER` is required ([02-contracts §13](../../docs/architecture/02-contracts.md#13-environment-variables)):

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_OWNER` | none | The owner wallet whose principal holds this agent |
| `AGENT_KEYPAIR` | `~/.config/leash/agent.json` | The agent key, a Solana CLI keypair file. Created on first run (mode 0600) if missing. |
| `LEASH_CLUSTER` | `localnet` | `localnet` or `devnet` |
| `LEASH_RPC_URL` | per cluster | Another RPC, e.g. a Helius devnet URL |
| `LEASH_PRIORITY_FEE_MICROLAMPORTS` | `1` | At most 50 000 |

The agent key signs payments. It never holds the owner's funds: it can move only what the owner's allowance and policy permit (invariant I1). It pays the network fees of its own transactions (`leash_pay`, reports of blocked attempts), so it needs a little SOL (`solana airdrop 1 <agent key> --url devnet`). For `leash_fetch`, the x402 facilitator pays the fee.

The examples use absolute paths into your checkout of this repo (`/path/to/hub`), after `pnpm install`. Start the server with `tsx` directly, not through `pnpm run`: pnpm prints to stdout, and stdout carries the MCP protocol.

### Claude Code

```bash
claude mcp add --transport stdio leash \
  --env AGENT_OWNER=<owner wallet> --env LEASH_CLUSTER=devnet \
  -- /path/to/hub/packages/mcp/node_modules/.bin/tsx /path/to/hub/packages/mcp/src/main.ts
```

Or check it into a project as `.mcp.json`, in the same shape as the Claude Desktop file below. Checked with Claude Code 2.1.286: this command adds the server, and `claude mcp list` reports it `Connected`.

### Claude Desktop

In `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`):

```json
{
  "mcpServers": {
    "leash": {
      "command": "/path/to/hub/packages/mcp/node_modules/.bin/tsx",
      "args": ["/path/to/hub/packages/mcp/src/main.ts"],
      "env": { "AGENT_OWNER": "<owner wallet>", "LEASH_CLUSTER": "devnet" }
    }
  }
}
```

### Pairing

On startup the server checks whether the owner has paired this agent key (whether its Agent account exists).

- **Not paired yet:** the pairing link (02 §11) goes to stderr, which is the client's MCP log. Every tool answers `NOT_PAIRED` with the link in its message, so the model can hand it to you. The server polls every 5 seconds and logs `paired` once the owner has signed.
- **The demo keys:** `pnpm devnet:setup` pairs `.keys/agent.json` with `.keys/owner-demo.json`. Set `AGENT_KEYPAIR=/path/to/hub/.keys/agent.json`, and set `AGENT_OWNER` to the owner-demo address.

The web app's pairing page belongs to WS6. Until it ships, pair with the demo keys.

## What the server logs

Everything goes to stderr, prefixed `leash-mcp:`: key creation, `ready` with the agent key and owner, pairing, SDK warnings (a low SOL balance, a failed report), and the details of internal failures. An internal failure reaches the model only as a fixed message telling it to stop, never the error text (03-security T17).

## Test

```bash
pnpm --filter @leash/mcp test
```

- **In process** (the MCP SDK's own client over `InMemoryTransport`), with the real tools on the real `leash.so` in LiteSVM. Payments go through the official x402 facilitator to a merchant.
  - Listing: the four tools, with exactly the contract's input schemas.
  - A paid `leash_fetch` returns the contract's receipt.
  - A blocked `leash_pay` is an error result carrying the contract's message; three strikes and the tripwire freezes the agent, after which even allowed merchants are refused.
  - `NOT_PAIRED` carries the pairing link.
  - Bad input answers `INVALID_INPUT`; an unknown tool is a protocol error; internal errors stay out of the model's view.
- **Over real stdio** (`src/main.ts`, spawned as a client would): without `AGENT_OWNER` it exits and writes nothing to stdout. With it, it creates the key (mode 0600), serves the tools, and answers `NETWORK_ERROR` while the RPC is out of reach.
