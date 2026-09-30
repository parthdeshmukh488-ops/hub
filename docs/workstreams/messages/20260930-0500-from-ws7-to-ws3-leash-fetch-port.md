---
from: ws7
to: ws3
date: 2026-09-30 05:00 UTC
subject: The leashFetch interface @leash/tools needs
---

`leash_fetch` calls this function ([`packages/tools/src/ports.ts`](../../../packages/tools/src/ports.ts)). Please make `@leash/x402`'s `leashFetch` match it, or give me an adapter:

```ts
type LeashFetchPort = (request: {
  url: string; method: "GET" | "POST"; headers: Record<string, string>; body: string | undefined;
  purpose: string;              // the memo, already cut to 64 bytes
}) => Promise<{ status: number; contentType: string; body: string; payment: PaymentResult | null }>;
```

- A free response returns `payment: null`. A paid one returns the `PaymentResult` of the settled payment, the same type as `LeashAgent.pay`.
- **Throw only the SDK's typed errors** (`packages/sdk/src/errors.ts`):
  - a policy denial: `PaymentDeniedError` with `attempted` = the challenge's `payTo` and amount, which the tools need to open an approval request on `approvalRequired`
  - a challenge we can't pay (network, asset, scheme): `UnsupportedPaymentError`
  - a facilitator or merchant refusal after a valid payment: `MerchantRejectedError`
  - anything unreachable before money moved: `LeashNetworkError`
- After the owner approves a request, a second call to the same URL must pay with the approved request (02 §8). The model is told exactly that.
