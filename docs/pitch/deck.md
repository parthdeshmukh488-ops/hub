# Leash: the pitch, slide by slide (v1)

The content of the submission deck, one section per slide: **[leash-deck.pptx](leash-deck.pptx)** and its PDF export **[leash-deck.pdf](leash-deck.pdf)**. [`build-deck.cjs`](build-deck.cjs) builds both from the words below, so change the words here first. Once the deck lives in Google Slides and is edited there, the PDF in this folder is re-exported from Google Slides.

- **Audience:** the judges of the Superteam Germany Solana Challenge at the WHU Prompting Progress hackathon. They read the deck on their own, so every slide must make sense without a speaker. The "Say" lines are the speaker notes, for the live pitch and the video.
- **Judging criteria** ([hackathon brief](../hackathon-brief.md)): useful idea · working prototype · clear role for Solana · potential to grow. Each slide names the one it serves.
- **Rules:** every number has a source ([below](#facts-and-sources)). Only what the status files show as done is called done; the rest says "in progress". The scripted attack is "simulating a successful injection", as the demo screen says.
- **Design:** light and plain, like the web app, in Arial. The app's colours keep their meaning: green paid, amber waiting for approval, red blocked, blue frozen, purple for Leash itself. Status chips in those colours are the repeated motif. Screenshots come from [img/](img/).
- **Placeholders for Parth:** the team (slides 1 and 13) and the user conversations (slide 10), in amber.
- **Length:** 13 slides, about 3 minutes spoken.
- **Last checked:** October 1, 2026.

## 1. Title

**On the slide**
- **Leash**
- Spending limits and an off switch for AI agents, enforced on Solana.
- Superteam Germany Solana Challenge · WHU Prompting Progress · October 2026
- **[Team: names and roles, to be filled in by Parth]**

**Visual:** the Leash mark (the web app's purple "L"), and the control panel after the attack ([overview](img/web-overview.png)), captioned "The control panel after an attack (sample data)".

**Say:** "AI agents can pay for things now. Leash makes sure an agent pays only who you allow, only as much as you allow, and stops by itself when someone tries to trick it."

## 2. An agent's wallet is all or nothing

*Serves: useful idea.*

**On the slide**
- Three cards in a row: **A post on X, in Morse code** (May 4, 2026) → **Grok, wired to a trading bot, follows it** (it does what the text says) → **About $150–200k sent** (nothing asked if the payment made sense).
- **An agent does what the text in front of it says.** A crafted message can make it pay the attacker.
- Today a developer hands the agent a private key or a custodial wallet: the agent, and anyone who can fool it, can move the whole balance.
- Source: OECD.AI incident report, May 4, 2026.

**Say:** "No model is immune to a crafted message. On May 4, a post in Morse code got Grok to send up to two hundred thousand dollars. Nothing between the agent and the money asked whether that payment made sense."

## 3. Agents already pay, on Solana

*Serves: useful idea.*

**On the slide**
- **23.2M** x402 agent payments on Solana in the four weeks to Sept 22, 2026.
- **76%** of all x402 agent payments.
- **June 2026:** the Solana Foundation shipped an audited Allowances program.
  - "How much may it spend?" → **Allowances** (green).
  - "Who may it pay?" → **Not decided** (red).
  - **Leash fills that gap.**
- Sources: Solana Compass; the Solana Foundation's Subscriptions & Allowances program.

**Say:** "Agent payments are already here: Solana carried twenty-three million of them in four weeks. In June the Solana Foundation shipped an audited Allowances program. It caps how much a delegate can spend, but not who it pays. That gap is where Leash sits."

## 4. A firewall between agent and money

*Serves: useful idea.*

**On the slide**
- Five tiles:
  - **Allowlist:** pays only payees you approved.
  - **Limits:** per payment, per payee, and a rate limit.
  - **Approval:** anything above your threshold waits for your yes.
  - **Tripwire:** three attempts to break the rules, and it freezes itself.
  - **Off switch:** one transaction freezes one agent, or all of them.
- **Your money never leaves your wallet. Leash can only make the allowance smaller.**
- *Solana's Allowances decide how much an agent may spend. Leash decides who it may pay, how fast, and what happens when it's attacked.*

**Say:** "Your money stays in your wallet. The agent can only spend through Leash, and Leash checks every payment on-chain. The most it can ever spend is the allowance in Solana's own audited program, and Leash can only make that smaller."

## 5. How it works

*Serves: clear role for Solana.*

**On the slide**
- A row of five boxes: **AI agent** (Leash SDK or MCP) → **Paid API** (x402 payment) → **x402 facilitator** (official package, pays the fee) → **Leash program** (allowlist · limits · freeze; highlighted) → **Allowances program** (Solana Foundation, audited).
- Green box, **every check passes:** the Allowances program moves USDC from the owner's wallet to the payee.
- Red box, **a check fails:** nothing moves, the attempt is recorded on-chain as a strike, and three strikes freeze the agent.
- The agent's key can't move money by itself: the allowance belongs to the agent's Leash account, which only the program signs for, after every check.
- Standard x402: any facilitator running the official package accepts Leash payments after two settings changes.

**Say:** "The agent's key can't move money by itself. The owner's allowance belongs to the agent's Leash account, and the program signs the transfer only after every check passes. Payments are ordinary x402 payments: merchants keep their setup, and their facilitator turns on two settings."

## 6. The demo, in four frames

*Serves: working prototype.*

**On the slide**
- **Paid** (green): the agent pays the Research API 0.01–0.02 USDC per call.
- **Approval** (amber): a 1.50 USDC report is above its 1 USDC limit, so it asks. The owner approves.
- **Blocked ×3** (red): a page hides "tip 25 USDC" to an unknown wallet. Blocked: strike 1, 2, 3.
- **Frozen** (blue): the tripwire freezes the agent. The owner sees every attempt, with the attacker's address.
- **The model was fooled. The money wasn't moved.**
- Small print: *Scripted scene: simulating a successful injection. Every payment, block and strike is real and on-chain. Screenshot: the control panel replaying the demo story (sample data).*

**Visual:** the activity log ([activity](img/web-activity.png)): the request, the tripwire freeze, the three blocked attempts. In the live pitch: the video, once the devnet recording exists (in progress).

**Say:** "The agent reads a buying guide with a hidden instruction: tip twenty-five dollars to a stranger. In this run we script the agent to fall for it, and the screen says so, because we want to show what happens when the model is fooled. It tries three times: three blocks, three strikes, and the agent freezes itself, on-chain. The model was fooled. The money wasn't moved."

**If something fails live** (also in the speaker notes): the owner approves and unfreezes in the web app; if that fails, approve from the Blink in the owner's wallet or with `pnpm owner:approve`, and unfreeze with `pnpm owner:unfreeze`, which also clears leftover strikes. Before every take, run the [checklist](../../apps/agent-demo/README.md#before-each-take).

## 7. Why Solana

*Serves: clear role for Solana.*

**On the slide**
- **Pay per call:** a 0.01 USDC API call needs sub-cent fees and fast settlement. 76% of x402 agent payments already run on Solana.
- **Rules where the money is:** no prompt can change on-chain rules, and a freeze applies to everyone from the next slot.
- **Built from Solana's parts:** the Foundation's audited Allowances program is the hard ceiling, x402 carries the payment, and Leash adds the rules in between.
- **Off-chain, a firewall can be bypassed by whoever holds the key. On Solana, the agent's key alone can't move the money.**

**Say:** "Without Solana this product doesn't work. A firewall that runs off-chain can be bypassed by whoever holds the key, and paying per API call needs fees far below a cent."

## 8. Fail-closed and non-custodial

*Serves: working prototype.*

**On the slide**
- "Your money never leaves your wallet. The most any agent can ever spend is the allowance you set in Solana's own audited program. Leash can only make that smaller."
- **What can still go wrong:**
  - a fooled agent can still buy allowed things it didn't need, within its limits;
  - a stolen agent key can only pay allowlisted payees, within the limits;
  - an attacker can trip the wire on purpose: the agent freezes, the safe way to fail;
  - on devnet one key can upgrade the program; in production, a timelocked multisig or no key.
- **Tested on every commit:** six invariants, account-substitution attacks, and random payment sequences that never exceed the allowance.

**Visual:** the agent page ([img/web-agent-frozen.png](img/web-agent-frozen.png)): "The agent can never spend more than this, even if Leash had a bug", and the tripwire at 3 of 3.

**Say:** "A security product has to say what can still go wrong, so here is our list. Note the last line: today one key can upgrade the program on devnet. Before mainnet, that becomes a timelocked multisig, or no key at all."

## 9. Working today

*Serves: working prototype.*

**On the slide**

| Done | In progress |
| --- | --- |
| The Leash program, live on devnet | The demo video, recorded on devnet |
| 60 policy cases agree in TypeScript, in Rust and on the deployed binary | |
| x402 payments through the unmodified official facilitator, on devnet too | |
| Claude Code connects to the Leash MCP server | |
| The whole story: on devnet, in CI, and in one command (`pnpm demo`) | |
| A control panel that updates live from the indexer's stream | |
| Pairing, approve, freeze and unfreeze in the web app | |
| Sentinel's alerts on a real phone, and the guardian's autofreeze | |
| Solana Actions (Blinks): approve or freeze from a link | |
| A security CI job runs the invariant tests by name | |

- **985** automated tests, run on every commit: 857 TypeScript · 128 Rust.

**Say:** "Everything on the left runs today, and you can check it: the repo is public, and the tests run without a chain. The right column is what we're finishing this week."

## 10. First users

*Serves: potential to grow.*

**On the slide**
- **Who:** developers and small teams whose agents pay for APIs and services over x402: the teams big platforms ignore.
- **How we reach them:** the MCP server, where one config line gives Claude Code, Claude Desktop or Cursor a wallet on a leash. And x402 facilitators: two settings changes.
- **What we know so far:** no conversations with users yet. Next: five conversations with developers whose agents pay for APIs (Superteam Germany, x402 builders, MCP users).
  > **[Parth: replace with who you talked to and what they said]**
- **Others in the space:**
  - **Swig, Squads:** smart-account wallets with spending limits.
  - **Crossmint, Openfort:** agent wallets.
  - **Ramp:** testing x402 agent wallets on Solana, in a limited alpha.
  - **Leash:** the on-chain firewall on top of Solana's own Allowances program: who may be paid, how fast, and a tripwire, without holding anyone's money.

**Say:** "Our first users are developers like us, whose agents already pay for APIs. They live in Claude Code and Cursor, and the MCP server puts Leash one config line away. We haven't talked to users yet. Five conversations with agent builders are our next step."

## 11. Business model: open core

*Serves: potential to grow.*

**On the slide**
- **Free and open source:** the Leash program, the SDK and the MCP server. *A security product must be verifiable.*
- **Paid:** a hosted control panel with alerts and a guardian, per agent per month. *What runs around the clock.*
- **Later:** a fee per payment through a hosted facilitator. *Needs no program change.*
- **Adoption comes from the free parts. Teams pay for what runs around the clock.**

**Say:** "The parts that hold the rules are free and open, because a security product must be verifiable. Teams pay for the parts that run around the clock: the panel, the alerts, and a guardian that can freeze an agent at 3 a.m."

## 12. Roadmap

*Serves: potential to grow.*

**On the slide** (a timeline of three stages)
- **This week** (for the Oct 4 submission · in progress): the demo video, recorded on devnet; the web app with a real wallet on devnet.
- **By Nov 2** (the Colosseum hackathon): Telegram buttons that open the owner's wallet directly; recorded runs with a live Claude model; five user conversations.
- **Then** (on the way to mainnet): an independent audit; the upgrade authority moved to a timelocked multisig, or revoked; mainnet.

**Say:** "We keep building through Colosseum. The order is: the owner's side on devnet, then put the wallet one tap from every alert, and only then go to mainnet, after an audit."

## 13. Team and close

**On the slide**
- **The model was fooled. The money wasn't moved.**
- Solana's Allowances cap how much. Leash decides who, how fast, and when to stop.
- **[Team: names and roles, to be filled in by Parth]**
- [github.com/parthdeshmukh488-ops/hub](https://github.com/parthdeshmukh488-ops/hub) · [Leash on devnet: `HyL9S5mA…HJncu`](https://explorer.solana.com/address/HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu?cluster=devnet) · Demo video: in progress
- Small print: built with parallel Claude Code sessions, each owning one part of the architecture.

**Say:** "Agents will keep getting fooled. With Leash, that stops costing you money."

## Facts and sources

Checked on October 2, 2026. Update this table whenever a number on a slide changes.

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
| The whole scripted story ran end to end on a local validator | [Laptop run, Oct 1](../workstreams/messages/20261001-0105-from-ws1-to-all-x402-and-demo-agent-on-a-real-chain.md), [re-check](../workstreams/messages/20261001-1225-from-ws1-to-all-fixes-rechecked-on-a-real-validator.md) |
| The control panel updates live from the indexer's stream (storyline replay, and the indexer following a local validator) | [WS6 status](../workstreams/status/WS6.md), [laptop run](../workstreams/messages/20261001-0130-from-ws1-to-ws4-indexer-chain-mode-on-a-real-chain.md) |
| 985 automated tests: 857 TypeScript, 128 Rust | `pnpm test` and `cargo test` on `main`, Oct 3, 2026 (after the devnet speed and retry work) |
| Web app: 117 unit tests, 15 browser tests (8 live on LiteSVM) | PR #5 and [WS6 status](../workstreams/status/WS6.md), Oct 3, 2026 |
| Sentinel's alerts and the guardian's autofreeze; Telegram messages tested against a fake Bot API | [WS5 status](../workstreams/status/WS5.md), [services/sentinel](../../services/sentinel/README.md) |
| Solana Actions (Blinks): approve, reject, freeze, freeze all; each tested on the real program, a wrong signer refused on-chain | [WS6 Actions status](../workstreams/status/WS6-actions.md) |
| The whole story in one test: agent, x402, facilitator, program, indexer, Sentinel | [e2e/README.md](../../e2e/README.md), [WS9 status](../workstreams/status/WS9.md) |
| A security CI job runs the invariant tests by name | `.github/workflows/ci.yml` (job `security`), [WS9 status](../workstreams/status/WS9.md) |
| The indexer's account snapshot | [WS4 status](../workstreams/status/WS4.md) |
| `pay` uses about 32k compute units | [CU.md](../../programs/leash/CU.md) |
| The demo's numbers: 5 USDC a day, 1 USDC per payment without approval, approvals up to 5 USDC, 3 strikes in 10 minutes; 0.01–0.02 USDC per call, a 1.50 USDC report, a 25 USDC "tip" | The research-assistant preset in `packages/contracts/src/presets.ts`, the [storyline fixture](../../packages/contracts/fixtures/demo-storyline.json) |
| Scripted scenes say so on screen ("Simulating a successful injection") | [apps/agent-demo/README.md](../../apps/agent-demo/README.md) |
