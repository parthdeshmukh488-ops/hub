# WS1 status: Leash program

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session: no Solana toolchain)
- Last updated: 2026-09-30
- Current build step: steps 1 and 3 done; handlers for steps 2 and 4–6 written; their LiteSVM tests need the laptop

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
- **Handlers for steps 2 and 4–6**, all written and compiling:
  - admin: principal, agents, payees, freeze and unfreeze, approve and reject;
  - `pay` with the Subscriptions CPI;
  - `report_denied_attempt` with the tripwire;
  - `request_payment` and `expire_request`.
  - Their state transitions are unit-tested on the host: strikes and tripwire, windows, counters, policy rules, request checks, the delegation layout, and the CPI bytes and account order.
- Check: `cargo test` passes (42 unit + 2 vector tests), as do `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`.
- Decisions: [ADR 20260930-ws1-program-interface](../../adr/20260930-ws1-program-interface.md), contracts 1.3.0.
  - Enum encoding: `DenialReason` code n is stored as n − 1.
  - Extra account checks: owner's ATA as source, the Subscription Authority named by the delegation, `InvalidDestination`.
  - Invalid recurring periods are rejected at step 10, as in the SDK.
  - Idempotent switches emit only on change.
  - `PaymentDenied.strikes` semantics.
  - Answers to 01 §13.
- Messages handled: through `20260929-1815-from-ws2-to-ws1-parity-edge-cases.md` (answered in `20260930-1000-from-ws1-to-ws2-idl-ready.md`).

## Next (needs a machine with the Solana toolchain)

1. Install Agave and Anchor CLI 1.2.0, and record the Agave version in ADR-0004.
2. Program keypair:
   - `solana-keygen new -o .keys/leash-program.json`, and give Parth a backup;
   - copy it to `target/deploy/leash-keypair.json`, then run `anchor keys sync`;
   - regenerate the IDL (`--write`);
   - record the ID in `PROGRAM_IDS.leash` with a one-line ADR;
   - message WS2 and WS4.
3. `anchor build`, then commit `artifacts/programs/leash.so` with a `CHECKSUMS` line. `subscriptions.so` comes from WS0 step 4 (tag `program-v0.5.0`, `just build-program`).
4. The LiteSVM suites of the brief, failure cases first:
   - `admin`, `pay`, `report`, `requests`, `invariants` (I1 property test), `substitution`, `x402-shape`;
   - plus a subset of the vectors on the real program;
   - measure compute units into `CU.md` (`pay` without a request must stay under 100k).
5. Hardening: tick the checklist below with tests; deploy to devnet.

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
- `artifacts/programs/` does not exist yet (`subscriptions.so`, WS0 step 4).
- Devnet: the canonical Subscriptions deployment is unverified (WS0 `devnet-check`).

## Questions for other workstreams

- None open.

## Contract changes proposed

- [ADR 20260930-ws1-program-interface](../../adr/20260930-ws1-program-interface.md) (additive, contracts 1.3.0): the committed IDL and the clarifications of 01 §5, §6, §9, §10, §13.
