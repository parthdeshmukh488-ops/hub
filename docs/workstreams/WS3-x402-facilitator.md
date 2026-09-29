# WS3: x402 layer and facilitator (`@leash/x402`, `services/facilitator`)

## Mission

Make Leash payments ordinary x402 payments. An agent using Leash can pay an x402 merchant, and the merchant's facilitator verifies and settles it with the **official** x402 code, configured to trust Leash. No custom verification logic ([ADR-0003](../adr/0003-x402-via-official-facilitator.md)).

## Read first

[02-contracts §9](../architecture/02-contracts.md#9-x402-profile-how-leash-payments-travel-over-x402-v2) (the x402 profile) · [00-overview §5.2](../architecture/00-overview.md#52-paying-an-x402-merchant-happy-path) · [01-onchain-program §6.2](../architecture/01-onchain-program.md#62-agent-instructions) · [03-security](../architecture/03-security.md) (T8, T9) · [ADR-0003](../adr/0003-x402-via-official-facilitator.md) · the x402 SVM exact-scheme spec: github.com/x402-foundation/x402 `specs/schemes/exact/scheme_exact_svm.md` · the type definitions of `@x402/core`, `@x402/svm`, `@x402/hono`, `@x402/fetch` (2.27.x)

## You own

`packages/x402/`, `services/facilitator/`

## You consume and provide

| Consumes | Provides |
| --- | --- |
| `@leash/sdk` (`LeashAgent.buildPayInstruction`, `simulatePay`, `reportDenied`), `@leash/contracts` (x402 constants, networks), `@x402/*` | `@leash/x402`: a Leash payment client for x402, `leashFetch`, merchant helpers, facilitator factory. `services/facilitator`: a running x402 v2 facilitator. |

## Design notes

**Client side (`packages/x402/src/client/`):**

- Implement the x402 v2 client **scheme** interface for `exact` on `solana:*` (see the `@x402/svm/exact/client` types) with a Leash implementation. Given `PaymentRequirements`, it:
  1. validates them (scheme, network, asset equal to the agent's mint, `extra.feePayer` present), otherwise `UNSUPPORTED_PAYMENT`;
  2. derives `memoString` and `reference` (02 §3);
  3. asks the SDK to simulate. On a denial the SDK reports it and throws `PaymentDeniedError`, which you surface unchanged;
  4. builds the v0 transaction `[SetComputeUnitLimit, SetComputeUnitPrice, leash::pay, Memo]` with fee payer = `extra.feePayer`, signed by the agent key only;
  5. returns the payment payload for `PAYMENT-SIGNATURE`.
- Register it with the official client (`@x402/fetch` or the `@x402/core` client) so that `leashFetch(url, init, { agent, purpose })` is simply the official fetch wrapper plus our scheme.
- If an approved `PaymentRequest` matches `(payTo, amount)`, pass it to `buildPayInstruction` (consumes the approval).
- Decode `PAYMENT-RESPONSE` and return a `PaymentReceipt` (02 §8).

**Facilitator (`services/facilitator`):**

- A Hono service exposing the x402 v2 facilitator endpoints (`POST /verify`, `POST /settle`, `GET /supported`) through the `@x402/core` facilitator utilities, plus `GET /health`.
- One `ExactSvmScheme` instance configured exactly as in 02 §9: smart-wallet verification on, the allowlist = the package defaults + `LEASH_PROGRAM_ID`, compute and priority-fee caps.
- The fee payer comes from `FACILITATOR_FEE_PAYER_KEYPAIR`. Log a warning when its SOL balance is low.
- Per-IP rate limiting on `/verify` and `/settle`. Structured logs for every verification result, including `verificationPath` (static or smartWallet) and `invalidReason`.

**Merchant helper (`packages/x402/src/merchant/`):** a small wrapper around `@x402/hono`'s payment middleware: `leashMerchant({ payTo, facilitatorUrl, network, asset, routes: { "GET /api/research": { price: "0.01" } } })`. WS8 uses it.

## Tests

| Test | Proves |
| --- | --- |
| Standard payment (plain `TransferChecked`) verifies and settles | The facilitator still works for normal wallets (Path 1) |
| Leash payment verifies and settles | Path 2 with Leash on the allowlist |
| Same Leash payment against a facilitator **without** Leash on the allowlist is rejected with `smart_wallet_program_not_allowed…` | Acceptance depends only on the allowlist configuration |
| A Leash payment whose simulation would be denied fails verification | Fail closed |
| Fee payer placed in an instruction's accounts is rejected | Fee-payer isolation |
| Settling the same payload twice pays once | Replay safety |
| `leashFetch` end-to-end against a Hono app with the merchant helper (localnet or LiteSVM-backed RPC) | Full client path |

To test the official facilitator without a network, implement its signer/RPC interface over LiteSVM (`simulateTransaction` with inner instructions, `sendTransaction`, status). If that proves too costly, run these tests against localnet and record the decision in an ADR.

## Build order (quality gates)

1. **Facilitator for standard payments.** Service skeleton, env, health, official scheme, Path 1 tests.
2. **Leash client scheme.** Payment builder on top of the SDK; unit tests of requirement validation, memo and reference derivation, transaction shape.
3. **Path 2 with Leash.** Allowlist configuration; the verify/settle tests of the table above.
4. **`leashFetch` and merchant helper.** End-to-end against a test Hono app.
5. **Hardening.** Rate limits, error mapping to tool error codes (`MERCHANT_REJECTED`, `UNSUPPORTED_PAYMENT`, `NETWORK_ERROR`), low-balance warning, README with a sequence diagram.

## Definition of done (in addition to the general one)

- Every row of the test table passes.
- `@x402/*` versions are pinned, with a comment explaining that Path 2 behaviour is load-bearing.
- The README shows the exact configuration change (two options) another facilitator operator needs to accept Leash.

## Pitfalls

- Use the official encodings and header names (`PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`). Never hand-roll them.
- The Memo instruction must have no signer accounts.
- The x402 amount is a string in token base units. Convert with `@leash/contracts` helpers, never floats.

## Starter prompt

```text
You are the WS3 (x402 layer and facilitator) engineer on Leash, a spending firewall for AI agents on Solana.

Before anything else:
1. Merge the latest main into your branch.
2. Read CLAUDE.md, docs/architecture/00-overview.md, docs/workstreams/WS3-x402-facilitator.md and every document its "Read first" section lists. Inspect the installed type definitions of @x402/core, @x402/svm, @x402/hono and @x402/fetch before designing anything.
3. Read docs/workstreams/status/WS3.md (create it from docs/workstreams/status/README.md if missing) and any ADRs newer than it. Then read docs/workstreams/BOARD.md and every file in docs/workstreams/messages/ addressed to ws3 or to all.

Then tell me in a short message: what you understand your job to be, which build step you will do now, your plan for it (including which official x402 interfaces you will implement or configure), and anything in the spec that looks wrong or underspecified. Wait for my OK before writing code.

Rules: only edit packages/x402, services/facilitator and your status file; follow docs/architecture/04-conventions.md; contract changes go through an ADR; end every work block by updating your status file, committing and pushing.
```
