# Leash: the pitch, slide by slide (v1)

The content of the submission deck, one section per slide. The slides are built from this file (`.pptx`, then Google Slides, plus a PDF in this folder), so change the words here first.

- **Audience:** the judges of the Superteam Germany Solana Challenge at the WHU Prompting Progress hackathon. They read the deck on their own, so every slide must make sense without a speaker. The "Say" lines are for the live pitch and the video.
- **Judging criteria** ([hackathon brief](../hackathon-brief.md)): useful idea · working prototype · clear role for Solana · potential to grow. Each slide names the one it serves.
- **Rules:** every number has a source ([below](#facts-and-sources)). Only what the status files show as done is called done; the rest says "in progress". The scripted attack is "simulating a successful injection", as the demo screen says.
- **Design:** light and plain, like the web app. One idea per slide. The app's colours keep their meaning: green paid, red blocked, amber waiting for approval, blue frozen. Screenshots are in [img/](img/).
- **Length:** 13 slides, about 3 minutes spoken.
- **Last checked:** October 1, 2026.

## 1. Title

**On the slide**
- **Leash**
- Spending limits and an off switch for AI agents, enforced on Solana.
- Superteam Germany Solana Challenge · WHU Prompting Progress · October 2026
- **[Team: names and roles, to be filled in by Parth]**

**Visual:** the Leash mark (the web app's purple "L") on white.

**Say:** "AI agents can pay for things now. Leash makes sure an agent pays only who you allow, only as much as you allow, and stops by itself when someone tries to trick it."

## 2. Problem: an agent's wallet is all or nothing

*Serves: useful idea.*

**On the slide**
- An agent does what the text in front of it says. A crafted message can make it pay the attacker.
- **May 4, 2026:** a Morse-code post on X got Grok, wired to a trading bot, to send about **$150–200k**.
- Today a developer hands the agent a private key or a custodial wallet. The agent, and anyone who can fool it, can move the whole balance.

**Visual:** three steps in a row: a post → an agent → "$150–200k sent".

**Say:** "No model is immune to a crafted message. On May 4, a post in Morse code got Grok to send up to two hundred thousand dollars. Nothing between the agent and the money asked whether that payment made sense."

## 3. Why now: agents already pay, on Solana

*Serves: useful idea.*

**On the slide**
- **23.2 million** x402 agent payments on Solana in the four weeks to Sept 22, 2026: **76%** of all of them.
- **June 2026:** the Solana Foundation shipped an audited Allowances program. "How much may this agent spend?" now has an official answer.
- Allowances cap **how much**. They don't decide **who** gets paid. Leash fills that gap.

**Visual:** "23.2M" and "76%" as big numbers. Under them: "Allowances: how much ✓ · who ✗".

**Say:** "Agent payments are already here: Solana carried twenty-three million of them in four weeks. In June the Solana Foundation shipped an audited Allowances program. It caps how much a delegate can spend, but not who it pays. That gap is where Leash sits."

## 4. Solution: a firewall between your agent and your money

*Serves: useful idea.*

**On the slide**
- **Allowlist:** pays only payees you approved.
- **Limits:** per payment, per payee, and a rate limit.
- **Approval:** anything above your threshold waits for your yes.
- **Tripwire:** after three attempts to break the rules, the agent freezes itself.
- **Off switch:** one transaction freezes one agent, or all of them.
- Footer: *Solana's Allowances decide how much an agent may spend. Leash decides who it may pay, how fast, and what happens when it's attacked.*

**Visual:** five tiles, one icon each.

**Say:** "Your money stays in your wallet. The agent can only spend through Leash, and Leash checks every payment on-chain. The most it can ever spend is the allowance in Solana's own audited program, and Leash can only make that smaller."

## 5. How it works

*Serves: clear role for Solana.*

**On the slide**
- Agent → paid API (x402) → official x402 facilitator → **Leash program** (allowlist · limits · freeze) → **Allowances program** (the ceiling) → USDC from the owner's wallet to the payee.
- Blocked: nothing moves, the attempt is recorded on-chain as a strike, and three strikes freeze the agent.
- Standard x402: any facilitator running the official package accepts Leash payments after two settings changes.

**Visual:** the diagram from the [README](../../README.md#how-it-works), left to right, with Leash highlighted.

**Say:** "The agent's key can't move money by itself. The owner's allowance belongs to the agent's Leash account, and the program signs the transfer only after every check passes. Payments are ordinary x402 payments: merchants keep their setup, and their facilitator turns on two settings."

## 6. Demo: the model was fooled, the money wasn't moved

*Serves: working prototype.*

**On the slide** (four frames)
1. **Works:** pays the Research API 0.01–0.02 USDC per call.
2. **Asks:** a 1.50 USDC report is above its 1 USDC limit, so it asks; the owner approves.
3. **Attacked:** a page hides "tip 25 USDC" to an unknown wallet. Blocked: strike 1, 2, 3, and the agent is **frozen by its own tripwire**.
4. **Owner in control:** every attempt in the feed, with the attacker's address.
- Small print: *Scripted scene: simulating a successful injection. Every payment, block and strike is real and on-chain.*

**Visual:** frames 3 and 4 from the control panel ([activity](img/web-activity.png), [overview](img/web-overview.png)). Frames 1–3 from the terminal once the devnet recording exists (in progress). In the live pitch: the video.

**Say:** "The agent reads a buying guide with a hidden instruction: tip twenty-five dollars to a stranger. In this run we script the agent to fall for it, and the screen says so, because we want to show what happens when the model is fooled. It tries three times: three blocks, three strikes, and the agent freezes itself, on-chain. The model was fooled. The money wasn't moved."

**If something fails live:** the web app or the terminal fallbacks for the owner's side (`pnpm owner:approve`, and `pnpm owner:unfreeze`, which also clears leftover strikes). Before every take, run the [checklist](../../apps/agent-demo/README.md#before-each-take).

## 7. Why Solana

*Serves: clear role for Solana.*

**On the slide**
- **Pay per call:** a 0.01 USDC API call needs sub-cent fees and fast settlement. 76% of x402 agent payments already run on Solana.
- **Rules where the money is:** no prompt can change on-chain rules, and a freeze applies to everyone from the next slot.
- **Built from Solana's parts:** the Foundation's audited Allowances program is the hard ceiling, x402 carries the payment, and Leash adds the rules in between.

**Say:** "Without Solana this product doesn't work. A firewall that runs off-chain can be bypassed by whoever holds the key, and paying per API call needs fees far below a cent."

## 8. Trust: fail-closed and non-custodial

*Serves: working prototype.*

**On the slide**
- "Your money never leaves your wallet. The most any agent can ever spend is the allowance you set in Solana's own audited program. Leash can only make that smaller."
- **What can still go wrong:**
  - a fooled agent can still buy allowed things it didn't need, within its limits;
  - a stolen agent key can only pay allowlisted payees, within the limits;
  - an attacker can trip the wire on purpose: the agent freezes, which is the safe way to fail;
  - on devnet one key can upgrade the program; in production, a timelocked multisig or no upgrade key.
- **Tested:** six invariants, account-substitution attacks, and random payment sequences that never exceed the allowance.

**Visual:** the agent page ([img/web-agent-frozen.png](img/web-agent-frozen.png)): "The agent can never spend more than this, even if Leash had a bug", and the tripwire at 3 of 3.

**Say:** "A security product has to say what can still go wrong, so here is our list. Note the last line: today one key can upgrade the program on devnet. Before mainnet, that becomes a timelocked multisig, or no key at all."

## 9. Working today

*Serves: working prototype.*

**On the slide**

| Done | In progress |
| --- | --- |
| The Leash program, live on devnet | Pairing, approve, freeze and unfreeze in the web app |
| 60 policy test cases give the same result in TypeScript, in Rust, and in LiteSVM on the exact program binary deployed on devnet (checked byte for byte) | Telegram alerts |
| x402 payments through the unmodified official facilitator | The full demo on devnet, and its recording |
| Claude Code connects to the Leash MCP server | |
| The whole demo story, end to end on a local Solana validator | |
| A control panel that updates live from the indexer's stream | |

- **767 automated tests** (639 TypeScript, 128 Rust) run on every commit.

**Say:** "Everything on the left runs today, and you can check it: the repo is public, and the tests run without a chain. The right column is what we're finishing this week."

## 10. First users

*Serves: potential to grow.*

**On the slide**
- **Who:** developers and small teams whose agents pay for APIs and services over x402: the teams big platforms ignore.
- **How we reach them:** the MCP server, where one config line gives Claude Code, Claude Desktop or Cursor a wallet on a leash; and x402 facilitators, which accept Leash payments after two settings changes.
- **What we know so far:** no conversations with users yet. Next: five conversations with developers whose agents pay for APIs (Superteam Germany, x402 builders, MCP users).
  > **[Parth: if you have talked to anyone, replace the line above with who they are and what they said.]**
- **Others in the space:** smart-account wallets with spending limits (Swig, Squads), agent wallets (Crossmint, Openfort), and Ramp, which is testing x402 agent wallets on Solana in a limited alpha. Leash is the on-chain firewall on top of Solana's own Allowances program: who may be paid, how fast, and a tripwire, without holding anyone's money.

**Say:** "Our first users are developers like us, whose agents already pay for APIs. They live in Claude Code and Cursor, and the MCP server puts Leash one config line away. We haven't talked to users yet. Five conversations with agent builders are our next step."

## 11. Business model: open core

*Serves: potential to grow.*

**On the slide**
- **Free and open source:** the Leash program, the SDK and the MCP server.
- **Paid:** a hosted control panel with alerts and a guardian, per agent per month.
- **Later:** a fee per payment through a hosted facilitator. It needs no program change.

**Say:** "The parts that hold the rules are free and open, because a security product must be verifiable. Teams pay for the parts that run around the clock: the panel, the alerts, and a guardian that can freeze an agent at 3 a.m."

## 12. Roadmap

*Serves: potential to grow.*

**On the slide**
- **This week, for the Oct 4 submission (in progress):** the demo on devnet; pairing, approvals and the off switch in the web app; Telegram alerts.
- **By Nov 2, the Colosseum hackathon:** Solana Action links to freeze or approve from anywhere; the guardian freezes an agent by itself when Sentinel sees an attack; recorded runs with a live Claude model; five user conversations.
- **Then:** an independent audit, the upgrade authority moved to a timelocked multisig or revoked, and mainnet.

**Say:** "We keep building through Colosseum. The order is: finish the owner's side, make every alert actionable from a link, and only then go to mainnet, after an audit."

## 13. Team and close

**On the slide**
- **[Team: names and roles, to be filled in by Parth]**
- **The model was fooled. The money wasn't moved.**
- Solana's Allowances cap how much. Leash decides who, how fast, and when to stop.
- Code: [github.com/parthdeshmukh488-ops/hub](https://github.com/parthdeshmukh488-ops/hub) · Leash on devnet: [`HyL9S5mA…HJncu`](https://explorer.solana.com/address/HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu?cluster=devnet) · Demo video: in progress
- Small print: built with parallel Claude Code sessions, each owning one part of the architecture.

**Say:** "Agents will keep getting fooled. With Leash, that stops costing you money."

## Facts and sources

Checked on October 1, 2026. Update this table whenever a number on a slide changes.

| Claim | Source |
| --- | --- |
| 23.2 million x402 agent payments on Solana in the four weeks to Sept 22, 2026; 76% of all | [Solana Compass](https://solanacompass.com/news/solana-processes-76-of-all-x402-ai-agent-transactions-232-million-in-four-weeks) |
| May 4, 2026: a Morse-code post on X got Grok, wired to the Bankr trading bot, to send about $150–200k | [OECD.AI](https://oecd.ai/en/incidents/2026-05-04-4a73) |
| The Solana Foundation's Subscriptions & Allowances program: shipped June 2, 2026, audited by Cantina; caps amounts, not destinations | [Founding research](../context/transcript.md#turn-6), [ADR-0001](../adr/0001-build-on-subscriptions-program.md) |
| Ramp: 70,000+ is its whole customer base; its x402 agent wallets on Solana were a limited alpha (never say "70,000 businesses use its agent wallets") | [Founding research](../context/transcript.md#turn-6) |
| Swig and Squads (spending limits), Crossmint and Openfort (agent wallets) | [Founding research](../context/transcript.md#turn-6) |
| The Leash program is live on devnet (slot 505952773) and byte for byte the committed `leash.so` | [WS1 status](../workstreams/status/WS1.md) |
| 60 policy test cases agree in TypeScript, in Rust and in LiteSVM on that binary | [WS1 status](../workstreams/status/WS1.md), [WS2 status](../workstreams/status/WS2.md) |
| x402 payments through the unmodified official facilitator (`@x402/svm` 2.27.0) | [WS3 status](../workstreams/status/WS3.md) |
| Claude Code connects to the MCP server | [WS7 status](../workstreams/status/WS7.md) |
| The whole scripted story ran end to end on a local validator | [Laptop run, Oct 1](../workstreams/messages/20261001-0105-from-ws1-to-all-x402-and-demo-agent-on-a-real-chain.md) |
| The control panel updates live from the indexer's stream (storyline replay, and the indexer following a local validator) | [WS6 status](../workstreams/status/WS6.md), [laptop run](../workstreams/messages/20261001-0130-from-ws1-to-ws4-indexer-chain-mode-on-a-real-chain.md) |
| 767 automated tests: 639 TypeScript, 128 Rust | `pnpm test` and CI's `cargo test`, Oct 1, 2026 |
| `pay` uses about 32k compute units | [CU.md](../../programs/leash/CU.md) |
| The demo's numbers: 5 USDC a day, 1 USDC per payment without approval, approvals up to 5 USDC, 3 strikes in 10 minutes; 0.01–0.02 USDC per call, a 1.50 USDC report, a 25 USDC "tip" | The research-assistant preset in `packages/contracts/src/presets.ts`, the [storyline fixture](../../packages/contracts/fixtures/demo-storyline.json) |
| Scripted scenes say so on screen ("Simulating a successful injection") | [apps/agent-demo/README.md](../../apps/agent-demo/README.md) |
