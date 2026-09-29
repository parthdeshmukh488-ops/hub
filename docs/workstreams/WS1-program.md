# WS1: Leash program (Rust / Anchor)

## Mission

Implement the on-chain firewall exactly as specified, and prove it with tests a security reviewer would respect. This is the part the judges scrutinize for "a clear role for Solana". Every invariant in the pitch must be true here.

## Read first

[01-onchain-program](../architecture/01-onchain-program.md) (your spec, all of it) · [00-overview](../architecture/00-overview.md) · [03-security](../architecture/03-security.md) · [04-conventions](../architecture/04-conventions.md) · [ADR-0001](../adr/0001-build-on-subscriptions-program.md) · [ADR-0002](../adr/0002-strict-pay-and-reported-denials.md) · [ADR-0004](../adr/0004-anchor-and-litesvm.md) · [ADR-0007](../adr/0007-environments-and-artifacts.md) · the Subscriptions source at github.com/solana-foundation/subscriptions (`program/src/instructions/transfer_*`, `helpers/transfer_validation.rs`, `state/`)

## You own

`programs/leash/`, `Anchor.toml`, root `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `artifacts/programs/leash.so` (+ its `CHECKSUMS` line), `packages/contracts/idl/leash.json`, `programs/leash/CU.md`.

## You provide

- The deployed program (localnet and devnet) and its program ID, recorded in `packages/contracts/src/config.ts` through WS0 (or a one-line contract-change ADR).
- **An interface-complete IDL as early as possible** (build step 1), so WS2 and WS4 can generate and decode before your handlers are finished.
- `leash.so` committed after every program change.

## Environment

SBF builds, IDL generation and deployment need the Solana toolchain: run this session on a local machine, or in a cloud environment that allows the Solana hosts ([ADR-0007](../adr/0007-environments-and-artifacts.md)). Host-side `cargo test` of the pure evaluator runs anywhere.

## Design notes

Suggested module layout:

```text
programs/leash/src/
├── lib.rs                 instruction entry points only (thin)
├── constants.rs
├── errors.rs              LeashError — the first 12 variants are the denials, in order
├── events.rs
├── state/                 principal.rs, agent.rs, payee.rs, request.rs, policy.rs
├── policy/
│   ├── evaluate.rs        pure: fn evaluate(&EvalInput) -> Result<(), Denial>  (no AccountInfo)
│   └── windows.rs         rolled(), recurring-period roll-forward mirror
├── subscriptions/
│   ├── layout.rs          read-only parsing of Fixed/Recurring delegation v1 (01 §8.3)
│   └── cpi.rs             TransferFixed/TransferRecurring instruction + invoke_signed
└── instructions/          one file per instruction, each with its Accounts struct
```

- **Keep evaluation pure.** `evaluate` works on plain data (`EvalInput { principal_frozen, agent, policy, stats, payee: Option<PayeeData>, request: Option<RequestData>, allowance: AllowanceData, source_amount, destination_owner, amount, reference, now }`). Instruction handlers only gather data, call `evaluate`, and apply effects. This makes the test vectors runnable as host unit tests (`serde_json` in dev-dependencies), in any environment.
- **The recurring-allowance mirror** must reproduce Subscriptions' `validate_recurring_transfer` bit for bit, including the expiry clamp branch. Port it with a comment linking the exact upstream file and commit.
- **CPI:** build the 73-byte instruction data manually (01 §8.1) and the account metas in the exact upstream order (01 §8.2); `invoke_signed` with the Agent PDA seeds. Forward `remaining_accounts` untouched.
- **Optional accounts:** use Anchor's `Option<Account<…>>`. If closing an optional `request` inside `pay` isn't supported by constraints, close manually (move lamports, zero data, assign to system program) and record the decision in an ADR.
- **Events:** `#[event_cpi]` on every instruction that emits; `emit_cpi!`.
- **Program keypair:** generate it once, keep it in `.keys/leash-program.json` (gitignored), and give Parth a copy. The program ID must never change after other workstreams start using it.

## Tests

Use LiteSVM with `artifacts/programs/subscriptions.so` and your own `leash.so`. Set up in a helper: USDC-like mint (6 decimals), owner with funded ATA, Subscription Authority, recurring delegation to the Agent PDA, merchant and attacker wallets with ATAs.

| Suite | Content |
| --- | --- |
| `vectors` | Every case in `packages/contracts/test-vectors/policy.json` against `evaluate` (host) **and** against the real program for a representative subset (LiteSVM) |
| `admin` | Every owner/guardian instruction, the authorization matrix (owner ✓, guardian only for freeze and reject, stranger ✗), idempotency of freeze and unfreeze |
| `pay` | Happy path, each denial reason, balances before and after, events, counters and windows |
| `report` | Strike vs non-strike reasons, window roll-over, tripwire freeze, `AttemptWouldSucceed` |
| `requests` | Create, approve, reject, expire, pay-with-request, mismatches, `MAX_OPEN_REQUESTS` |
| `invariants` | The I1–I5 tests of [03-security §3](../architecture/03-security.md#3-invariant-tests), including a randomized sequence property test for I1 |
| `substitution` | Every account slot fed a plausible wrong account (01 §11.5) |
| `x402-shape` | `[CU limit, CU price, pay, Memo]` with a third-party fee payer: succeeds; exactly one inner `TransferChecked`; fee payer in no instruction |

Record compute units for every instruction in `CU.md` (`pay` without a request must stay under 100k).

## Build order (quality gates)

1. **Interface first.** Anchor workspace, all accounts, enums, events, errors and instruction signatures, with stub handlers that return an error. Generate and commit the IDL. Build `leash.so`. Program ID recorded. *This unblocks WS2 and WS4. Do it first and fast.*
2. **Admin instructions.** Principal, agent, payees, freeze and unfreeze, with `admin` tests.
3. **Pure evaluator.** `policy/` plus host tests over all test vectors (runs anywhere).
4. **`pay`.** Accounts validation, CPI, effects, events. `pay` and `x402-shape` tests.
5. **`report_denied_attempt` and tripwire.** `report` tests.
6. **Requests.** `request_payment`, `approve_request`, `reject_request`, `expire_request`, pay-with-request. `requests` tests.
7. **Hardening.** `invariants` and `substitution` suites, `CU.md`, the security checklist from 03-security §4 ticked in your status file, devnet deployment, final IDL and `.so` committed.

## Definition of done (in addition to the general one)

- All suites pass in one command (`anchor test` or `cargo test`, documented in `programs/leash/README.md`).
- The IDL and `leash.so` in the repo match the source at `HEAD` (CHECKSUMS records the commit).
- Every item of the program security checklist is ticked or has an ADR explaining why not.

## Pitfalls

- `pay` must never return `Ok` without transferring (ADR-0002). Add a test that proves it for every denial.
- Don't trust `payee_entry` just because it deserializes: check `agent` and `payee` fields against the actual agent and destination owner.
- The destination **owner**, not the destination address, is what the allowlist checks.
- Reject delegation accounts whose `version != 1`; never guess a layout.
- The facilitator's fee payer must not appear in any account list: `pay` must not take a `payer` account.

## Starter prompt

```text
You are the WS1 (Leash program, Rust/Anchor) engineer on Leash, a spending firewall for AI agents on Solana.

Before anything else:
1. Merge the latest main into your branch.
2. Read CLAUDE.md, docs/architecture/00-overview.md, docs/workstreams/WS1-program.md and every document its "Read first" section lists — especially docs/architecture/01-onchain-program.md, which you implement exactly.
3. Read docs/workstreams/status/WS1.md (create it from docs/workstreams/status/README.md if missing) and any ADRs newer than it. Then read docs/workstreams/BOARD.md and every file in docs/workstreams/messages/ addressed to ws1 or to all.
4. Check whether this environment has the Solana toolchain (solana, anchor, cargo build-sbf) and RPC access; tell me what's available.

Then tell me in a short message: what you understand your job to be, which build step you will do now, your plan for it, and anything in the spec that looks wrong or underspecified. Wait for my OK before writing code.

Rules: only edit the paths WS1 owns; follow docs/architecture/04-conventions.md; any change to the program interface goes through an ADR; end every work block by updating your status file, committing and pushing (including leash.so and the IDL when the program changed).
```
