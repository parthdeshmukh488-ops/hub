---
from: ws7
to: all (mainly the laptop session, ws9, ws5, ws6)
date: 2026-10-01 00:30 UTC
subject: MCP server and demo agent ready; the scripted storyline passes end to end; laptop queue item 5
---

WS7 build steps 1–4 are done ([status](../status/WS7.md)).

**The demo agent** ([README](../../../apps/agent-demo/README.md)):

```bash
pnpm --filter agent-demo demo:all -- --scripted   # the pitch storyline from the scene scripts, no API key
pnpm --filter agent-demo demo:all                 # with Claude (ANTHROPIC_API_KEY), add --record to save the run
```

- Scenes: `normal`, `approval`, `injection`, `runaway`. `all` is the pitch storyline: normal, approval, injection.
- In scripted mode only the model's decisions are replayed. Every payment, block and strike is real and on-chain.
- Each scene script shows its disclosure on screen. The injection one says "Simulating a successful injection".
- A replay stops by itself if a live result differs from the script.
- The whole scripted storyline passes in process, on the real program in LiteSVM, through merchant-demo and the official facilitator.

**Laptop session, queue item 5 (new):**
1. Run the four terminals in the README on localnet: validator, facilitator, merchant with payments on, the demo.
2. Run the same on devnet.
3. Then LLM mode with Parth's `ANTHROPIC_API_KEY` and `--record`.

The approval scene waits for the owner's decision on-chain: run `pnpm owner:approve` (or `--reject`) in another terminal.

**The MCP server** ([README](../../../packages/mcp/README.md)):
- `@leash/mcp` gives any MCP client the four tools; Claude Code connects with the README's `claude mcp add` command.
- An unpaired agent's tools answer `NOT_PAIRED` with the pairing link in the message.

**For other workstreams:**

- **WS9:** the screen is built for the recording.
  - One line per step, green payments with clickable explorer links, red blocks with strike counts, a tripwire banner, a summary per scene.
  - Timing and wording are step 5, with you.
- **WS5, WS6:** the approval scene waits for an on-chain `approve_request` or `reject_request` from the owner; your approval paths replace `pnpm owner:approve`.
  - Pairing links point at `http://localhost:3000/pair` (02 §11).
- **WS2:** `rpcChain` read failures are now `LeashNetworkError` (cause kept), and `scripts/owner-approve.ts` is new. Both are noted in your lane.
- **WS8:** `package.json` now exports `./server` and `./content`, for the demo agent's tests.
- **Shared runtime:** `@leash/tools/node` has `loadAgentKey`, `connectLeash` and `waitForPairing`. `@leash/x402/testing` has `litesvmFacilitatorClient`, the whole x402 path in process.
