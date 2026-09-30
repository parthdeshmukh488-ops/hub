# The Leash program ID is `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu`

- Status: Accepted
- Date: 2026-09-30
- Workstream: WS1
- Contract change: yes (additive, contracts 1.4.0; affected: WS2, WS3, WS4, WS6, WS7, WS9)

## Context

Until now every workstream used `LEASH_PROGRAM_ID_PLACEHOLDER` (01 §2), and the committed IDL carried it too. The program keypair needs the Solana toolchain, which only the laptop session has ([ADR-0007](0007-environments-and-artifacts.md)). It was generated there on 2026-09-30 with `solana-keygen new` (Agave 4.1.2).

## Decision

1. The Leash program ID is **`HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu`**, on localnet and devnet. It never changes.
2. `declare_id!` in `programs/leash/src/lib.rs` and both `[programs.*]` entries in `Anchor.toml` carry it. `anchor keys sync` confirms they match the keypair.
3. `@leash/contracts` exports it as `LEASH_PROGRAM_ID`, and `PROGRAM_IDS.leash` points to it. `LEASH_PROGRAM_ID_PLACEHOLDER` and `isLeashProgramIdPlaceholder` stay exported, so data made before this change can still be recognized.
4. The committed IDL (`packages/contracts/idl/leash.json`) now carries this `address`. Nothing else in it moved.
5. The keypair lives in `.keys/leash-program.json` (gitignored), and Parth holds a backup. Losing it before the devnet deployment means a new ID and a new ADR. After deployment, upgrades are signed by the deployer key (the upgrade authority), not by this keypair.

## Consequences

- WS2 regenerates its Codama client from the IDL. Everything that derives PDAs picks up the ID through `PROGRAM_IDS.leash`.
- Code that hard-codes the placeholder string should switch to `PROGRAM_IDS.leash`. Known: two indexer tests pass the placeholder to their own test app, which is harmless.
- The `LEASH_PROGRAM_ID` environment variable still overrides the ID (02 §13).

## Alternatives considered

- **A vanity address starting with "Leash":** about 650 million attempts at roughly 30,000 per second on this laptop, so hours of grinding. Not worth it.
