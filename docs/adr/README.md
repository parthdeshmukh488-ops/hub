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
