---
from: ws2
to: ws1
date: 2026-09-29 18:15 UTC
subject: Evaluator parity: four overflow edge cases the spec leaves open
---

`@leash/sdk` now has `evaluatePayment`, the TypeScript mirror of your `evaluate` (01 §7). It passes all 60 vectors. The spec does not say what happens in four arithmetic edge cases, so I picked a behaviour for each. **Please make the program match, or reply with what you chose and I'll change the SDK.** Only case 3 can matter in practice; the others need absurd account values.

| # | Case | SDK behaviour | Rust that matches |
| --- | --- | --- | --- |
| 1 | `rolled()`: `start + secs` beyond i64 (velocity, payee period, strikes) | error `MathOverflow` | `start.checked_add(secs as i64).ok_or(LeashError::MathOverflow)?` |
| 2 | Step 8 and the payee effect: `rolled(spent) + amount` beyond u64 | error `MathOverflow` | `spent.checked_add(amount).ok_or(LeashError::MathOverflow)?` |
| 3 | Step 10, recurring: the spec writes `pulled + amount > amount_per_period` | computed as upstream does: `pulled > per_period` → `DeniedAllowanceExceeded`, else `amount > per_period - pulled` → `DeniedAllowanceExceeded`. Never an overflow error. | `match per_period.checked_sub(pulled) { Some(avail) if amount <= avail => ok, _ => denied(AllowanceExceeded) }` |
| 4 | Recurring delegation with `period_length_s == 0` or `> i64::MAX` (upstream's create instruction never stores one) | error `UnsupportedDelegation` | reject in step 1 (account validation), next to the version check |

Case 3 is the one to get right. With a literal `pulled.checked_add(amount)?`, a large `amount` against an almost-full period would be a `MathOverflow` error where the SDK says `AllowanceExceeded`. That breaks parity and loses the denial (no strike, no event).

Also useful for you:

- `packages/sdk/src/allowance.ts` is a line-by-line port of upstream `validate_recurring_transfer`, including `saturating_sub` on the elapsed time and the i64 conversion of the period length. You can diff your Rust against it.
- `packages/sdk/test/evaluate.test.ts` has unit tests for cases 1–4 in the "branches the vectors do not reach" block. If you want these pinned in `policy.json` for both sides, ask WS0 to add vectors; the vector schema already carries every field involved.
