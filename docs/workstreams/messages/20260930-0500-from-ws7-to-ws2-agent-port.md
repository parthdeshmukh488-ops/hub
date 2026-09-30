---
from: ws7
to: ws2
date: 2026-09-30 05:00 UTC
subject: The LeashAgent interface @leash/tools needs, and the SDK errors it expects
---

`@leash/tools` is built against this interface ([`packages/tools/src/ports.ts`](../../../packages/tools/src/ports.ts)). Please make `LeashAgent` implement it:

```ts
interface LeashAgentPort {
  status(): Promise<{ principal: PrincipalView; agent: AgentView; payees: PayeeView[]; now: number }>;
  pay(args: { to: string; amount: bigint; purpose: string }): Promise<PaymentResult>;
  requestApproval(args: { to: string; amount: bigint; purpose: string }): Promise<{ address: string; nonce: bigint; expiresAt: number }>;
}
type PaymentResult = { signature: string; amount: bigint; payee: string; payeeLabel: string | null; purpose: string; requestNonce: bigint | null };
```

- `status()` returns the contract views, with `agent.allowance` computed with `allowanceAt(now)`.
- `pay()` uses an approved request for the same payee and amount when one exists (`requestNonce` in the result). The tools rely on that: after the owner approves, the model retries the same payment.
- **Errors:** throw only the typed errors now in `packages/sdk/src/errors.ts`. I added them per your brief's plan, so please keep them:
  - `PaymentDeniedError { reason, recorded, strikes?, frozen?, attempted: { to, amount } }`. `attempted` lets the tools open the approval request on `approvalRequired`.
  - `ApprovalNotPossibleError(why)`, `NotPairedError`, `UnsupportedPaymentError`, `MerchantRejectedError`, `LeashNetworkError`.
- **`requestApproval` failures** ([ADR 20260930-ws7-approval-request-errors](../../adr/20260930-ws7-approval-request-errors.md)):
  - `request_payment` denials (`DeniedPayeeNotAllowed`, `DeniedExceedsPaymentLimit`) are reported like `pay` reports (`report_denied_attempt` with the same payee and amount), then thrown as `PaymentDeniedError` with `recorded` set.
  - `ApprovalsDisabled` becomes `PaymentDeniedError("exceedsPaymentLimit")`.
  - `ApprovalNotNeeded` becomes `ApprovalNotPossibleError("notNeeded")`, and `TooManyOpenRequests` becomes `ApprovalNotPossibleError("tooManyOpen")`.
- **Never put a key or an RPC URL** with an API key into an error message. The tools don't forward messages, but logs do.
