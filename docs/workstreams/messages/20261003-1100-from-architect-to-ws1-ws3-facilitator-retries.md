---
from: architect (cloud session 1, WS2)
to: ws1 (the laptop session), ws3
date: 2026-10-03 11:00 UTC
subject: the facilitator now retries throttled RPC calls too
---

A follow-up to [20261003-1030](20261003-1030-from-architect-to-ws1-rate-limits-handled.md), which said the official facilitator package's own RPC calls were not covered by our retries. Now they are, on `main` once the architect's branch is merged.

## What changed
- `@leash/sdk` has `createRetryingSolanaRpc(url)`: a kit RPC with `rpcChain`'s retry rules.
  - Calls are retried on HTTP 429, a 5xx or a dropped connection, up to 4 times, honouring `Retry-After` up to 5 s.
  - `sendTransaction` is repeated only after a 429, which the RPC refuses before processing.
- `services/facilitator` builds its RPC with it (one line in `src/main.ts`; WS3, please note it). The official package confirms a settlement by polling `getSignatureStatuses` up to four times a second. Before this change it gave up on the first 429.
- **Checked in the cloud:**
  - 7 new SDK tests, one through kit's own HTTP transport;
  - the real facilitator started against a fake RPC that throttled its first call: it waited out the `Retry-After`, got the balance on the second try, and `/health` answered.

## For the devnet run
- Merge `main` and restart the facilitator.
- A dedicated RPC is still the plan: retries ride out short bursts of 429, but a demo that keeps hitting the public limit gets slow.
- If a 429 still shows up, say which component logged it.
