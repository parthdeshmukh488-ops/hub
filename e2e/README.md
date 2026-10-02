# @leash/e2e

The whole pitch storyline through the whole system, in one test, in process on LiteSVM, with no network. If it passes, the pieces that the demo puts on stage work together on the real program.

Owned by **WS9**. Brief: [docs/workstreams/WS9-integration-story.md](../docs/workstreams/WS9-integration-story.md). Status: [docs/workstreams/status/WS9.md](../docs/workstreams/status/WS9.md).

## What runs

```text
demo agent (scripted scenes, apps/agent-demo)
  → its tools (@leash/tools/node)
  → merchant-demo with x402 payments on (apps/merchant-demo, lab included)
  → the official x402 facilitator (@leash/x402/testing)
  → the Leash program and Subscriptions: the committed .so files (@leash/sdk/testing)
  → the indexer in chain mode over the same chain (@leash/indexer/testing)
  → Sentinel, live on the indexer's REST API and stream (@leash/sentinel)
```

The test is the owner: it approves the agent's request once Sentinel has alerted about it, as Parth would from the phone.

## What it proves, scene by scene

| Scene | On-chain | Indexer API | Sentinel |
| --- | --- | --- | --- |
| Start | – | the owner overview: principal with the testbed's guardian, one active agent | watching the owner, nothing to report |
| 1. Normal work | the merchant received exactly the five research payments | five `PaymentExecuted`; the agent's stats agree | no alert |
| 2. Approval | the merchant received the requested amount, once | `PaymentRequested`, `RequestApproved` for that request, one `PaymentExecuted` carrying its nonce | `approval_requested` (before the owner approved) |
| 3. Injection | the attacker received nothing; the merchant nothing more (1.57 USDC in total) | three `PaymentDenied` to the attacker with strikes 1, 2, 3, the third `tripped`; then `AgentFrozen` (reason `tripwire`) in the same transaction; the overview shows the agent frozen by the tripwire | `tripwire_fired`, naming the three strikes. No `burst_denials`: one agent, already frozen. |

## Run it

```bash
pnpm --filter @leash/e2e test        # about 5 seconds
```

No validator, no RPC and no keys are needed. The suite uses the committed `artifacts/programs/*.so` and deterministic test keys.

## One bridge between test utilities

- **The gap:**
  - The x402 facilitator's LiteSVM signer (`@leash/x402/testing`) sends its settlements straight to LiteSVM.
  - The testbed chain (`@leash/sdk/testing`) lists only the transactions sent through it.
  - On a real cluster both reach the same node; here the indexer would never see an x402 payment.
- **The bridge:** [`test/facilitator-svm.ts`](test/facilitator-svm.ts) gives the facilitator a LiteSVM that runs each transaction once, then records the same result in the testbed chain's history.
- **Check that nothing ran twice:** the merchant's final balance is exactly the 1.57 USDC that `apps/agent-demo`'s test also asserts.

## Imports

- `@leash/agent-demo/demo`, `/scenes`, `/ui`: exports added to `apps/agent-demo/package.json` for this suite.
- `@leash/indexer/testing`, `@leash/sentinel`, `@leash/merchant-demo/server` and `/content`, `@leash/tools/node`, `@leash/x402/testing`, `@leash/sdk/testing`: their packages' public exports.
