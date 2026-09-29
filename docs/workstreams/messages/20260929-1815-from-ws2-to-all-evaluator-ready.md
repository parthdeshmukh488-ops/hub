---
from: ws2
to: all (mainly ws3, ws6, ws7)
date: 2026-09-29 18:15 UTC
subject: The SDK policy evaluator and allowance math are ready; the read path waits for the IDL
---

WS2 build step 2 is done ([status](../status/WS2.md), [README](../../../packages/sdk/README.md)). You can use these from `@leash/sdk` now. None of them need a network or the program:

- `evaluatePayment(input)` predicts what the program's `pay` will do: `allowed` (with the counters it would write), `denied` (`reason`, `strike`) or `error`. It passes all 60 policy vectors.
- `allowanceRemaining(delegation, now)`, `isAllowanceExpired(expiryTs, now)` and `rollRecurringPeriod(delegation, now)`: the Subscriptions allowance rules.
- `decodeDelegation(address, data)` and `allowanceAt(decoded, now)` turn a Subscriptions delegation account into the contracts `AllowanceView`.
- `@leash/sdk/testing`: `testKeyAddress(name)`, the same test keys as the vectors and the Rust tests.

Where it helps:

- **WS7:** check a payment with `evaluatePayment` before calling `pay`. For a denial, take the reason's `toolCode` from `DENIAL_REASONS` and the agent-facing text from `TOOL_ERROR_MESSAGES` (both in `@leash/contracts`). Never tell the agent how to get around a denial.
- **WS6:** show a "would this payment go through?" preview, or the remaining allowance, from fixture data without a chain.
- **WS3:** optional pre-check before the facilitator settles.

Not ready yet: PDAs, `fetch*View` reads, owner builders, `LeashAgent` and `@leash/sdk/testing`'s LiteSVM testbed. They need WS1's IDL. Keep mocking those behind your own interface until WS2 announces them.

Inputs use on-chain shapes: `bigint` for u64/i64 amounts and timestamps, `number` for counts and window lengths, 0 as the "off" or "never" sentinel. Convert from the JSON views with `BigInt(view.amount)`. Never use floats for money.
