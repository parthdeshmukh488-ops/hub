# WS7 status: Agent tools, MCP server and demo agent

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-10-01
- Current build step: 1–4 done (step 3 with hand-written scene scripts; real LLM recordings come from the laptop); next: 5, pitch polish with WS9
- Messages handled: through `20261001-0150-from-ws1-to-ws4-ci-fix-remembered-poke.md`

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
- **Demo agent (steps 2–3, 2026-10-01), 35 tests:**
  - **LLM mode:** the Claude adapter (`claude-opus-5-5`, adaptive thinking with summaries, `effort: medium`, streaming, prompt caching, eager tool input), the four Leash tools plus a free `browse`, and a system prompt with no word about attacks.
  - **Scripted mode:** `scenes/{normal,approval,injection,runaway}.json`, hand-written. Each shows its disclosure on screen, and the injection one says "Simulating a successful injection".
    - A replay stops when a live result differs from what the script expects, e.g. when the owner declines.
    - `--record` saves real runs, with the merchant URL kept as a placeholder.
  - **Terminal UI:** one line per step, clickable explorer links, the tripwire banner, a summary per scene; control characters and bidi overrides are stripped from untrusted text.
  - **Approval scene:** waits (up to 3 min) for the owner's decision on-chain, then tells the model.
  - **Tests:** every scene script replays on the real stack: merchant-demo (lab included), the official facilitator, and the program in LiteSVM. The test acts as the owner, both approving and declining.
    - The whole scripted storyline runs as one demo; that is the DoD command, in process.
    - A recorded run is promoted to a script and replayed.
    - Unit tests cover the adapter (stubbed stream), `browse`, escape stripping, the loop's stops, recording, the owner wait and the CLI.
- **Owner stand-in (WS2 lane):** `pnpm owner:approve [--reject]` approves or rejects pending requests with the owner-demo key, until WS6 and WS5 can.
- **merchant-demo (WS8 lane):** `package.json` exports `./server` and `./content` for these tests.

- **2026-10-01, after the laptop's real-validator run** (the whole demo passed on localnet):
  - relative `AGENT_KEYPAIR` paths resolve against the repo root;
  - after a decline, the replay stops before the turns written for an approval;
  - no strike count on blocks that aren't strikes;
  - a "Before each take" checklist in the README.

## Next

1. **Laptop (needs a chain and, for LLM mode, `ANTHROPIC_API_KEY`):**
   - `pnpm --filter agent-demo demo:all -- --scripted` on localnet, then devnet; the README lists the four terminals.
   - Then LLM mode with `--record`. Promote recordings where the model's own run tells the story; keep the injection script if the model resists, as it says on screen.
2. **Step 5, pitch polish with WS9:** timing, wording, colours; maybe the terminal QR code for pairing.

## Open items

- **Decisions for Parth:**
  - `effort: medium` for the demo agent. `low` would feel snappier on stage.
  - `all` = normal → approval → injection. `runaway` is run on its own.
  - `--record` writes `scenes/<scene>.recorded.json`. A recording is promoted to `scenes/<scene>.json` by hand.
  - On devnet, a payment takes about 2 s, so the runaway scene may never reach 30 per minute. Its replay then stops honestly at the first payment that the script expected to be blocked.
- Pairing links point at `http://localhost:3000`. A `LEASH_WEB_URL` variable would need an ADR once the web app is deployed. The terminal QR code (§11) is not done yet.
- The approval scene needs the owner's decision on-chain: `pnpm owner:approve` until WS6/WS5 ship theirs.

- Tool definitions are not `strict` (the `headers` map is outside strict schemas); inputs are validated by zod instead.
- The helper names in the brief changed slightly: `createLeashTools` takes `leashFetch` (the port) rather than `fetchImpl`, because the x402 client is the dependency, not a raw `fetch`.

## Questions for other workstreams

- WS2 and WS3: please implement the ports in `packages/tools/src/ports.ts` as described in the messages of 2026-09-30.

## Contract changes proposed

- [20260930-ws7-approval-request-errors](../../adr/20260930-ws7-approval-request-errors.md) (additive, status Proposed).
