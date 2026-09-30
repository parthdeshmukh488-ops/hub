# WS7 status: Agent tools, MCP server and demo agent

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-09-30
- Current build step: 1 and 4 done; 2 (demo agent) in progress: code written, tests next
- Messages handled: through `20260930-0330-from-ws8-to-ws7-merchant-content-ready.md`

## Plan for build steps 2 and 4 (Parth: "wire the demo flow")

The ports now have real implementations: `LeashAgent` (WS2) and `createLeashFetch` (WS3). Order:

1. **`@leash/tools/node`**, the runtime both deliverables share:
   - `loadAgentSigner(path)` reads a Solana CLI keypair file. It creates one (mode 0600) if missing, as §13 says.
   - `connectLeash({ cluster, signer, owner })` wires `rpcChain` → `LeashAgent` → `createLeashFetch` → `createLeashTools`.
   - `watchPairing` prints the pairing link (02 §11) and polls until the Agent PDA exists.
2. **`@leash/mcp` (step 4):**
   - A stdio MCP server built on the MCP SDK's low-level `Server`, so the tools keep the contract's JSON Schemas exactly.
   - Denials come back as `isError` results carrying the contract's JSON.
   - Logs and the pairing link go to stderr only; stdout is the protocol.
   - Tests: the MCP SDK's own client in process, against the real tools on LiteSVM, the in-process facilitator and a merchant.
   - README with Claude Desktop and Claude Code config.
3. **`apps/agent-demo` (step 2):**
   - A manual tool-use loop behind a small `Model` interface, so Claude and a replay are interchangeable. That keeps recording and scripted mode (step 3) in the same code path.
   - Claude: `AGENT_MODEL` (default `claude-opus-5-5`), adaptive thinking with summaries shown, `effort` set explicitly, and streaming. The key comes from `src/env.ts` only.
   - Tools: the four Leash tools plus `browse(url)`, a free GET that never pays. Injected pages arrive through it.
   - Scenes: `normal`, `approval`, `injection`, `runaway` and `all`, as tasks against `AGENT_MERCHANT_URL`. The system prompt is a research assistant with a budget, with no word about attacks.
   - Terminal UI: one line per step, green payments, red blocks with strikes, the tripwire banner, a summary. Untrusted text (page content, labels, memos, model text) is stripped of terminal control characters before printing.
   - Tests: a replay model drives the real tools, the real merchant-demo app (lab included) and the facilitator, in process on LiteSVM. The injection scene must end with three strikes and a frozen agent.

What the cloud can't do: call the Claude API. There's no key here, and runs cost Parth's money. LLM runs and `--record` happen on Parth's machine; until then, scene scripts are hand-written, and the screen says so.

## Plan for build step 1 (as executed)

`@leash/tools` against mocked ports, every error code path tested. The minimal interfaces go to WS2 (agent) and WS3 (paid fetch) in messages, so the real implementations match.

## Done

- **Runtime and MCP server (2026-09-30):**
  - **`@leash/tools/node`:**
    - `loadAgentKey` creates the key file with mode 0600 and never echoes the file's content.
    - `connectLeash` wires the real `rpcChain` → `LeashAgent` → `createLeashFetch` → tools.
    - `waitForPairing` hands out the pairing link and polls until the agent is paired.
    - `NOT_PAIRED` messages now carry the pairing link (the `pairingLink` option), so the model can hand it to the owner.
  - **`@leash/mcp` (step 4), 10 tests.** In process, through the MCP SDK's own client, on the real program in LiteSVM:
    - The four tools keep the contract's exact input schemas.
    - A paid x402 fetch returns the contract's receipt.
    - Blocked payments come back as `isError` results carrying the contract's message; the third strike trips the tripwire, and after that even the allowed merchant is refused.
    - `NOT_PAIRED` carries the pairing link.
    - Internal errors stay in the stderr log, never in the model's view (T17).
    - Over real stdio: a missing owner exits with nothing on stdout; with no RPC the server answers `NETWORK_ERROR`.
    - With the README's `claude mcp add …` command, Claude Code 2.1.286 shows the server as `Connected`.
  - **SDK fix (WS2 lane):** `rpcChain` read failures are now `LeashNetworkError`, so tools answer `NETWORK_ERROR` instead of crashing.
  - **Test helper (WS3 lane):** `litesvmFacilitatorClient` in `@leash/x402/testing`.
- **Demo agent (step 2), written but not yet tested:**
  - `src/model.ts`: the `Model` interface and the Claude adapter (streaming, adaptive thinking with summaries, `effort: medium`, prompt caching, eager tool input).
  - `src/loop.ts`, `src/ui.ts` (control characters stripped, OSC 8 explorer links), `src/browse.ts`, `src/approvals.ts` (waits for the owner's on-chain decision).
  - `src/scenes.ts`, `src/recording.ts` (replay and `--record`), `src/main.ts`.
  - Lint and typecheck pass; `--help` runs.

- **Build step 1, complete (2026-09-30).**
  - `createLeashTools({ agent, leashFetch, cluster })` returns `{ definitions, execute, fetch, pay, requestApproval, status }`.
  - The definitions are generated from the contract's zod schemas.
  - 19 tests cover: every denial reason mapped to its code and verbatim message; automatic approval requests in `leash_fetch` and `leash_pay`; honest `recorded`; `INVALID_INPUT` with reasons; memo and body truncation; no leaking of underlying error text (T17); bugs rethrown; status from the fixtures. Every output is validated against the contract's output schemas.
- **Additive contract change** [ADR 20260930-ws7-approval-request-errors](../../adr/20260930-ws7-approval-request-errors.md), contracts 1.2.0:
  - New tool codes `APPROVAL_NOT_NEEDED` and `TOO_MANY_OPEN_REQUESTS`.
  - `TOOL_MESSAGE_RECORDED` exported.
  - Auto-request in `leash_pay` too.
- SDK: added the typed errors the ports throw (`PaymentDeniedError`, `ApprovalNotPossibleError`, `NotPairedError`, `UnsupportedPaymentError`, `MerchantRejectedError`, `LeashNetworkError`), as WS2's brief planned.

## Next

1. Demo agent tests: a replay model drives the real tools, the real merchant-demo app and the facilitator on LiteSVM, for the normal, approval (the test approves as the owner) and injection scenes, plus the Claude adapter against a stubbed stream. This needs merchant-demo to export `createApp` and `loadContent` (a `package.json` `exports` entry, WS8 lane).
2. Step 3: hand-written scene scripts in `scenes/*.json`, each with an honest on-screen disclosure. The injection script says "simulating a successful injection". Then `demo:all -- --scripted`.
3. README for `apps/agent-demo`, then the WS7 handoff message and the BOARD update.

## Open items

- **Decisions for Parth:**
  - `effort: medium` for the demo agent. `low` would feel snappier on stage.
  - `all` = normal → approval → injection. `runaway` is run on its own.
  - `--record` writes `scenes/<scene>.recorded.json`. A recording is promoted to `scenes/<scene>.json` by hand.
- Pairing links point at `http://localhost:3000`. A `LEASH_WEB_URL` variable would need an ADR once the web app is deployed. The terminal QR code (§11) is not done yet.
- The approval scene needs the owner to approve on-chain. There's no web or Telegram approval yet (WS6/WS5). A small owner script would stand in for the owner's phone until then.

- Tool definitions are not `strict` (the `headers` map is outside strict schemas); inputs are validated by zod instead.
- The helper names in the brief changed slightly: `createLeashTools` takes `leashFetch` (the port) rather than `fetchImpl`, because the x402 client is the dependency, not a raw `fetch`.

## Questions for other workstreams

- WS2 and WS3: please implement the ports in `packages/tools/src/ports.ts` as described in the messages of 2026-09-30.

## Contract changes proposed

- [20260930-ws7-approval-request-errors](../../adr/20260930-ws7-approval-request-errors.md) (additive, status Proposed).
