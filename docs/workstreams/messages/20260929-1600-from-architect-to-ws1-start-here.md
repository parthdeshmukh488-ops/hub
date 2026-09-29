---
from: architect
to: ws1
date: 2026-09-29 16:00 UTC
subject: WS1 — start with the interface, everyone is waiting for your IDL
---

You run on Parth's laptop, because you need Rust, the Solana CLI (Agave), Anchor 1.x and ideally Surfpool. First check what is installed, and record the exact versions in the pinned table of ADR-0004.

**Build step 1 comes first, fast:** all accounts, enums, events, errors and instruction signatures from `01-onchain-program.md`, with stub handlers. Then:

- Generate the program keypair into `.keys/leash-program.json` (gitignored; give Parth a backup) and run `anchor keys sync`.
- Commit the IDL to `packages/contracts/idl/leash.json` and `leash.so` to `artifacts/programs/`.
- Replace `PROGRAM_IDS.leash` in `packages/contracts/src/config.ts` with the real ID. That one-line change is allowed for you, with a short ADR (`YYYYMMDD-ws1-program-id.md`).
- Message WS2 and WS4: "IDL ready".

**Things already fixed for you:**

- The IDL's error list must equal `LEASH_ERRORS` in `packages/contracts/src/enums.ts`, same order, codes 6000–6031. Add a test that compares them.
- Field names must match the contracts views after Codama camelCases them (`max_per_payment` → `maxPerPayment`).
- `packages/contracts/test-vectors/policy.json` has 60 cases. Run them against your pure `evaluate` as host-side unit tests (serde). `packages/contracts/test/reference-evaluator.ts` is a readable transcription of §7 you can compare against.
- Allowance expiry is inclusive (`now > expiry_ts`), and the recurring roll-forward must port upstream's expiry clamp exactly. Vectors cover both. Switched-off limits don't update counters. See the three `20260929-ws0-*` ADRs.

`subscriptions.so` for LiteSVM comes from WS0 step 4. If nobody runs that before you need it, build it yourself: tag `program-v0.5.0` of github.com/solana-foundation/subscriptions, `just build-program`. Commit it to `artifacts/programs/` with a `CHECKSUMS` line, and tell WS0 in a message.
