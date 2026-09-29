# Leash: rules for every Claude session

**Leash** (working name) is a spending firewall for AI agents on Solana. The owner gives an agent a budget through Solana's official Allowances program; the Leash program decides, on-chain, whether each payment may go through: allowlisted payees only, within per-payment, per-payee and rate limits, never while frozen, with human approval above a threshold. A manipulated agent's blocked attempts become on-chain strikes, and after three it freezes itself. The owner's money never leaves the owner's wallet.

We are building it for the **Superteam Germany Solana Challenge at the WHU Prompting Progress hackathon**. Pitch deck, MVP and public GitHub repo are due **Sun Oct 4, 2026, 23:59**. Judging: useful idea, working prototype, clear role for Solana, potential to grow ([docs/hackathon-brief.md](docs/hackathon-brief.md)). The repo owner is **Parth**; you work for them.

## Read before doing anything

1. This file.
2. [docs/architecture/00-overview.md](docs/architecture/00-overview.md): vocabulary, invariants, components, flows.
3. Your workstream brief in [docs/workstreams/](docs/workstreams/README.md) and every document it lists under "Read first".
4. Your status file `docs/workstreams/status/WS<N>.md`, and any ADR in [docs/adr/](docs/adr/README.md) newer than it.
5. For history and reasoning: [docs/context/transcript.md](docs/context/transcript.md).

If nobody told you which workstream you are, ask Parth before touching code.

## The six invariants (never weaken one without an ADR)

| # | Rule |
| --- | --- |
| I1 | The agent can never move more than the owner's Subscriptions allowance (hard ceiling, enforced by the Foundation's audited program). |
| I2 | Every agent payment passes the Leash policy: allowlist, per-payment, per-payee and rate limits, expiry, freeze. |
| I3 | The owner or guardian can freeze one agent or all agents in one transaction; only the owner unfreezes. |
| I4 | Repeated policy violations freeze the agent automatically, on-chain (tripwire). |
| I5 | Every executed payment and every reported blocked attempt is an on-chain event. |
| I6 | No Leash server holds a key that can move owner funds. |

## How we work

- **Stay in your lane.** Edit only the paths your workstream owns ([ownership table](docs/workstreams/README.md#ownership)) and your own status file.
- **Contracts are law.** Implement [01-onchain-program.md](docs/architecture/01-onchain-program.md) and [02-contracts.md](docs/architecture/02-contracts.md) exactly. If the spec is wrong or missing something, say so and propose an ADR ([change process](docs/architecture/04-conventions.md#6-changing-a-contract)). Never silently diverge.
- **Plan first.** At the start of a build step, write your plan into your status file and show it to Parth. Wait for approval before large changes. Parth wants to understand and steer every part, not receive a black box.
- **Quality over speed.** Tests alongside code, failure cases first for security-relevant code, READMEs kept current. Definition of done: [04-conventions.md §4](docs/architecture/04-conventions.md#4-tests-and-definition-of-done).
- **Close every work block:** update your status file (done, next, open items, questions), commit with a Conventional Commit message (`feat(sdk): …`), push.
- **Sync at the start:** merge the latest `main` into your branch before working.

## Engineering rules (details in [04-conventions.md](docs/architecture/04-conventions.md))

- TypeScript strict, ESM, Biome, Vitest, zod at every boundary. Rust: Anchor 1.x, rustfmt, clippy `-D warnings`, LiteSVM tests.
- Money is `bigint` / `u64`, never floats. JSON amounts are base-unit strings.
- Solana access only through `@leash/sdk`; x402 only through `@leash/x402`; shared types only from `@leash/contracts`. No web3.js v1.
- Never hand-edit generated code (`src/generated/`, the IDL).
- Only `src/env.ts` reads `process.env`.

## Security rules

- Never commit keys, `.env` files or seed phrases. Keypairs live in `.keys/` (gitignored) and are referenced by file path.
- Devnet and localnet only. No mainnet transactions, ever.
- Agent-facing tool messages must never suggest a way around the policy.
- Labels and memos are untrusted text: render them as text, escape them in alerts.

## Environment

Claude Code on the web can reach npm and crates.io, but **not** Solana RPC, the Solana/Anchor installers, or GitHub release downloads ([ADR-0007](docs/adr/0007-environments-and-artifacts.md)). In the cloud: TypeScript work, host-side Rust tests, and LiteSVM tests with the committed `artifacts/programs/*.so`. Building `leash.so`, deploying, and anything that needs devnet runs on a machine with the Solana toolchain. If a task needs something your environment can't reach, stop and tell Parth instead of working around it.

## Map

| Where | What |
| --- | --- |
| `docs/architecture/` | Overview, program spec, off-chain contracts, security model, conventions |
| `docs/adr/` | Decisions and contract changes |
| `docs/workstreams/` | One brief per session (with a starter prompt) + status files |
| `docs/context/transcript.md` | How we got here: the full founding conversation |
| `docs/hackathon-brief.md` | Challenge rules, judging, submission checklist |
