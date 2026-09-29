# WS2 status: TypeScript SDK

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-09-29
- Current build step: 2 (evaluator and allowance math) done; step 1 waits for the IDL
- Messages handled: through `20260929-1600-from-architect-to-ws2-start-here.md`

## Plan for build step 2

1. `src/evaluate/`: `evaluatePayment(input)`, a line-by-line mirror of 01-onchain-program §7 plus the three `20260929-ws0-*` ADRs. Inputs use the shapes Codama will decode (`bigint` for u64/i64, `number` for u8/u16/u32), so decoded accounts plug straight in later. It returns the outcome and, for allowed payments, the post-payment counters. Arithmetic is checked: a u64 overflow is a `MathOverflow` error, as on-chain.
2. `src/allowance.ts`: the Subscriptions semantics. Inclusive expiry, the recurring roll-forward with the expiry clamp, remaining allowance, `allowanceAt` (→ `AllowanceView`), and `decodeDelegation` for the v1 account layout (01 §8.3).
3. `src/testing/`: `testKeyAddress(name)`, the documented test-key derivation (ed25519 seed = sha256("leash:test-key:" + name)).
4. Tests: all 60 policy vectors (outcomes and effects), allowance and decoding unit tests, and property tests for the invariants the evaluator must never break (I1–I3). 100% branch coverage on the evaluator and allowance code.

## Done

- **Build step 2, complete (2026-09-29).** `packages/sdk`:
  - `src/evaluate/`: `evaluatePayment(input)` and `rollWindow`, a line-by-line mirror of 01 §7.1–§7.3 and the three `20260929-ws0-*` ADRs. Allowed results carry the counters the program would write (velocity window, payee period, delegation period or remaining amount, whether a request is consumed).
  - `src/allowance.ts`: `isAllowanceExpired`, `rollRecurringPeriod`, `allowanceRemaining`, `decodeDelegation` (v1 layouts only; anything else throws `LeashSdkError` `UNSUPPORTED_DELEGATION`), `allowanceAt` (→ contracts `AllowanceView`). Checked line by line against upstream `transfer_validation.rs`, including `saturating_sub` and the i64 period conversion.
  - `src/testing/`: `testKeySeed`, `testKeyAddress`.
  - 100 tests: all 60 policy vectors (outcomes and effects), allowance and decoding units, overflow and malformed-input cases, and fast-check properties for I1, I2, I3, strike marking and purity. Coverage 100% (statements, branches, functions, lines), enforced in `vitest.config.ts`.
  - README with usage, guarantees and the edge-case table.
- API refinements against the brief's target shape: `decodeDelegation(address, data)` returns `DecodedDelegation` (the brief said `decodeDelegation(data): DelegationData`), and `evaluatePayment` also returns the effects of an allowed payment and the strike flag of a denial.
- Messages sent: `20260929-1815-from-ws2-to-ws1-parity-edge-cases.md`, `20260929-1815-from-ws2-to-all-evaluator-ready.md`.

## Next

- Build step 1 (Codama client, PDAs, codecs, error mapping) when WS1 announces the IDL. Then step 3 (read path).

## Open items

- The spec leaves four arithmetic edge cases open (see the README table). The SDK picked a behaviour for each; WS1 was asked to match or answer. If WS1 picks differently, the SDK follows the program and WS0 adds vectors.
- `PaymentEffects` leaves out the payee and agent totals (`total_paid`, `payments_count`, `last_payment_at`): the vectors do not pin them and they are plain sums. Add them if a consumer needs them.

## Questions for other workstreams

- None.

## Contract changes proposed

- None.
