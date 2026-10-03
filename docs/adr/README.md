# Architecture decision records

One decision per file. ADRs are how parallel Claude sessions tell each other what changed and why. Read the new ones at the start of every session.

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-build-on-subscriptions-program.md) | Leash is a policy firewall on top of the Solana Foundation Subscriptions program; it never holds funds | Accepted |
| [0002](0002-strict-pay-and-reported-denials.md) | `pay` fails closed; blocked attempts are recorded by a separate `report_denied_attempt`, which drives the tripwire | Accepted |
| [0003](0003-x402-via-official-facilitator.md) | x402 compatibility through the official `@x402/svm` facilitator (smart-wallet path) with Leash on its allowlist | Accepted |
| [0004](0004-anchor-and-litesvm.md) | Anchor 1.x for the program; LiteSVM tests; shared policy test vectors for program ⇄ TypeScript parity | Accepted |
| [0005](0005-kit-and-codama-clients.md) | `@solana/kit` + Codama-generated clients; no web3.js v1 in our code | Accepted |
| [0006](0006-monorepo-and-service-stack.md) | pnpm + Turborepo + Biome; Hono services; Drizzle + libSQL; Next.js web | Accepted |
| [0007](0007-environments-and-artifacts.md) | localnet/devnet only; program binaries committed for LiteSVM; what cloud sessions can and cannot do | Accepted |
| [20260929-ws0-allowance-expiry-is-inclusive](20260929-ws0-allowance-expiry-is-inclusive.md) | Allowance expiry is inclusive (`now > expiry`), exactly as upstream; clamp ported | Accepted |
| [20260929-ws0-disabled-limits-are-not-tracked](20260929-ws0-disabled-limits-are-not-tracked.md) | Switched-off limits don't update counters; approved requests still count towards payee spend | Accepted |
| [20260929-ws0-denial-reporting-policy](20260929-ws0-denial-reporting-policy.md) | Strikes always reported; approvalRequired never; other denials once per reason per minute | Accepted |
| [20260930-ws4-fixture-replay](20260930-ws4-fixture-replay.md) | The storyline carries the account facts events lack; fixture replay gets speed and loop settings; replayed times follow the replay clock | Proposed (additive) |
| [20260930-ws7-approval-request-errors](20260930-ws7-approval-request-errors.md) | Two tool codes for failed approval requests; tools auto-request approval in `leash_pay` too; the "recorded" sentence only when true | Proposed (additive) |
| [20260930-ws1-program-interface](20260930-ws1-program-interface.md) | The program as built: Anchor 1.2 and Rust 1.94.1; IDL generated without the Anchor CLI and checked in CI; enums stored as variant index (`DenialReason` code n → n − 1); extra `pay` account checks (owner's ATA, SA named by the delegation, `InvalidDestination`); invalid periods at step 10 like the SDK; answers to 01 §13 | Proposed (additive) |
| [20260930-ws1-program-id](20260930-ws1-program-id.md) | The Leash program ID is `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu` (`LEASH_PROGRAM_ID`, `PROGRAM_IDS.leash`); the keypair stays out of git | Accepted (additive, contracts 1.4.0) |
| [20261003-ws2-rpc-robustness-on-devnet](20261003-ws2-rpc-robustness-on-devnet.md) | RPC calls retried on 429, 5xx and dropped connections (sends only on 429), also for the official facilitator's RPC; one blockhash per payment; gentler, then quicker confirmation polling | Accepted (implemented) |
| [20261003-ws5-sentinel-rule-refinements](20261003-ws5-sentinel-rule-refinements.md) | No burst alert (or principal freeze) for one agent whose tripwire fired; approved payments don't count as spikes or new-payee spend; action links on; Telegram as plain text | Accepted (implemented) |
| [20261003-ws4-indexer-snapshot-and-health](20261003-ws4-indexer-snapshot-and-health.md) | Account snapshot at start and after a start-over; start-over only after three missed cursors; `/v1/health.ok` false after three failed polls | Accepted (implemented; a 02 §7.1 sentence proposed) |
| [20261003-ws1-devnet-upgrade-authority](20261003-ws1-devnet-upgrade-authority.md) | 03-security T15 says where the devnet upgrade authority really is (the laptop's CLI key, with a backup), not "kept offline" | Proposed (wording) |

## Naming new ADRs

`YYYYMMDD-ws<N>-<slug>.md`, for example `20261001-ws1-manual-close-for-optional-request.md`. The date prefix means two sessions can never pick the same number. Add a row to the table above in the same commit.

## Template

```markdown
# <Title: the decision, stated as a sentence>

- Status: Proposed | Accepted | Superseded by <link>
- Date: YYYY-MM-DD
- Workstream: WS<N>
- Contract change: no | yes (affected: WS…)

## Context
What forces us to decide, with facts and links.

## Decision
What we will do. Specific enough to implement.

## Consequences
What becomes easier, what becomes harder, what we must now do.

## Alternatives considered
Each alternative with the reason it lost.
```
