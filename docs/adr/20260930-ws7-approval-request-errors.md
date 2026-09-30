# Tool messages stay true: two codes for failed approval requests, and "recorded" only when it is

- Status: Proposed (additive, contracts 1.2.0)
- Date: 2026-09-30
- Workstream: WS7
- Contract change: yes (affected: WS2, WS3, WS7)

## Context

The model reads the tool messages of 02 §8 verbatim, so every message must be true. Building `@leash/tools` showed three places where they could not be:

1. `leash_request_approval` calls `request_payment`, which can fail with `ApprovalNotNeeded` (the amount is within the instant limit) or `TooManyOpenRequests` (8 requests already open). No tool error code describes either. The closest ones would state something false: `APPROVAL_REQUIRED` says "a request was sent", `INVALID_INPUT` says the input is malformed.
2. `APPROVAL_REQUIRED` says "A request was sent to the owner", but only `leash_fetch` created one. A direct `leash_pay` above the instant limit would claim a request that does not exist.
3. Three strike messages say "The attempt was recorded and the owner was notified". That is false when the `report_denied_attempt` transaction itself fails, which the `recorded: false` field already signals.

## Decision

1. Add the tool error codes `APPROVAL_NOT_NEEDED` and `TOO_MANY_OPEN_REQUESTS`, with messages that say no request was sent. `CONTRACTS_VERSION` becomes 1.2.0.
2. `leash_pay` creates a payment request on `approvalRequired`, exactly as `leash_fetch` does, so the `APPROVAL_REQUIRED` message is true for both.
3. Export the recorded sentence as `TOOL_MESSAGE_RECORDED`. When `recorded` is false, the tools remove it from the message.
4. The SDK side, for WS2:
   - `requestApproval` reports a denied request like `pay` does (the same payee and amount through `report_denied_attempt`), so its `payeeNotAllowed` and `exceedsPaymentLimit` denials are on-chain.
   - `ApprovalsDisabled` surfaces as `exceedsPaymentLimit`, which is what `pay` would report for the same amount.
   - `ApprovalNotNeeded` and `TooManyOpenRequests` surface as `ApprovalNotPossibleError`.

## Consequences

- Every message the model sees is true, whether a tool's call succeeds, fails or is only partly recorded.
- Consumers that switch exhaustively over `ToolErrorCode` must handle two more codes (compile-time error, not a silent change).

## Alternatives considered

- **Map the two request failures onto existing codes:** every candidate message states something false.
- **Keep the `recorded` sentence static:** simpler, but a failed report would make the model and the owner believe an attempt is on-chain when it is not.
