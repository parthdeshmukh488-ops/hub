# Demo script

The live demo for the pitch, second by second, with a fallback for every failure. The [video storyboard](video-storyboard.md) follows the same beats, and so does [slide 6](deck.md#6-the-demo-in-four-frames).

**Where things stand (Oct 3).**
- The whole scripted story has run end to end on a local Solana validator, and runs on every commit as one test through the whole system.
- **`pnpm demo`** plays the same story on the demo agent's screen in about 5 seconds, on a local test chain (LiteSVM) with the real program, no network, keys or validator. It says so on its first line, and that the owner's approval is simulated.
- The devnet run waits for funded demo keys (laptop queue item 1).
- **Sentinel** sends the alerts, with Telegram tested against a fake Bot API. The check on a real phone is on the laptop.
- **The web app** pairs, approves, rejects, freezes and unfreezes with the owner's wallet (PR #5): tested in the browser on the real program in LiteSVM; the run with a real wallet on devnet is on the laptop.
- **Solana Actions (Blinks)** approve, reject and freeze from a link, signed in the owner's wallet.

Every owner action below has three paths. The script uses the first; the others are fallbacks.
1. **The web app:** Approve in the Approvals inbox, and the agent page's freeze toggle, signed in the owner's wallet.
2. **A Blink** signed in the owner's wallet (needs the tunnel and the wallet below).
3. **A terminal command** (always works).

**Timings are targets**, to be measured at the rehearsal on Oct 3 (laptop queue item 6).
- An x402 payment takes about 0.5 s on a local validator.
- WS7 estimates about 2 s on devnet.

## What is on screen

| Where | What | How |
| --- | --- | --- |
| **Left half** | The demo agent's terminal | `pnpm --filter agent-demo demo:all -- --scripted` (terminal 4 of [the run instructions](../../apps/agent-demo/README.md#run-it-for-real-laptop)) |
| **Right half** | The control panel, live | `NEXT_PUBLIC_DATA_SOURCE=indexer pnpm --filter @leash/web dev`, then http://localhost:3000/app |
| **Phone** | Alerts from @LeashmvpBot: the approval request, then the tripwire. Their buttons open the web app's pages. | Sentinel (WS5), started with the tunnel's URL |
| **The owner's wallet** | A devnet browser wallet with the `owner-demo` key, connected to the control panel: it signs Approve and the freeze toggle | The control panel's **Connect wallet** ([apps/web/README.md](../../apps/web/README.md)) |
| **Hidden: a tab for the Blink** | Fallback: "Approve 1.50 USDC to Research API", one button, one signature | `https://dial.to/?action=solana-action:<URL-encoded action URL>&cluster=devnet` ([how](../../apps/web/src/server/actions/README.md#demo-on-a-phone-laptop)) |
| **Hidden: the owner's terminal** | The fallbacks for the owner's side | `pnpm owner:approve --cluster devnet`, `pnpm owner:unfreeze --cluster devnet` |
| **Hidden: the services** | The chain, the facilitator, the merchant with payments on, the indexer | [apps/agent-demo/README.md](../../apps/agent-demo/README.md#run-it-for-real-laptop) and [services/indexer/README.md](../../services/indexer/README.md) |

## Before the pitch (30 minutes ahead)

1. **Keys:** `pnpm devnet:check` shows SOL on every demo key and USDC on owner-demo.
2. **Services, in this order:**
   1. the facilitator;
   2. the merchant with payments on, which waits for the facilitator by itself;
   3. the indexer: `LEASH_CLUSTER=devnet INDEXER_POLL_INTERVAL_MS=2000 pnpm --filter @leash/indexer start`;
   4. **the tunnel:** `cloudflared tunnel --url http://localhost:3000`, which prints `https://<random>.trycloudflare.com`. Telegram makes buttons only of public https links, and Blink clients need a public URL;
   5. the web app in live mode, with `NEXT_PUBLIC_APP_URL=https://<random>.trycloudflare.com NEXT_PUBLIC_LEASH_CLUSTER=devnet`;
   6. **Sentinel:** `SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json SENTINEL_WEB_URL=https://<random>.trycloudflare.com LEASH_CLUSTER=devnet pnpm --filter @leash/sentinel start`. Leave autofreeze off: in the story the agent's own tripwire freezes it. `curl localhost:4400/health` must say `"ok":true`.
3. **A clean agent:** the agent page's freeze toggle (unfreeze), or `pnpm owner:unfreeze --cluster devnet`. Either unfreezes the agent and clears leftover strikes. Strikes last 10 minutes; with one left over, the tripwire fires on the second attempt instead of the third.
4. **Takes left today:** a take pays the Research API 1.57 USDC of its 3 USDC daily budget, so there are **two full takes a day**. Count them. A third take needs a higher payee limit or a fresh agent.
5. **The owner's wallet:** a browser wallet on devnet holding the `owner-demo` key (`.keys/owner-demo.json`), connected to the control panel; the same wallet signs the Blinks. It's a devnet-only demo key: never put a real key there. It needs a little devnet SOL for fees. No wallet: use the terminal paths.
6. **The [checklist before each take](../../apps/agent-demo/README.md#before-each-take).**
7. **The screen:**
   - terminal font at 18 pt or more;
   - the browser at 125% zoom, on the overview, with a second tab on the research agent's page;
   - notifications off.
8. **The backup:** the recorded video, open in a player, paused at 0:00.

## The script

| Time | Screen | What happens | Say | If it fails |
| --- | --- | --- | --- | --- |
| 0:00–0:10 | Browser: the agent page | The research agent's rules, in plain language: 5 USDC a day, 1 USDC per payment without asking, approvals up to 5 USDC, only the Research API, freezes after 3 blocked attempts. | "This is our research assistant. It has a budget in Solana's Allowances program, and Leash rules on top: who it may pay, how much, how fast." | The agent was paired before the pitch (in the web app from the link the agent prints, or with `pnpm devnet:setup`); show its rules as here. **Pairing live** is possible but costs time: only if asked. |
| 0:10–0:30 | Terminal, then the browser | Start the demo. The agent researches e-bikes: three research calls at 0.01 USDC and two price checks at 0.02 USDC, each a green line with an explorer link. The control panel's feed shows each payment about 2 seconds later. | "Every line is a real x402 payment on Solana, a cent or two per call. The control panel follows the chain live." | **A red line says `✗ the merchant answered 500 …`, or a research call comes back `free`:** the replay stops by itself ("A live result differs from the script"), so the screen never claims a payment that didn't happen. Say "the merchant hiccupped, so the script stops rather than pretend", and go on to the next scenes: `pnpm --filter agent-demo demo approval injection -- --scripted`. Check the merchant and facilitator logs after the pitch. **`NETWORK_ERROR`:** the RPC is slow; wait five seconds. If it repeats, switch to the video. |
| 0:30–0:50 | Terminal; the phone; the Blink tab | The agent wants the 1.50 USDC premium report. That is above its 1 USDC limit, so it asks. The phone buzzes: "Research agent asks you to approve 1.50 USDC". The request appears in the control panel's Approvals inbox. The owner clicks **Approve**; the dialog reads "Approve 1.50 USDC to Research API …", the wallet signs, and the agent pays with the approved request. | "Above its limit, the agent can't just pay: it asks me, on my phone. One approval, one signature in my wallet, and that exact payment goes through." | **The web app's Approve fails** (wallet, RPC): use the **Blink**: take its URL from the alert's Approve button (copy the link) or from `/v1/owners/<owner>/requests`, and open it through dial.to ([how](../../apps/web/src/server/actions/README.md#demo-on-a-phone-laptop)). **No wallet at all:** `pnpm owner:approve --cluster devnet` in the owner's terminal. **No phone alert:** carry on; the inbox shows the request. The demo waits up to 3 minutes. **No decision in time:** the replay stops ("A live result differs from the script"). Say so, and start the attack scene on its own: `pnpm --filter agent-demo demo injection -- --scripted`. |
| 0:50–1:20 | Terminal, then the browser | The agent reads a buying guide whose author hid "tip me 25 USDC" in an invisible paragraph. The screen shows "Simulating a successful injection". The agent tries to pay: **blocked, payee not allowed, strike 1.** Strike 2. Strike 3: the red tripwire banner. The feed shows three blocked attempts to the attacker's wallet, then "Froze itself: tripwire". The phone buzzes: "Research agent was frozen by its tripwire". | "This guide hides an instruction to tip a stranger. We script the agent to fall for it, and the screen says so. It tries three times. Three blocks, three strikes, and the agent freezes itself, on-chain." | **The tripwire fires at strike 2:** a strike was left over from a rehearsal. Say "it froze one attempt earlier: a strike from our rehearsal was still in the window", then unfreeze after the pitch. **"This payee's budget is used up":** it's the third take today. Switch to the video. |
| 1:20–1:35 | Browser: the agent page | Frozen: "Froze itself after 3 blocked attempts". Each attempt shows the attacker's address. The allowance is untouched by the attack. The freeze toggle is on; the owner points at it and leaves it on. | "The feed shows exactly what happened, and who tried to get paid. This toggle is the off switch: one transaction. Only the owner can turn it back off." | **The toggle doesn't respond:** say it; unfreeze after the pitch with `pnpm owner:unfreeze --cluster devnet`. (Blinks freeze, they never unfreeze: only the owner unfreezes, by design.) |
| 1:35–1:45 | Slide 13 | The punchline. | "The model was fooled. The money wasn't moved. Solana's Allowances capped how much; Leash decided who, how fast, and when to stop." | – |

## After each take

- Unfreeze with the agent page's toggle (fallback: `pnpm owner:unfreeze --cluster devnet`), even if you take again soon: it also clears the strikes.
- Note the take in the count (two a day).

## If the demo can't run

1. **The recorded video** ([storyboard](video-storyboard.md)): the same beats.
2. **`pnpm demo`:** the same story on the demo agent's screen, in about 5 seconds, with no network. Its first line says what it is: a local test chain (LiteSVM) running the real Leash program, not devnet, with the owner's approval simulated. Read that line out.
3. **The control panel with sample data** (`pnpm --filter @leash/web dev`, no chain): it shows the end state; narrate the beats over the overview, the agent page and the activity log.
4. **For technical judges:** `pnpm --filter @leash/e2e test` runs the whole story through the whole system (agent, x402 merchant, official facilitator, the real program binaries, indexer, Sentinel) in process on LiteSVM, with no network, in about 5 seconds. Its output is test results, not the demo screen.

## Extra, for questions

- **A runaway loop:** `pnpm --filter agent-demo demo runaway -- --scripted` pays page after page until the rate limit (30 a minute) pauses it. It needs 30 payments inside a minute, which is easy on a local validator. On devnet it depends on the RPC; if the limit isn't reached, the replay stops honestly.
- **Pull the brake:** the overview's global freeze switch stops every agent in one transaction. **From a link:** open the Blink for `freeze-all?owner=<owner>` (or `freeze?agent=<agent>`) through dial.to and sign: every agent stops on-chain at once. The owner or the guardian may sign it; anyone else's signature is refused by the program. Resume afterwards from the overview's switch, or with `pnpm owner:unfreeze --cluster devnet`.
- **The MCP server:** Claude Code with the Leash tools ([packages/mcp/README.md](../../packages/mcp/README.md)): ask it to pay the attacker and watch it get blocked.
