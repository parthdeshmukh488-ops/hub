# Judge Q&A

Hard questions and short, honest answers. Each answer names where its claim comes from, so it stays true. Rule: if the status files don't say a thing is done, the answer says "in progress". About other products, say what Leash does, never what they lack.

## The idea

**Why not just use Solana's Allowances program?**
It decides how much a delegate may spend, per period or in total. It doesn't decide who gets paid, how fast, or what happens when the agent is attacked. Leash adds those on top: the allowlist, per-payment, per-payee and rate limits, approvals and the tripwire. The allowance stays the hard ceiling, and Leash can only make it smaller. *([ADR-0001](../adr/0001-build-on-subscriptions-program.md))*

**Why does this need a blockchain? A server could check payments.**
If a server checks payments, either it holds the key, and you trust us with your money, or the agent holds the key, and a fooled agent can skip the server. With Leash the agent's key alone can't move money: only the Leash program can sign the transfer, after its checks. A freeze applies to everyone from the next slot. *([overview §6](../architecture/00-overview.md#6-keys-roles-and-trust-boundaries))*

**Isn't this a solved problem? Squads and Swig have spending limits.**
They are smart-account wallets with spending limits, and good ones. Leash takes a different route for agents:
- the money stays in the owner's own wallet, under Solana's official Allowances program;
- blocked attempts are recorded on-chain as strikes, and repeated attempts freeze the agent by themselves;
- larger payments wait for approval;
- payments stay standard x402.

**Ramp already does agent wallets.**
Ramp is testing x402 agent wallets on Solana in a limited alpha, for its business customers. The 70,000+ figure is Ramp's whole customer base, not its agent-wallet users. Leash is for developers and small teams who build their own agents, and it is open source and non-custodial. *([founding research](../context/transcript.md#turn-6))*

## The prototype

**Is the attack in the demo real?**
The payments, the blocks, the strikes and the freeze are real on-chain transactions. The agent's decisions in the attack scene are scripted to follow the hidden instruction, and the screen says "Simulating a successful injection". We script it because whether a model falls for a given page varies from run to run. Leash's point is that it doesn't matter. The demo agent can also run with a live Claude model; those recordings are in progress. *([apps/agent-demo/README.md](../../apps/agent-demo/README.md))*

**What runs on devnet today?**
The Leash program is deployed on devnet, byte for byte the binary our tests run. The full demo has run end to end on a local Solana validator with the same binaries. The devnet run is in progress: it was waiting for funded demo keys. *([WS1 status](../workstreams/status/WS1.md))*

**How do you know the program does what the spec says?**
- 60 shared policy test cases give the same result in TypeScript, in Rust, and in LiteSVM on the exact program binary deployed on devnet.
- Further tests cover the invariants, random payment sequences that never exceed the allowance, and every account in `pay` swapped for a plausible wrong one.
- 767 automated tests run on every commit.

*([WS1 status](../workstreams/status/WS1.md), [security §3](../architecture/03-security.md#3-invariant-tests))*

**Does it work with any x402 merchant?**
Merchants keep their x402 setup. The facilitator they use turns on two settings in the official `@x402/svm` package: smart-wallet verification, and Leash on its program allowlist. Our tests run the unmodified official facilitator. *([packages/x402/README.md](../../packages/x402/README.md#for-facilitator-operators-accept-leash-payments))*

**What does a payment cost?**
`pay` uses about 32k compute units: an ordinary Solana transaction fee, which the x402 facilitator pays. Recording a blocked attempt costs the agent's key a normal fee. *([CU.md](../../programs/leash/CU.md))*

**What if the owner isn't around to approve?**
The request expires (after an hour, in the demo's preset) and the payment doesn't happen. Today the owner approves with `pnpm owner:approve`. Approving in the web app, from Telegram and from Solana Action links is in progress.

## Security

**What if the agent's key is stolen?**
The key holds no funds. It can only pay allowlisted payees within the limits, and those are legitimate businesses, not the thief. The owner freezes the agent or revokes the allowance. *([threat T3](../architecture/03-security.md#2-threats-and-mitigations))*

**What if the fooled agent buys things it is allowed to buy but doesn't need?**
That can happen, within its limits: the per-payment, per-payee and rate limits bound it, and larger payments need approval. Leash stops payments to the wrong party; it doesn't judge whether an allowed purchase was wise. *(T1, T2)*

**Can someone freeze my agent on purpose?**
Yes: whoever can make the agent attempt forbidden payments can trip the wire. That is deliberate: a frozen agent is better than a drained one. The owner sees it and unfreezes. *(T12)*

**Can a merchant overcharge, or swap its `payTo` for an attacker's address?**
Overcharging hits the per-payment and per-payee caps, and anything above the instant limit needs approval. A swapped `payTo` fails because Leash checks the owner of the destination token account against the allowlist, not the merchant's URL. *(T4, T5)*

**Who can change the program?**
On devnet, one deployer key, kept offline. Even a malicious upgrade couldn't move more than the allowance, which the Foundation's program enforces. Within the allowance, though, it could pay anyone. So before mainnet the upgrade authority moves to a timelocked multisig, or is revoked. *(T15)*

**What if Leash has a bug?**
The allowance is the ceiling, enforced by the Foundation's audited program, independently of Leash's code. The owner can revoke the delegation at any time as a hard stop. *(invariant I1)*

**Could the agent learn to get around the rules?**
Every attempt is checked on-chain, and every forbidden one is a strike. Leash's tool messages tell the model to stop, never how to get around the policy. *(T1)*

**Can someone replay a payment?**
No. Blockhashes expire, the facilitator caches settlements, the x402 memo carries a nonce, and the SDK is idempotent per payment reference. *(T9)*

## Market and business

**Who are your first users? Have you talked to any?**
Developers and small teams whose agents pay for APIs and services over x402. We haven't talked to users yet; five conversations with agent builders are the next step (Superteam Germany, x402 builders, MCP users). Our channel is the MCP server: one config line gives Claude Code, Claude Desktop or Cursor a wallet on a leash.

**How do you make money?**
Open core:
- **Free and open source:** the program, the SDK and the MCP server. A security product must be verifiable.
- **Paid:** a hosted control panel with alerts and a guardian, per agent per month.
- **Later:** a fee per payment through a hosted facilitator, which needs no program change.

**What's next?**
- **This week:** the devnet demo, pairing and approvals in the web app, and Telegram alerts.
- **By Nov 2, at Colosseum:** Solana Action links, a guardian that freezes by itself, recorded runs with a live model, and the first user conversations.
- **Then:** an audit, the upgrade authority moved to a multisig or revoked, and mainnet.

## The team

**How did you build this much in a week?**
With parallel Claude Code sessions, each owning one part of the architecture, working from written contracts and decision records. Every claim in the README and the deck is checked against the status files those sessions keep, and against the tests. *([docs/workstreams/](../workstreams/README.md))*

**[Team questions: Parth to add]**
