# Anchor 1.x for the program; LiteSVM tests; shared policy test vectors

- Status: Accepted
- Date: 2026-09-29
- Workstream: architecture (WS1 records the exact pinned versions below)
- Contract change: n/a (founding decision)

## Context

- The program needs readable account validation (judges and reviewers read it), an IDL for client generation, and reliable event emission.
- Anchor's TypeScript package moved to `@anchor-lang/core` (1.2.0, Sept 2026). The Rust crates follow the same 1.x line.
- The Subscriptions program uses Pinocchio for compute efficiency. Our program's instruction count is small, and clarity matters more than the last few thousand compute units.
- LiteSVM (npm `litesvm` 1.5.0, Rust crate `litesvm`) runs real SBF binaries in-process: fast, deterministic, no validator.

## Decision

1. **Anchor 1.x** (latest stable at implementation time) with `#[event_cpi]` / `emit_cpi!` for events.
2. **LiteSVM** is the primary test harness, with the real Subscriptions binary loaded from `artifacts/programs/subscriptions.so`. Tests are in Rust (`programs/leash/tests/`), or in TypeScript if WS1 prefers. Either way they run with one command.
3. **Shared test vectors** (`packages/contracts/test-vectors/policy.json`) drive both the program tests and the TypeScript evaluator tests (WS2), which proves parity.
4. The built program is committed to `artifacts/programs/leash.so`, with a `artifacts/programs/CHECKSUMS` line and the commit it was built from, so cloud sessions without the SBF toolchain can run LiteSVM tests.

Pinned versions (WS1, [ADR 20260930-ws1-program-interface](20260930-ws1-program-interface.md)):

| Tool | Version |
| --- | --- |
| Anchor (Rust crates `anchor-lang`, `anchor-spl`; CLI) | 1.2.0 (`anchor-lang-idl` 0.1.4 builds the IDL) |
| Solana / Agave CLI | 4.1.2 (`cargo-build-sbf` 4.1.0, platform-tools v1.54); first SBF build 2026-09-30 |
| Rust toolchain (host: tests, clippy, IDL) | 1.98.1 (`rust-toolchain.toml`, CI), since the LiteSVM suites (2026-09-30); it was 1.94.1 before |
| litesvm | 0.17.0 (the Agave 4.3 runtime, which loads the SBPF v3 binaries Anchor 1.2 builds; needs rustc ≥ 1.97.1) |

## Consequences

- WS1 must build on a machine with the Solana toolchain (see ADR-0007) and commit the `.so` after each program change.
- Codama can read the Anchor IDL (`@codama/nodes-from-anchor`), so WS2 generates a Kit-native client (ADR-0005).

## Alternatives considered

- **Pinocchio:** lower CU, but slower to write and review, and it needs a hand-maintained IDL. Not worth it at our size.
- **`solana-test-validator` for tests:** slower and needs the full CLI; kept only for localnet end-to-end runs.
