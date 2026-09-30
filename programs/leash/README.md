# leash (Anchor program)

The on-chain spending firewall. The owner gives an agent a budget through the Solana Foundation's Subscriptions program, with the agent's `Agent` PDA as the delegatee. The agent can only spend through `pay`, which checks the owner's policy before it asks Subscriptions to move the money. The owner's funds never leave the owner's wallet.

Owned by **WS1**. Specification: [01-onchain-program.md](../../docs/architecture/01-onchain-program.md). Brief: [WS1-program.md](../../docs/workstreams/WS1-program.md). Status: [WS1.md](../../docs/workstreams/status/WS1.md). Decisions taken while building: [ADR 20260930-ws1-program-interface](../../docs/adr/20260930-ws1-program-interface.md).

## Status

| Part | State |
| --- | --- |
| Interface: 4 accounts, 5 enums, 18 instructions, 18 events, 32 errors | Done. IDL committed at [`packages/contracts/idl/leash.json`](../../packages/contracts/idl/leash.json), checked in CI |
| Policy evaluation (01 §7) | Done: pure Rust, 60/60 shared vectors |
| Instruction handlers | Written and compiling. The pure parts (evaluation, windows, strikes, counters, policy rules, delegation layout, CPI bytes) are unit-tested on the host. |
| Program ID and `leash.so` | Done on the laptop: `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu` ([ADR](../../docs/adr/20260930-ws1-program-id.md)); binary at [`artifacts/programs/leash.so`](../../artifacts/programs/CHECKSUMS) |
| LiteSVM suites (01 §11), `CU.md`, devnet | Need a machine with the Solana toolchain ([ADR-0007](../../docs/adr/0007-environments-and-artifacts.md)) |

The program ID is `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu`. Its keypair lives in `.keys/leash-program.json`, which is never committed; Parth keeps a backup.

## Commands

Any machine with Rust (the toolchain comes from `rust-toolchain.toml`), from the repo root:

```bash
cargo test                                       # 61 tests: unit, the 60 policy vectors, evaluator invariants
cargo clippy --all-targets -- -D warnings
cargo fmt --all -- --check
cargo run -p leash --example idl -- --write      # regenerate packages/contracts/idl/leash.json
cargo run -p leash --example idl -- --check      # CI: fails if the committed IDL is stale
```

The `idl` example calls Anchor's IDL builder (`anchor-lang-idl` 0.1.4) with the same options as `anchor idl build`, so its output is byte for byte what `anchor build` writes to `target/idl/leash.json`. It needs neither the Anchor CLI nor the Solana toolchain.

With the Solana toolchain (Agave CLI 4.1.2, Anchor CLI 1.2.0) and `.keys/leash-program.json` in place:

```bash
bash programs/leash/scripts/wsl-build.sh build   # anchor build + IDL; copies leash.so, the IDL and Cargo.lock back
bash programs/leash/scripts/wsl-build.sh check   # what CI runs: fmt, clippy, cargo test, the IDL drift check
```

The script mirrors the repository to `~/leash-build` first, because cargo is slow on a Windows drive under WSL. It works the same on Linux and macOS. Without it: copy the keypair to `target/deploy/leash-keypair.json`, then `anchor keys sync` (checks the ID in `lib.rs` and `Anchor.toml`) and `anchor build`. `anchor build`'s `target/idl/leash.json` is byte for byte the IDL the `idl` example writes (checked on 2026-09-30).

After a program change, commit `artifacts/programs/leash.so`, its provenance and sha256 in [`artifacts/programs/CHECKSUMS`](../../artifacts/programs/CHECKSUMS), and the IDL, in the same commit.

## Layout

| Path | Contents |
| --- | --- |
| `src/lib.rs` | The 18 instruction entry points, nothing else |
| `src/instructions/` | One file per instruction with its `Accounts` struct. `payment.rs` holds the account checks `pay` and `report_denied_attempt` share. |
| `src/policy/` | Pure evaluation: `evaluate.rs` (§7.1), `windows.rs` (§7.2), `allowance.rs` (Subscriptions' `validate_recurring_transfer`, ported line for line from tag `program-v0.5.0`) |
| `src/state/` | `Principal`, `Agent` (+ `AgentStats`), `Payee`, `PaymentRequest`, `Policy`, `PayeeLimits`, the enums, and the state transitions (freeze, strikes, payment counters) |
| `src/subscriptions/` | Read-only parsing of v1 delegation accounts, and the `TransferFixed` / `TransferRecurring` CPI |
| `src/events.rs`, `src/errors.rs`, `src/constants.rs` | Events (§9), `LeashError` (§10, codes 6000–6031), constants and seeds (§3) |
| `tests/vectors.rs` | Every case of `packages/contracts/test-vectors/policy.json` against `evaluate`, outcome and effects |
| `tests/evaluate.rs` | The branches the vectors don't reach, and invariants I1–I3 over random states (the same cases as the SDK's tests) |
| `examples/idl.rs` | IDL generation and the CI drift check |
| `scripts/wsl-build.sh` | `anchor build` with the Solana toolchain, copying `leash.so`, the IDL and `Cargo.lock` back into the repository |

## How `pay` decides

1. **Account checks** (errors, never denials):
   - Anchor constraints: signer, seeds with the stored bumps, `has_one`, token program and mint.
   - Then `check_payment_accounts`:
     - the delegation is a version-1 Subscriptions account from this owner to this Agent PDA for this mint;
     - both token accounts hold the mint;
     - the source is the owner's associated token account;
     - the destination is neither the source nor owned by the agent;
     - the Subscription Authority is the one the delegation names.
2. **`evaluate`** on plain data. The first failing check of 01 §7.1 wins, and a denial fails the transaction with its `Denied*` error.
3. **Effects:** the velocity window, the payee period and totals, and the agent totals. A consumed request is closed after the transfer, and its rent returned.
4. **CPI into Subscriptions**, with the Agent PDA signing as the delegatee. Remaining accounts are forwarded for Token-2022 hooks.
5. **`PaymentExecuted`**, through `emit_cpi!`.

There is no path that returns `Ok` without the CPI (ADR-0002). `report_denied_attempt` runs the same checks and the same evaluation. It fails with `AttemptWouldSucceed` when the payment would go through, so it can never move money or frame an agent.
