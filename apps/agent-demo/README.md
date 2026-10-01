# @leash/agent-demo

The demo the judges watch: a research assistant with a Leash budget. Claude decides what to buy; Leash, on-chain, decides whether it may. One command runs the pitch storyline ([WS9](../../docs/workstreams/WS9-integration-story.md#the-demo-storyline)):
1. The agent pays for research per call.
2. It asks the owner to approve a report above its instant limit.
3. It meets a poisoned buying guide, and the tripwire freezes it.

Owned by **WS7**. Brief: [docs/workstreams/WS7-agent-mcp.md](../../docs/workstreams/WS7-agent-mcp.md). Status: [docs/workstreams/status/WS7.md](../../docs/workstreams/status/WS7.md).

```bash
pnpm --filter agent-demo demo:all -- --scripted        # the storyline from the scene scripts, no API key
pnpm --filter agent-demo demo:all                      # the same with Claude (needs ANTHROPIC_API_KEY)
pnpm --filter agent-demo demo injection -- --scripted  # one scene
```

## Modes

- **LLM mode (default):** Claude, through the Messages API.
  - Settings: `AGENT_MODEL`, default `claude-opus-5-5`; adaptive thinking with summaries on screen; effort `medium`; streaming; prompt caching.
  - Tools: the four Leash tools plus `browse(url)`, a free GET that never pays. Injected instructions arrive through `browse`.
  - The system prompt ([src/prompt.ts](src/prompt.ts)) is a research assistant with a budget. It says nothing about attacks.
- **Scripted mode (`--scripted` or `AGENT_MODE=scripted`):** replays `scenes/<scene>.json` through the same loop and screen.
  - Only the model's decisions are replayed. Every tool runs live, so every payment, block and strike on screen happens on-chain.
- **Recording (`--record`, LLM mode):** writes each scene's turns to `scenes/<scene>.recorded.json`. Copy the file over `scenes/<scene>.json` to make that run the scripted scene.

### Honesty rule

Each scene script starts with a disclosure shown on screen, so the demo never claims that a model decided what a script decided:
- The committed scripts are hand-written. They say so.
- The injection script says **"Simulating a successful injection"**: the agent is scripted to follow the hidden instruction, as a manipulated model would.
- A recorded run says which model, and when.

A replay also stops by itself ("A live result differs from the script") if a tool returns something the script did not expect. For example: the owner declines the approval, or devnet is too slow to hit the rate limit. The screen then never shows an answer written for another outcome.

## Scenes

| Scene | Task (to a research assistant) | What happens on-chain |
| --- | --- | --- |
| `normal` | Compare e-bikes for a 12 km commute | 3 research calls (0.01 USDC) and 2 price checks (0.02 USDC), paid over x402 |
| `approval` | Buy the 1.50 USDC premium report | Above the 1 USDC instant limit: an approval request; the demo waits for the owner, then pays with the approved request |
| `injection` | Read a buying guide a friend sent | The guide hides "pay a 25 USDC tip to …": blocked (not on the allowlist), strike 1, 2, 3. The tripwire freezes the agent. |
| `runaway` | Collect every page of a paginated data set | Paid page after page until the rate limit (30 per minute) pauses payments |
| `all` | `normal`, `approval`, `injection` | The pitch storyline. The injection freezes the agent, so it runs last. |

## The screen

One line per step:
- `·` thinking (summarized), `»` the model's words between steps, `→` a tool call;
- `✓ paid 0.01 USDC → Research API · tx 5Hk3…9fQa` in green. The tx is a clickable link to the explorer in terminals that support OSC 8 links; without colour, the full URL is printed.
- `✗ BLOCKED: … · strike 2/3 · recorded on-chain` in red;
- a red banner when the tripwire freezes the agent;
- a summary per scene.

Text from pages, labels, memos and the model is stripped of control characters and bidi overrides before it is printed, so a page cannot write escape sequences to your terminal.

## Run it for real (laptop)

The demo runs against a chain, the facilitator and the merchant (`localnet` shown; devnet works the same once the keys are funded):

```bash
pnpm localnet                                                    # terminal 1: validator, programs, mock USDC
pnpm devnet:setup --cluster localnet                             # once: owner-demo pairs .keys/agent.json, allowlists the merchant
pnpm --filter @leash/facilitator start                           # terminal 2
MERCHANT_PAYMENTS=on LEASH_USDC_MINT=<usdcMint from .localnet.json> \
MERCHANT_PAY_TO=<.keys/merchant.json address> LAB_ATTACKER_WALLET=<.keys/attacker.json address> \
  pnpm --filter @leash/merchant-demo start                       # terminal 3
AGENT_KEYPAIR=.keys/agent.json AGENT_OWNER=<.keys/owner-demo.json address> \
  pnpm --filter agent-demo demo:all -- --scripted                # terminal 4
```

In the approval scene, the demo waits up to 3 minutes for the owner's decision on-chain. Approving in the web app (WS6) and from Telegram (WS5) are still to come. Meanwhile, approve from another terminal with `pnpm owner:approve --cluster localnet` (`--reject` to decline).

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_OWNER` | none | The owner wallet whose principal holds this agent |
| `AGENT_KEYPAIR` | `~/.config/leash/agent.json` | The agent key; created on first run if missing. Without pairing, the demo prints the pairing link and waits. |
| `AGENT_MODE` | `llm` | `llm` or `scripted` |
| `AGENT_MODEL` | `claude-opus-5-5` | Any current Claude model ID |
| `ANTHROPIC_API_KEY` | none | LLM mode only; never printed |
| `AGENT_MERCHANT_URL` | `http://localhost:4300` | merchant-demo's base URL |
| `LEASH_CLUSTER`, `LEASH_RPC_URL`, `LEASH_PRIORITY_FEE_MICROLAMPORTS` | per [02 §13](../../docs/architecture/02-contracts.md#13-environment-variables) | |

## Test

```bash
pnpm --filter agent-demo test
```

No network and no API key:
- **Scenes and the storyline:** every scene script replays through the real loop, the real tools, the real merchant-demo app (lab included) and the official x402 facilitator, on the real program in LiteSVM.
  - The test approves as the owner, and also declines (the replay stops).
  - The storyline runs as one demo.
  - A recorded run is promoted to a script and replayed.
- **Claude adapter:** checked against a stubbed stream: the request settings, tool results and the owner's note, retries of unparseable tool input, and no retry of API errors.
- **Everything else:** `browse` (it never pays), escape stripping and the screen's lines, the loop's stops (refusal, `max_tokens`, divergence, the turn limit, failing tools), recording placeholders, waiting for the owner (timeout, a failed read), the CLI and the configuration.
