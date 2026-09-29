# WS2: TypeScript SDK (`@leash/sdk`)

## Mission

Be the one correct way for TypeScript to talk to Leash. The web app, indexer, Sentinel, x402 layer, tools, MCP server and demo agent all go through this package. It must be small, typed, well documented, and its policy evaluator must agree with the program on every test vector.

## Read first

[01-onchain-program](../architecture/01-onchain-program.md) · [02-contracts](../architecture/02-contracts.md) (§2, §3, §5, §6, §8, §9) · [00-overview §5](../architecture/00-overview.md#5-key-flows) · [04-conventions](../architecture/04-conventions.md) · [ADR-0001](../adr/0001-build-on-subscriptions-program.md) · [ADR-0002](../adr/0002-strict-pay-and-reported-denials.md) · [ADR-0005](../adr/0005-kit-and-codama-clients.md) · the `@solana/subscriptions` package (types and instruction builders)

## You own

`packages/sdk/`

## You consume and provide

| Consumes | Provides |
| --- | --- |
| `packages/contracts/idl/leash.json` (WS1), `@leash/contracts`, `@solana/kit`, `@solana/subscriptions`, `@solana-program/{token,memo,compute-budget}` | The public API below, plus `@leash/sdk/testing`: a LiteSVM harness other workstreams use in their tests |

## Public API (target shape; refine it in your plan)

```ts
// pda.ts
findPrincipalPda(owner), findAgentPda(principal, agentKey), findPayeePda(agent, payee),
findRequestPda(agent, nonce), findSubscriptionAuthorityPda(owner, mint),
findDelegationPda(subscriptionAuthority, owner, delegatee, nonce)

// read.ts: fetch + decode into contract views
fetchPrincipalView(rpc, owner): Promise<PrincipalView | null>
fetchAgentView(rpc, agent, { now? }): Promise<AgentView | null>   // includes AllowanceView
fetchPayees(rpc, agent), fetchOpenRequests(rpc, agent)

// allowance.ts: Subscriptions delegation decoding + "remaining at time t" (mirrors 01 §7.3)
decodeDelegation(data): DelegationData;  allowanceAt(delegation, now): AllowanceView

// evaluate.ts: pure mirror of the program (01 §7)
evaluatePayment(input): { outcome: "allowed" } | { outcome: "denied"; reason } | { outcome: "error"; error }

// owner.ts: transaction message builders for wallets (the owner signs)
buildOnboarding({ owner, agentKey, label, policy, allowance, payees }): TransactionMessage[]
buildUpdatePolicy, buildAddPayee, buildUpdatePayee, buildRemovePayee,
buildFreezeAgent, buildUnfreezeAgent, buildFreezePrincipal, buildUnfreezePrincipal,
buildApproveRequest, buildRejectRequest, buildSetGuardian, buildRevokeAllowance, buildCloseAgent

// agent.ts: used by the agent runtime (the agent key signs)
class LeashAgent {
  constructor(opts: { rpc; rpcSubscriptions; signer; owner; cluster; mint? })
  status(): Promise<AgentStatusSnapshot>
  pay({ to, amount, purpose, reference? }): Promise<PaymentReceipt>          // throws PaymentDeniedError
  requestApproval({ to, amount, purpose }): Promise<RequestView>
  buildPayInstruction({ to, amount, purpose, reference, request? }): Promise<Instruction>  // for x402
  simulatePay(...): Promise<EvaluationResult>
  reportDenied(...): Promise<ReportResult>
}

// events.ts
decodeLeashEvents(tx): LeashEvent[]

// errors.ts
class LeashSdkError { code }  ·  class PaymentDeniedError extends LeashSdkError { reason; recorded; strikes; frozen }
mapProgramError(err): LeashSdkError
```

## Design notes

- **Generated client:** Codama from the IDL into `src/generated/` (`pnpm --filter @leash/sdk generate`). Everything hand-written wraps it. Never edit generated files.
- **Evaluator parity is the heart of this package.** `evaluatePayment` is a line-by-line mirror of 01 §7, including the recurring-allowance roll-forward. The test suite runs every case of `test-vectors/policy.json`; 100% branch coverage.
- **The pay flow (ADR-0002):** `pay()` → read the accounts → `evaluatePayment` locally → build and **simulate** the transaction → if the simulation fails with a denial, send `report_denied_attempt` according to the reporting policy ([ADR](../adr/20260929-ws0-denial-reporting-policy.md): strikes always, `approvalRequired` never, other reasons at most once per reason per minute) and throw `PaymentDeniedError { recorded, strikes, frozen }` → otherwise send and confirm, then return the receipt with its explorer URL. If local evaluation and simulation disagree, trust the simulation and log the mismatch loudly: it means a parity bug.
- **Serialize per agent.** Payments from one `LeashAgent` go through an in-process queue, so windows and allowance aren't raced by our own concurrency.
- **Idempotency:** before sending, check whether a confirmed `PaymentExecuted` with the same `reference` exists for this agent (recent signatures). If so, return that receipt instead of paying twice.
- **Onboarding composition:** use `@solana/subscriptions` for `InitSubscriptionAuthority` and `CreateRecurringDelegation` (delegatee = Agent PDA, nonce 0 for the first allowance). Where possible, put SA initialization and delegation creation in the same transaction (`UNKNOWN_INIT_ID`). Split transactions by size and return them in order.
- **Compute budget:** simulate with a limit of 400k, then set `ceil(consumed × 1.15)`; priority fee from the config.
- **Event decoding:** Anchor `emit_cpi!` events are inner instructions to the Leash program whose data starts with the 8-byte event-CPI tag, then the 8-byte event discriminator, then Borsh. Decode with Kit codecs driven by the IDL and map to the `LeashEvent` JSON of 02 §6.
- **`@leash/sdk/testing`:** `createTestbed()` → a LiteSVM instance with both programs, a mint, a funded owner, an initialized principal, an agent with a recurring allowance and an allowlisted merchant, plus helpers to advance the clock. Other workstreams' tests depend on it, so keep it stable and documented.

## Build order (quality gates)

1. **Generated client and primitives:** Codama generation from the interface-complete IDL, PDAs, label/memo/reference codecs, error mapping (denial codes 6000–6011 → `DenialReason`).
2. **Evaluator and allowance math** with 100% test-vector parity. (You can do this before the program exists.)
3. **Read path:** `fetch*View` functions and `allowanceAt`, tested against decoded fixture accounts.
4. **Owner builders:** onboarding composition and all admin builders, tested in LiteSVM.
5. **Agent path:** `LeashAgent` pay, simulate, report, request, the queue and idempotency, tested in LiteSVM. Ship `@leash/sdk/testing`.
6. **Events:** `decodeLeashEvents` for every event type, cross-checked with the fixtures' JSON shapes.
7. **Docs:** a README with runnable examples for owner and agent usage. Ask WS3, WS6 and WS7 (through Parth) for API feedback, then freeze the API as 1.0.

## Definition of done (in addition to the general one)

- Parity: every test vector passes against `evaluatePayment`.
- No consumer ever needs to import `src/generated/` directly.
- Every public function has TSDoc and appears in a README example.

## Pitfalls

- Amounts are `bigint` everywhere; the tool layer (WS7) converts from `amountUsdc` strings with `@leash/contracts` helpers.
- A successful simulation is not a successful payment: confirm the transaction and read `PaymentExecuted` before returning a receipt.
- Keep web3.js v1 out (ADR-0005).

## Starter prompt

```text
You are the WS2 (TypeScript SDK) engineer on Leash, a spending firewall for AI agents on Solana.

Before anything else:
1. Merge the latest main into your branch.
2. Read CLAUDE.md, docs/architecture/00-overview.md, docs/workstreams/WS2-sdk.md and every document its "Read first" section lists.
3. Read docs/workstreams/status/WS2.md (create it from docs/workstreams/status/README.md if missing) and any ADRs newer than it. Check whether packages/contracts/idl/leash.json exists yet.

Then tell me in a short message: what you understand your job to be, which build step you will do now, your plan for it (including the exact public API you propose), and anything in the spec that looks wrong or underspecified. Wait for my OK before writing code.

Rules: only edit packages/sdk and your status file; follow docs/architecture/04-conventions.md; contract changes go through an ADR; end every work block by updating your status file, committing and pushing.
```
