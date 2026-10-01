# WS1 status: Leash program

- Session branches: `claude/whu-hackathon-ideas-lz8trx` (cloud session: no Solana toolchain) and `main` (laptop session, with the Solana toolchain)
- Last updated: 2026-10-01
- Current build step: all seven steps done; the program is live on devnet. The laptop session now works through the laptop queue (below).

## Done

- **Step 1, interface** (cloud).
  - Anchor 1.2.0 workspace and `programs/leash`: 4 accounts, 5 enums, 18 instructions, 18 events (`emit_cpi!`), 32 errors (6000–6031).
  - IDL committed at `packages/contracts/idl/leash.json`. `cargo run -p leash --example idl -- --check` proves it matches the source (CI runs it), and `packages/contracts/test/idl.test.ts` checks it against the contracts.
  - Program ID `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu` (laptop; [ADR 20260930-ws1-program-id](../../adr/20260930-ws1-program-id.md), contracts 1.4.0). The keypair is `.keys/leash-program.json`: never committed, and Parth has a backup.
- **Step 3, pure evaluator** (cloud).
  - `policy/evaluate.rs` implements 01 §7.1; `policy/allowance.rs` ports upstream `validate_recurring_transfer` (tag `program-v0.5.0`) line for line.
  - `tests/vectors.rs` passes all 60 shared vectors. `tests/evaluate.rs` covers the SDK's branch tests and I1–I3 over random states.
- **Steps 2 and 4–6, handlers** (cloud), **proven on the real binaries by the LiteSVM suites** (laptop, 2026-09-30). The suites load `artifacts/programs/leash.so` and the audited `subscriptions.so` in LiteSVM 0.17:

  | Suite | Tests | What it proves |
  | --- | ---: | --- |
  | `pay` | 16 | The happy path through the real Subscriptions CPI; every denial reachable from a live state fails with its `Denied*` error and moves nothing; windows, counters, fixed and recurring allowances |
  | `admin` | 13 | The authorization matrix (owner ✓, guardian only freezes and rejects, anyone else ✗), idempotent switches that emit only on change, every validation rule |
  | `report` | 10 | Strike and non-strike reasons, the tripwire freeze (`by` = agent key), window roll-over, `AttemptWouldSucceed`, reports never move money |
  | `requests` | 8 | Create, approve, reject, expire, pay once with an approved request; every check in order, every mismatch, the 8-request cap |
  | `invariants` | 7 | I1 over random payment sequences (recurring and fixed allowances), I2 with every optional-account combination, I3, I4, I5 |
  | `substitution` | 9 | Every account slot of `pay` fed a wrong-but-plausible account fails and moves nothing (T6) |
  | `x402_shape` | 2 | `[CU limit, CU price, pay, Memo]` with a third-party fee payer that appears in no instruction: exactly one `TransferChecked` |
  | `vectors_onchain` | 1 (60 cases) | All 60 shared policy vectors on the real program: outcome, error code and every listed effect |
  | `compute_units` | 1 | [`CU.md`](../../../programs/leash/CU.md): `pay` uses 31.6k–33.2k of its 100k budget |

- **Build and artifacts** (laptop).
  - `anchor build` with Anchor CLI 1.2.0 and Agave 4.1.2 produces `artifacts/programs/leash.so`. `artifacts/programs/CHECKSUMS` records its sha256 and exact source (`sha256sum -c CHECKSUMS` verifies).
  - `anchor build`'s IDL is byte for byte the committed one.
  - `programs/leash/scripts/wsl-build.sh build|check` runs everything on WSL, Linux or macOS.
- **Devnet deployment** (laptop, 2026-09-30, approved by Parth).
  - Program `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu`, deployed in slot 505952773 (signature `4546rzqb5AvBAM6eXb8H52iraUTBjtLsbBgfToke251pLfcnggxhLZ8KAi15qetbvasXRB1VJ7VR8Jb6HuqdAYv1`), [explorer](https://explorer.solana.com/address/HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu?cluster=devnet).
  - ProgramData `5TRkV4E26jVpv6qm1REjJ3gzt8EBSkA8ynr2EceZWXoF` holds 2.25 SOL of rent.
  - `solana program dump` of the deployed program is byte for byte `artifacts/programs/leash.so` (sha256 `b10a7009…c0d13`).
  - The upgrade authority is the deployer key `99ngrThAhTqUPshHsXifwRXi2wgwjemZG8ehDtW1CKkS` (the laptop's Solana CLI default key, kept out of the repo; Parth has a backup), as 01 §12 prescribes for devnet.
  - `pnpm devnet:check` reports both Leash and Subscriptions executable.
- **Toolchain:** host Rust 1.98.1, because LiteSVM 0.17 (Agave 4.3) needs ≥ 1.97.1 ([ADR-0004](../../adr/0004-anchor-and-litesvm.md)); CI pins the same.
- **Check:** `cargo test` passes 128 tests (45 unit, 14 evaluator, 2 host vector suites, 66 LiteSVM, and the on-chain vector run), as do `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check` and the IDL drift check.
- **Decisions:** [ADR 20260930-ws1-program-interface](../../adr/20260930-ws1-program-interface.md) (contracts 1.3.0) and [ADR 20260930-ws1-program-id](../../adr/20260930-ws1-program-id.md) (contracts 1.4.0).
- **Found while testing:** Anchor 1.2 rejects a writable account passed twice with `ConstraintDuplicateMutableAccount` (2040) before any handler runs. So `pay` with destination = source fails with 2040, not `InvalidDestination`; `report_denied_attempt` (read-only token accounts) still returns `InvalidDestination`. No contract change: it is an extra rejection, and the SDK should treat 2040 as a client bug like the other account errors.
- Messages handled: through `20261001-0030-from-ws7-to-all-mcp-server-and-demo-agent-ready.md`.

## Laptop queue

The laptop session also runs what needs a real chain for the other workstreams ([BOARD](../BOARD.md)). State on 2026-10-01:

| # | Item | Localnet | Devnet |
| --- | --- | --- | --- |
| 1 | Fund the demo keys | not needed | **Open:** all six keys hold 0 SOL (`pnpm devnet:check`) |
| 2 | `devnet:setup`, `devnet:smoke` | Passed ([message](../messages/20260930-1713-from-ws1-to-ws2-rpcchain-first-real-run.md)) | Waits for item 1 |
| 3 | Indexer chain mode | n/a | Waits for WS4 |
| 4 | `x402:smoke` through `services/facilitator` | Passed with a one-line fix that WS3 still has to commit ([message](../messages/20261001-0105-from-ws1-to-all-x402-and-demo-agent-on-a-real-chain.md)) | Waits for item 1 and that fix |
| 5 | `demo:all -- --scripted` | Passed twice. So did `runaway` and the MCP server over stdio (same message). | Waits for items 2 and 4. LLM mode needs Parth's `ANTHROPIC_API_KEY`. |
| 6 | The full demo and its recording | n/a | Oct 3–4 |

A run order that works:
1. `pnpm localnet`, then `pnpm devnet:setup --cluster localnet`.
2. The facilitator, and the merchant with payments on.
3. `x402:smoke`, then `devnet:smoke`: its unfreeze clears the strike `x402:smoke` leaves.
4. The demo, with `AGENT_KEYPAIR=../../.keys/agent.json` or an absolute path.

## Next

1. Keep `leash.so`, `CHECKSUMS`, the IDL and the devnet deployment in step with every program change. Rebuild on the laptop, then upgrade devnet with `solana program deploy artifacts/programs/leash.so --program-id .keys/leash-program.json --url devnet`; the deployer key signs as upgrade authority.
2. The live demo needs funded demo keys on devnet (SOL, plus devnet USDC for owner-demo); `pnpm devnet:check` prints what each one needs.

## Security checklist (03-security §4)

Each item is proven by the named LiteSVM tests:

- [x] Every signer is checked: agent key (`has_one` + seeds), owner (`has_one` + seeds), guardian (`is_owner_or_guardian`). Tests: `admin` authorization matrix, `substitution::signer_principal_and_agent_cannot_be_swapped`, `report::only_the_agent_key_can_report`.
- [x] Every PDA is verified with its stored canonical bump; only `init` at the canonical seeds creates entries and requests. Tests: `substitution` (principal and agent swaps fail the seeds), `admin` (a payee can't be added twice).
- [x] Foreign account owners: token accounts and mint through `InterfaceAccount`; delegation and Subscription Authority owned by Subscriptions and named by each other. Tests: `substitution::the_delegation_must_be_this_owners_to_this_agent`, `::the_subscription_authority_must_be_the_one_the_delegation_names`, `::mint_token_program_and_program_addresses_are_fixed`.
- [x] The CPI target is the Subscriptions constant, and its event authority a derived constant. Test: `substitution::mint_token_program_and_program_addresses_are_fixed`.
- [x] All arithmetic is `checked_*`; `saturating_*` only where the spec says. Tests: the host overflow tests in `tests/evaluate.rs` and the state unit tests.
- [x] Closed accounts: lamports go back and the account is gone; there is no re-initialization path. Tests: `admin::removing_the_last_payee_refunds_the_rent_and_then_the_agent_can_close`, `requests` (rejected, expired and consumed requests close, and a consumed request can't pay twice).
- [x] Every `UncheckedAccount` has a `CHECK:` comment naming its checks (Anchor's build safety check enforces it).
- [x] Optional accounts: an entry that doesn't match is "not allowlisted", and `request` and `request_rent_receiver` come together. Tests: `invariants::i2_…whatever_accounts_are_passed`, `requests::a_request_pays_only_the_exact_approved_payment`, `vectors_onchain`.
- [x] `pay` never returns `Ok` without the transfer. Tests: every `pay` denial asserts nothing moved; `invariants::i5` asserts one `TransferChecked` per successful payment.
- [x] `pay`'s compute budget is measured ([`CU.md`](../../../programs/leash/CU.md)).

## Open items

- `pay` runs in LiteSVM (Agave 4.3) without stack errors, and `cargo build-sbf` reports no stack-offset warnings.
- Devnet runs a newer Subscriptions build than the tag (133,280 bytes, sha256 `39a71fa3…`). On 2026-09-30 the whole suite (128 tests, including all 60 vectors) also passed with that exact binary, dumped from devnet and loaded in LiteSVM in place of the tag build. Leash is proven against both the audited tag and the program the demo runs on. Re-run after upstream upgrades: `solana program dump De1eg…avR44 subscriptions.so --url devnet`, swap it into the WSL mirror only, then `cargo test`.

## Questions for other workstreams

- None open.

## Contract changes proposed

- [ADR 20260930-ws1-program-interface](../../adr/20260930-ws1-program-interface.md) (additive, contracts 1.3.0): the committed IDL and the clarifications of 01 §5, §6, §9, §10, §13.
- [ADR 20260930-ws1-program-id](../../adr/20260930-ws1-program-id.md) (additive, contracts 1.4.0): the real program ID.
