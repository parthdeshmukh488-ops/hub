# Demo script

The live demo for the pitch, second by second, with a fallback for every failure. The [video storyboard](video-storyboard.md) follows the same beats, and so does [slide 6](deck.md#6-the-demo-in-four-frames).

**Where things stand (Oct 1).**
- The whole scripted story has run end to end on a local Solana validator.
- The devnet run waits for funded demo keys (laptop queue item 1).
- Pairing, approving, freezing and unfreezing in the web app are being built (WS6), and so are Telegram alerts (WS5).

Every owner action below has two paths: the web app (or Telegram) once it ships, and a terminal command that works today. The script works either way.

**Timings are targets**, to be measured at the rehearsal on Oct 3 (laptop queue item 6).
- An x402 payment takes about 0.5 s on a local validator.
- WS7 estimates about 2 s on devnet.

## What is on screen

| Where | What | How |
| --- | --- | --- |
| **Left half** | The demo agent's terminal | `pnpm --filter agent-demo demo:all -- --scripted` (terminal 4 of [the run instructions](../../apps/agent-demo/README.md#run-it-for-real-laptop)) |
| **Right half** | The control panel, live | `NEXT_PUBLIC_DATA_SOURCE=indexer pnpm --filter @leash/web dev`, then http://localhost:3000/app |
| **Phone** (once Telegram ships) | Alerts from @LeashmvpBot | Sentinel (WS5) |
| **Hidden: the owner's terminal** | The fallbacks for the owner's side | `pnpm owner:approve --cluster devnet`, `pnpm owner:unfreeze --cluster devnet` |
| **Hidden: the services** | The chain, the facilitator, the merchant with payments on, the indexer | [apps/agent-demo/README.md](../../apps/agent-demo/README.md#run-it-for-real-laptop) and [services/indexer/README.md](../../services/indexer/README.md) |

## Before the pitch (30 minutes ahead)

1. **Keys:** `pnpm devnet:check` shows SOL on every demo key and USDC on owner-demo.
2. **Services, in this order:**
   1. the facilitator;
   2. the merchant with payments on, which waits for the facilitator by itself;
   3. the indexer: `LEASH_CLUSTER=devnet INDEXER_POLL_INTERVAL_MS=2000 pnpm --filter @leash/indexer start`;
   4. the web app in live mode.
3. **A clean agent:** `pnpm owner:unfreeze --cluster devnet`. It unfreezes the agent and clears leftover strikes. Strikes last 10 minutes; with one left over, the tripwire fires on the second attempt instead of the third.
4. **Takes left today:** a take pays the Research API 1.57 USDC of its 3 USDC daily budget, so there are **two full takes a day**. Count them. A third take needs a higher payee limit or a fresh agent.
5. **The [checklist before each take](../../apps/agent-demo/README.md#before-each-take).**
6. **The screen:**
   - terminal font at 18 pt or more;
   - the browser at 125% zoom, on the overview, with a second tab on the Research Assistant's agent page;
   - notifications off.
7. **The backup:** the recorded video, open in a player, paused at 0:00.

## The script

| Time | Screen | What happens | Say | If it fails |
| --- | --- | --- | --- | --- |
| 0:00–0:10 | Browser: the agent page | The Research Assistant's rules, in plain language: 5 USDC a day, 1 USDC per payment without asking, approvals up to 5 USDC, only the Research API, freezes after 3 blocked attempts. | "This is our research assistant. It has a budget in Solana's Allowances program, and Leash rules on top: who it may pay, how much, how fast." | **Pairing in the web app has shipped:** pair live from the link the agent prints, with the research-assistant preset. **Otherwise:** the agent was paired before the pitch with `pnpm devnet:setup`; show its rules as here. |
| 0:10–0:30 | Terminal, then the browser | Start the demo. The agent researches e-bikes: three research calls at 0.01 USDC and two price checks at 0.02 USDC, each a green line with an explorer link. The control panel's feed shows each payment about 2 seconds later. | "Every line is a real x402 payment on Solana, a cent or two per call. The control panel follows the chain live." | **A line says `✓ 500 … free`:** a fetch came back unpaid, and the replay carries on regardless (a known WS7 issue). The scene's closing line then overstates the spend; don't read it out. Check the merchant and facilitator logs after the pitch. **`NETWORK_ERROR`:** the RPC is slow; wait five seconds. If it repeats, switch to the video. |
| 0:30–0:50 | Terminal; browser: Approvals | The agent wants the 1.50 USDC premium report. That is above its 1 USDC limit, so it asks. The request appears in the Approvals inbox. The owner approves; the agent pays with the approved request. | "Above its limit, the agent can't just pay: it asks me. One approval, and that exact payment goes through." | **Approving in the web app or Telegram has shipped:** approve there. **Otherwise:** `pnpm owner:approve --cluster devnet` in the owner's terminal. The demo waits up to 3 minutes. **No decision in time:** the replay stops ("A live result differs from the script"). Say so, and start the attack scene on its own: `pnpm --filter agent-demo demo injection -- --scripted`. |
| 0:50–1:20 | Terminal, then the browser | The agent reads a buying guide whose author hid "tip me 25 USDC" in an invisible paragraph. The screen shows "Simulating a successful injection". The agent tries to pay: **blocked, payee not allowed, strike 1.** Strike 2. Strike 3: the red tripwire banner. The feed shows three blocked attempts to the attacker's wallet, then "Froze itself: tripwire". | "This guide hides an instruction to tip a stranger. We script the agent to fall for it, and the screen says so. It tries three times. Three blocks, three strikes, and the agent freezes itself, on-chain." | **The tripwire fires at strike 2:** a strike was left over from a rehearsal. Say "it froze one attempt earlier: a strike from our rehearsal was still in the window", then unfreeze after the pitch. **"This payee's budget is used up":** it's the third take today. Switch to the video. |
| 1:20–1:35 | Browser: the agent page | Frozen: "Froze itself after 3 blocked attempts". Each attempt shows the attacker's address. The allowance is untouched by the attack. | "The feed shows exactly what happened, and who tried to get paid. Only the owner can unfreeze it." | **Unfreezing in the web app has shipped:** show the switch, and leave the agent frozen. **Otherwise:** say it; unfreeze after the pitch with `pnpm owner:unfreeze --cluster devnet`. |
| 1:35–1:45 | Slide 13 | The punchline. | "The model was fooled. The money wasn't moved. Solana's Allowances capped how much; Leash decided who, how fast, and when to stop." | – |

## After each take

- `pnpm owner:unfreeze --cluster devnet`, even if you take again soon: it also clears the strikes.
- Note the take in the count (two a day).

## If the demo can't run

1. **The recorded video** ([storyboard](video-storyboard.md)): the same beats.
2. **The control panel with sample data** (`pnpm --filter @leash/web dev`, no chain): it shows the end state; narrate the beats over the overview, the agent page and the activity log.
3. **For technical judges:** `pnpm --filter agent-demo test` runs the whole story in process on the real program binaries in LiteSVM, with no network. Its output is test results, not the demo screen.

## Extra, for questions

- **A runaway loop:** `pnpm --filter agent-demo demo runaway -- --scripted` pays page after page until the rate limit (30 a minute) pauses it. It needs 30 payments inside a minute, which is easy on a local validator. On devnet it depends on the RPC; if the limit isn't reached, the replay stops honestly.
- **The MCP server:** Claude Code with the Leash tools ([packages/mcp/README.md](../../packages/mcp/README.md)): ask it to pay the attacker and watch it get blocked.
