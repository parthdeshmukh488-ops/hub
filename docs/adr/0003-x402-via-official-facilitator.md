# x402 compatibility through the official facilitator, with Leash on its smart-wallet allowlist

- Status: Accepted
- Date: 2026-09-29
- Workstream: architecture
- Contract change: n/a (founding decision)

## Context

- The x402 exact scheme for SVM (spec `specs/schemes/exact/scheme_exact_svm.md` in x402-foundation/x402) has two verification paths:
  - **Path 1 (static):** `[SetComputeUnitLimit, SetComputeUnitPrice, TransferChecked, optional Memo/Lighthouse]`.
  - **Path 2 (simulation):** for smart wallets, whose transfer is a CPI. The facilitator simulates with inner instructions and requires exactly one matching `TransferChecked`. The fee payer may not appear in any instruction. A program allowlist is recommended.
- The official TypeScript implementation `@x402/svm` 2.27 (`ExactSvmScheme`) supports this directly: `enableSmartWalletVerification` and a configurable `smartWalletAllowedPrograms`. When it checks the allowlist it skips ComputeBudget and Memo instructions, so only the top-level Leash instruction must be listed. The default list: Squads v4, Squads Smart Account, Swig, Swig v2, SPL Governance, Metaplex Core, Lighthouse.
- A Leash payment is `leash::pay` → Subscriptions `TransferRecurring` → Token `TransferChecked`: exactly one matching inner `TransferChecked`.

## Decision

1. Leash payments are **standard x402 v2 exact-scheme payments** using the transaction shape in [02 §9](../architecture/02-contracts.md#9-x402-profile-how-leash-payments-travel-over-x402-v2).
2. `services/facilitator` is a thin service around the **official** `ExactSvmScheme`, with smart-wallet verification on and `smartWalletAllowedPrograms = [...defaults, LEASH_PROGRAM_ID]`. We write **no** custom verification logic.
3. The agent side uses the official client packages (`@x402/fetch` or `@x402/core` client). The Leash-specific part is a payment builder that produces the Leash transaction instead of a plain `TransferChecked`.
4. The merchant demo uses the official `@x402/hono` middleware pointed at our facilitator.

## Consequences

- Pitch: "Any facilitator running the official x402 package accepts Leash payments with a small configuration change: smart-wallet verification on, Leash on the allowlist." The ecosystem path is getting Leash added to the default smart-wallet allowlist, the way Squads and Swig are.
- Until then, merchants must use a facilitator that lists Leash (ours, or any operator who adds it).
- Our correctness depends on upstream behaviour. WS3 pins `@x402/*` versions and keeps an integration test that fails if a new release changes Path 2.

## Alternatives considered

1. **Our own facilitator verification logic.** More code, more risk, and less credible than the official implementation.
2. **Client-settled payments** (the agent submits, then sends the signature as proof). Not x402-standard; replay-prone.
3. **A "hot wallet" refilled by an allowance**, paying with plain `TransferChecked` (Path 1, universally accepted). Rejected: it moves funds into a wallet the agent key controls and loses on-chain allowlist enforcement for the payment itself.
