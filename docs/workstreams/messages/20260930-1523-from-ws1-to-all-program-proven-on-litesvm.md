---
from: ws1
to: all (mainly ws2, ws3, ws9)
date: 2026-09-30 15:23 UTC
subject: The program is proven on the real binaries; Rust 1.98.1; leash.so rebuilt
---

The LiteSVM suites of 01 §11 pass on the committed `leash.so` and the audited `subscriptions.so` ([status/WS1.md](../status/WS1.md)):

- 66 tests: admin, pay, report, requests, invariants I1–I5, account substitution, the x402 shape, compute units.
- All 60 shared policy vectors on the real program, with the real Subscriptions CPI for the allowed cases. The TypeScript evaluator, the Rust evaluator and the binary agree on every case.

Compute units are in [programs/leash/CU.md](../../../programs/leash/CU.md): `pay` uses 31.6k–33.2k. The whole x402 transaction `[CU limit, CU price, pay, Memo]` uses 32.3k.

What changed for you:

- **Rust 1.98.1.** `rust-toolchain.toml` and CI moved from 1.94.1, because LiteSVM 0.17 needs ≥ 1.97.1. rustup fetches it on the first `cargo` run (static.rust-lang.org is reachable from the cloud).
- **`leash.so` was rebuilt** from unchanged source. The LiteSVM dev-dependencies moved a few shared crates in `Cargo.lock`, and the binary must match the lock. New sha256 `b10a7009…c0d13`, in `artifacts/programs/CHECKSUMS`. Pull before loading it.
- **WS2 (errors):** Anchor 1.2 rejects a writable account passed twice with `ConstraintDuplicateMutableAccount` (2040) before the handler runs. `pay` with destination = source therefore fails with 2040, not `InvalidDestination`; `report_denied_attempt` still returns `InvalidDestination`. Treat 2040 like the other account errors: a client bug, never a denial, never reported.
- **WS2 (`@leash/sdk/testing`):** `programs/leash/tests/common/mod.rs` shows a working setup you can mirror in TypeScript with `litesvm` 1.5. It has the mint and token accounts, the real `InitSubscriptionAuthority` (0) and `CreateRecurringDelegation` (2) / `CreateFixedDelegation` (1) instructions (read the authority's `init_id` at byte 98), and event decoding from inner instructions.
- **WS3:** `tests/x402_shape.rs` proves what your facilitator will verify: the fee payer is in no instruction, and there is exactly one `TransferChecked` of the price with the mint's decimals.
- **WS9:** `pnpm localnet` (WS0) plus these binaries give the end-to-end suite a real chain.

Next on the laptop: the devnet deployment, once Parth approves it.
