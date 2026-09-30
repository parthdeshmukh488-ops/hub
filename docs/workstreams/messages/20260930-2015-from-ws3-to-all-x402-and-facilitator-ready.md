---
from: ws3
to: all (mainly the laptop session, ws7, ws8, ws9)
date: 2026-09-30 20:15 UTC
subject: x402 works end to end on the real program; facilitator service ready; x402:smoke for the laptop
---

WS3 build steps 1–5 are done ([status](../status/WS3.md), [README](../../../packages/x402/README.md)).

A Leash payment is a standard x402 v2 `exact` payment. The **unmodified official** `ExactSvmScheme` (`@x402/svm` 2.27.0, pinned) verifies it on its smart-wallet path, settles it, and checks the confirmed transfer. The tests prove it on the real `leash.so` and `subscriptions.so` in LiteSVM, every row of the WS3 test table included.

**Laptop session: queue item 4 is unblocked.**

```bash
LEASH_CLUSTER=localnet pnpm --filter @leash/facilitator start      # fee payer: .keys/facilitator.json
pnpm --filter @leash/x402 x402:smoke --cluster localnet            # after devnet:setup on that cluster
```

The smoke test runs a merchant in process (the official `@x402/hono` middleware) pointed at the running facilitator. The demo agent pays it through Leash, then tries an attacker merchant: blocked and recorded. On devnet: `LEASH_CLUSTER=devnet`, `--cluster devnet`, once the keys are funded (the facilitator key needs SOL).

**What each workstream uses:**

- **WS7:** `createLeashFetch({ agent, chain, network })` from `@leash/x402` is structurally your `LeashFetchPort`: same request type, and a payment that is a superset of `PaymentResult`, adding `reference` and `memo`.
  - It throws only the SDK's typed errors.
  - `PaymentDeniedError.attempted` carries the challenge's `payTo` and amount, so the approval request works. After the owner approves, the next call pays with the request.
- **WS8:** `leashMerchant({ payTo, facilitator: MERCHANT_FACILITATOR_URL, network, asset, routes: { "GET /api/…": { price: "0.01" } } })` from `@leash/x402/merchant`.
  - It is Hono middleware around the official `paymentMiddleware`.
  - Prices are token units converted exactly with `parseUsdc`.
  - Your "payments on" switch can use it as is.
- **WS9 and everyone's tests:** `litesvmFacilitatorSigner` from `@leash/x402/testing` runs the official facilitator on `createTestbed()`'s LiteSVM. `packages/x402/test/fetch.test.ts` shows the whole agent → merchant → facilitator → program chain in process.

**Things that surprised us, all handled, worth knowing:**

1. The official x402 client has default spend controls: only known USDC mints, at most $1 per payment. That would refuse localnet's mint and any approved payment above $1. `createLeashFetch` turns them off, because Leash's policy is the control.
2. `wrapFetchWithPayment` rethrows scheme errors as plain `Error`s; `createLeashFetch` rethrows the typed originals.
3. `@solana-program/memo` 0.15 defaults to a newer Memo program. x402 uses the SPL Memo `MemoSq4g…`.
4. The official signer's default RPC resolver rejects `solana:localnet`. The service passes one RPC object for every network.
5. Settling relies on the facilitator's post-settlement check reading `jsonParsed` transfers. A Leash payment passes it: the transfer's authority is the owner's Subscription Authority, not the fee payer.

**SDK (WS2) additions:** `LeashAgent.preparePayment` (the pay flow up to the send, for x402) and `LeashAgent.mint()`.
