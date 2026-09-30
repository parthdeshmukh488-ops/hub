# WS1 status: Leash program

- Session branches: `claude/whu-hackathon-ideas-lz8trx` (cloud session: no Solana toolchain) and `main` (laptop session, with the Solana toolchain)
- Last updated: 2026-09-30
- Current build step: steps 1 and 3 done; program ID and `leash.so` done on the laptop; handlers for steps 2 and 4–6 written, their LiteSVM suites are next

## Done

- **Step 1, interface.**
  - Anchor 1.2.0 workspace: `Cargo.toml`, `Anchor.toml`, `rust-toolchain.toml` (Rust 1.94.1), `programs/leash`.
  - Contents: 4 accounts, 5 enums, 18 instructions with their `Accounts` structs, 18 events (`emit_cpi!`), 32 errors (6000–6031).
  - IDL committed at `packages/contracts/idl/leash.json`.
    - `cargo run -p leash --example idl -- --check` proves it matches the source; CI runs it.
    - `packages/contracts/test/idl.test.ts` (31 tests) checks it against the contracts: errors equal `LEASH_ERRORS`, program ID, constants and seeds, `pay`'s account order and flags, enum variant order, account and event fields against the views and JSON events.
  - Program ID is still the placeholder.
- **Step 3, pure evaluator.**
  - `policy/evaluate.rs` implements 01 §7.1 on plain data.
  - `policy/allowance.rs` is a line-for-line port of upstream `validate_recurring_transfer` (tag `program-v0.5.0`, commit `364a4197`), including the expiry clamp, with upstream's own unit tests.
  - `tests/vectors.rs`: 60/60 shared vectors, outcomes and effects. A deliberately broken evaluator fails 6 of them.
  - `tests/evaluate.rs`: the SDK's branch tests (the overflows, invalid periods at step 10, an over-pulled period) and the invariants I1–I3 over 20,000 random states each. A planted balance bug fails I1.
  - Coverage (`cargo llvm-cov`) of the policy engine, the state transitions and the delegation layout: every line, except mapping upstream's arithmetic errors, which provably can't happen.
- **Handlers for steps 2 and 4–6**, all written and compiling:
  - admin: principal, agents, payees, freeze and unfreeze, approve and reject;
  - `pay` with the Subscriptions CPI;
  - `report_denied_attempt` with the tripwire;
  - `request_payment` and `expire_request`.
  - Their state transitions are unit-tested on the host: strikes and tripwire, windows, counters, policy rules, request checks, the delegation layout, and the CPI bytes and account order.
- **Laptop, 2026-09-30: program ID and `leash.so`.**
  - Agave 4.1.2 and Anchor CLI 1.2.0 installed; versions recorded in ADR-0004.
  - Program ID `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu` ([ADR 20260930-ws1-program-id](../../adr/20260930-ws1-program-id.md), contracts 1.4.0) in `declare_id!`, `Anchor.toml`, the IDL's `address` and `PROGRAM_IDS.leash`. `anchor keys sync` confirms them against `.keys/leash-program.json` (never committed; Parth has a backup).
  - `anchor build` produced `artifacts/programs/leash.so` (442,776 bytes), with its provenance and sha256 in `artifacts/programs/CHECKSUMS`. Its `target/idl/leash.json` is byte for byte the committed IDL.
  - `programs/leash/scripts/wsl-build.sh build|check` runs both on WSL, Linux or macOS.
- Check: `cargo test` passes (61 tests: 45 unit, 14 evaluator, 2 vector suites), as do `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`. CI runs them all, plus the IDL check.
- Decisions: [ADR 20260930-ws1-program-interface](../../adr/20260930-ws1-program-interface.md), contracts 1.3.0.
  - Enum encoding: `DenialReason` code n is stored as n − 1.
  - Extra account checks: owner's ATA as source, the Subscription Authority named by the delegation, `InvalidDestination`.
  - Invalid recurring periods are rejected at step 10, as in the SDK.
  - Idempotent switches emit only on change.
  - `PaymentDenied.strikes` semantics.
  - Answers to 01 §13.
- Messages handled: through `20260929-1815-from-ws2-to-ws1-parity-edge-cases.md` (answered in `20260930-1000-from-ws1-to-ws2-idl-ready.md`).

## Next (needs a machine with the Solana toolchain)

1. `subscriptions.so` from WS0 step 4 (tag `program-v0.5.0`). Then the LiteSVM suites of the brief, failure cases first:
   - `admin`, `pay`, `report`, `requests`, `invariants` (I1 property test), `substitution`, `x402-shape`;
   - plus a subset of the vectors on the real program;
   - measure compute units into `CU.md` (`pay` without a request must stay under 100k).
   - LiteSVM 0.17 (the Agave 4.x runtime that loads Anchor 1.2's SBPF v3 binaries) needs rustc ≥ 1.97.1, so the suites bring a host toolchain bump from 1.94.1 (`rust-toolchain.toml`, CI, ADR-0004).
2. Hardening: tick the checklist below with tests; deploy to devnet (Parth approves the deployment).

## Security checklist (03-security §4)

Written in code, **not yet proven by LiteSVM tests**:

- [ ] Every signer is checked. Agent key: `has_one` and seeds. Owner: `has_one` and seeds. Guardian: `is_owner_or_guardian`.
- [ ] Every PDA is verified with its stored canonical bump. Payee entries and requests passed to `pay` are Leash-owned accounts with a discriminator; `evaluate` checks their `agent` and `payee` fields, and only `init` at the canonical seeds creates them.
- [ ] Foreign account owners:
  - token accounts and mint: `InterfaceAccount`;
  - delegation: Subscriptions;
  - Subscription Authority: Subscriptions, and named by the delegation.
- [ ] CPI target is the Subscriptions constant; its event authority is a derived constant.
- [ ] All arithmetic is `checked_*`, and `saturating_*` only where the spec says (strikes, upstream's elapsed time).
- [ ] Closed accounts: Anchor `close` for agents, payees and rejected or expired requests; `AccountsClose::close` for requests consumed by `pay`.
- [ ] Every `UncheckedAccount` has a `CHECK:` comment naming its checks.
- [ ] Optional accounts: a `payee_entry` that doesn't match is "not allowlisted" (a denial, as the vectors require); `request` and `request_rent_receiver` come together or not at all.
- [ ] `pay` has no path that returns `Ok` without the CPI.
- [ ] `pay`'s compute budget measured (`CU.md`).

## Open items

- Stack usage of `pay` on SBF has not been measured. If LiteSVM reports a stack frame violation, box `EvalInput` or split the handler.
- `artifacts/programs/subscriptions.so` comes with WS0 step 4.
- Devnet, checked by RPC on 2026-09-30: the canonical Subscriptions program is deployed and executable, and the USDC mint `4zMMC9…DncDU` exists (6 decimals, SPL Token). WS0's `devnet-check` script will repeat the check.

## Questions for other workstreams

- None open.

## Contract changes proposed

- [ADR 20260930-ws1-program-interface](../../adr/20260930-ws1-program-interface.md) (additive, contracts 1.3.0): the committed IDL and the clarifications of 01 §5, §6, §9, §10, §13.
- [ADR 20260930-ws1-program-id](../../adr/20260930-ws1-program-id.md) (additive, contracts 1.4.0): the real program ID.
