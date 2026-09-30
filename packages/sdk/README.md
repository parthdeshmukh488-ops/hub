# @leash/sdk

The one TypeScript way to talk to Leash. The web app, indexer, Sentinel, x402 layer, tools, MCP server and demo agent all go through this package.

Owned by **WS2**. Brief: [docs/workstreams/WS2-sdk.md](../../docs/workstreams/WS2-sdk.md). Status: [docs/workstreams/status/WS2.md](../../docs/workstreams/status/WS2.md).

## What exists today (build steps 1–6)

| Module | What it does |
| --- | --- |
| `evaluatePayment` | Predicts what the Leash program's `pay` will do with a payment ([01-onchain-program §7](../../docs/architecture/01-onchain-program.md#7-evaluation)): allowed (with the counters it would write), denied (with the reason and whether it is a strike), or an error. Pure, no network. |
| `allowance` | The Subscriptions allowance rules: inclusive expiry, the recurring period roll-forward with its expiry clamp, the remaining allowance, decoding of v1 delegation accounts, and the contracts `AllowanceView`. |
| PDAs | `findPrincipalPda`, `findAgentPda`, `findPayeePda`, `findRequestPda`, `findLeashEventAuthorityPda`, and on the Subscriptions side `findSubscriptionAuthorityPda`, `findDelegationPda`, `findSubscriptionsEventAuthorityPda`. Seeds from [02-contracts §2.3](../../docs/architecture/02-contracts.md#23-pda-seeds). |
| Program errors | `findLeashFailure(error, message)` finds the Leash error in a failed send, a preflight failure or a raw simulation `err`, ignoring other programs' custom codes. `toSdkError` turns it into `PaymentDeniedError`, `ApprovalNotPossibleError` or `LeashProgramError`. |
| Events | `decodeLeashEvents(tx)` turns a transaction's `emit_cpi!` inner instructions into the contract `LeashEvent` JSON of [02-contracts §6](../../docs/architecture/02-contracts.md#6-events-json), all 18 types, ids `${signature}:${n}`. `transactionRecordFromRpc` adapts a `getTransaction` (json encoding) response. |
| Conversions | Chain enums ↔ contract names, `policyToView` / `policyFromView`, `payeeLimitsFromView`. |
| Generated clients | Codama clients for Leash (from `packages/contracts/idl/leash.json`) and Subscriptions (from the vendored `idl/subscriptions.json`, tag `program-v0.5.0`) in `src/generated/`. Internal: consumers use the exports above. |
| `LeashAgent` | The agent runtime's client (it implements `LeashAgentPort` of `@leash/tools`): `status`, `pay`, `requestApproval`, `buildPayInstruction` (x402), `reportDenied`, `simulatePay`. The pay flow follows [ADR-0002](../../docs/adr/0002-strict-pay-and-reported-denials.md) and the [reporting policy](../../docs/adr/20260929-ws0-denial-reporting-policy.md). |
| Owner builders | `buildOnboarding` (principal, Subscriptions authority and delegation, agent, allowlist; resumable, packed into as few transactions as fit) and one builder per admin instruction: policy, payees, freeze and unfreeze, requests, guardian, revoke allowance, close agent. They return instructions; a wallet signs them. |
| Reads | `fetchPrincipalView`, `fetchAgentView` (allowance at the cluster's time), `fetchAgentViews`, `fetchPayees`, `fetchOpenRequests`, `readAgentStatus`: the contract views of [02-contracts §5](../../docs/architecture/02-contracts.md#5-views-indexer-and-sdk-read-models). |
| `LeashChain` | The few chain operations the SDK needs. `rpcChain({ rpc })` implements it for devnet and localnet (confirmation by polling, no websocket needed); `@leash/sdk/testing` implements it with LiteSVM. |
| Transactions | `buildTransactionMessage`, `sendInstructions`, `sendPlan`, `packTransactions`. |
| `@leash/sdk/testing` | `createTestbed()`: an in-process LiteSVM running the committed `leash.so` and `subscriptions.so`, with a funded owner, an onboarded agent (demo policy, 5 USDC a day) and an allowlisted merchant, plus clock and balance helpers. `testKeyAddress(name)`: the shared test-key derivation, identical to the Rust tests. Node only. |

## Usage

The agent side (the agent key signs and pays its own fees):

```ts
import { createSolanaRpc } from "@solana/kit";
import { LeashAgent, PaymentDeniedError, rpcChain } from "@leash/sdk";

const chain = rpcChain({ rpc: createSolanaRpc("https://api.devnet.solana.com") });
const agent = new LeashAgent({ chain, signer: agentKey, owner: ownerWallet });

try {
  const receipt = await agent.pay({ to: merchantWallet, amount: 10_000n, purpose: "Research API: one report" });
  console.log(receipt.signature, receipt.payeeLabel); // read from the PaymentExecuted event
} catch (error) {
  if (error instanceof PaymentDeniedError) {
    // error.reason: "payeeNotAllowed", "approvalRequired", …; error.recorded: on-chain or not;
    // error.strikes / error.frozen: the tripwire after this attempt.
  }
}
const pending = await agent.requestApproval({ to: merchantWallet, amount: 2_000_000n, purpose: "Deep report" });
// Once the owner approves, the same `pay` uses (and consumes) the request.
```

What `pay` does, in order: reads the accounts in one batch; uses an approved request for the same payee and amount if there is one; evaluates locally; simulates; on a denial, sends `report_denied_attempt` per the reporting policy (strikes always, `approvalRequired` never, other reasons at most once a minute per reason) and throws `PaymentDeniedError`; otherwise sends with `ceil(units × 1.15)` compute units and returns the receipt. Payments of one `LeashAgent` run one at a time. A payment with an explicit `reference` that already executed returns the earlier receipt instead of paying twice. If the payee has no token account for the mint, an allowed payment creates it (the agent key pays the rent); a denied one cannot be recorded and throws with `recorded: false`.

The owner side (the owner's wallet signs):

```ts
import { buildFreezeAgent, buildOnboarding, sendPlan } from "@leash/sdk";

const plan = await buildOnboarding(chain, {
  owner, agentKey, mint: usdcMint, label: "Research agent", policy, guardian,
  allowance: { kind: "recurring", amountPerPeriod: 5_000_000n, periodLengthSecs: 86_400n },
  payees: [{ payee: merchantWallet, label: "Research API", limits: { maxPerPayment: 2_000_000n, periodLimit: 3_000_000n, periodSecs: 86_400 } }],
});
await sendPlan(chain, { feePayer: owner, transactions: plan.transactions }); // or hand plan.transactions to a wallet

const freeze = await buildFreezeAgent({ authority: guardian, owner: ownerWallet, agent: plan.agent });
```

Tests of other workstreams (Node):

```ts
import { LeashAgent } from "@leash/sdk";
import { createTestbed, USDC } from "@leash/sdk/testing";

const bed = await createTestbed(); // real leash.so + subscriptions.so in LiteSVM
const agent = new LeashAgent({ chain: bed.chain, signer: bed.keys.agentKey, owner: bed.keys.owner.address });
await agent.pay({ to: bed.keys.merchant.address, amount: USDC / 2n, purpose: "test" });
bed.advance(86_400n); // next allowance period
```

The policy evaluator on its own:

```ts
import { evaluatePayment } from "@leash/sdk";

const result = evaluatePayment({
  now: 1_790_935_200n,
  principalFrozen: false,
  agent: {
    address: agentPda,
    status: "active",
    policy: {
      maxPerPayment: 1_000_000n, // 1.00 USDC, base units
      maxPerRequest: 5_000_000n,
      payeeMode: "allowListOnly",
      velocityMaxPayments: 30,
      velocityWindowSecs: 60,
      tripwireMaxStrikes: 3,
      tripwireWindowSecs: 600,
      requestTtlSecs: 3600,
      validUntil: 0n, // 0 = never
    },
    velocityWindowStart: 1_790_935_170n,
    velocityCount: 5,
  },
  payeeEntry: null, // this agent's PayeeEntry for the destination owner, if one exists
  request: null, // an approved PaymentRequest, if this payment uses one
  delegation: {
    kind: "recurring",
    amountPerPeriod: 5_000_000n,
    periodLengthSecs: 86_400n,
    currentPeriodStart: 1_790_931_600n,
    pulledInPeriod: 100_000n,
    expiryTs: 0n,
  },
  sourceAmount: 100_000_000n, // the owner's token balance
  payment: { amount: 10_000n, destinationOwner: merchant, reference },
});

if (result.outcome === "denied") {
  console.log(result.reason, result.strike); // "payeeNotAllowed", true
}
```

Reading a delegation account and showing what is left:

```ts
import { allowanceAt, decodeDelegation } from "@leash/sdk";

const delegation = decodeDelegation(address, accountData); // throws LeashSdkError UNSUPPORTED_DELEGATION unless v1
const view = allowanceAt(delegation, BigInt(Math.floor(Date.now() / 1000)));
// view.remaining is a base-unit string, like every amount in @leash/contracts
```

Decoding the Leash events of a confirmed transaction (what the indexer does):

```ts
import { decodeLeashEvents, transactionRecordFromRpc } from "@leash/sdk";

const response = await rpc
  .getTransaction(signature, { encoding: "json", maxSupportedTransactionVersion: 0 })
  .send();
if (response) {
  const events = decodeLeashEvents(transactionRecordFromRpc(response), {
    // Agent-level events carry only the agent; pass what you know to fill `principal`.
    principalOf: (agent) => knownPrincipals.get(agent) ?? null,
  });
  // events[0].id === `${signature}:0`; a failed transaction yields []
}
```

Mapping a failed transaction to the SDK's errors:

```ts
import { findLeashFailure, toSdkError } from "@leash/sdk";

try {
  await sendAndConfirm(transaction);
} catch (error) {
  const failure = findLeashFailure(error, transactionMessage); // null: not a Leash error
  if (failure) throw toSdkError(failure, { to: merchant, amount });
  throw error;
}
```

All amounts and timestamps are `bigint` (u64/i64 on-chain); counts and window lengths are `number` (u8/u16/u32). These are the shapes the generated client will decode, so decoded accounts will plug straight in.

## Guarantees

- **Parity with the program.** `test/vectors.test.ts` runs all 60 cases of [`test-vectors/policy.json`](../contracts/test-vectors/policy.json), the same file the program's LiteSVM tests use, and checks outcomes and every written counter. If the evaluator and the program disagree, one of them has a bug.
- **Faithful to Subscriptions.** `src/allowance.ts` is ported from `transfer_validation.rs` of `solana-foundation/subscriptions`, including `saturating_sub`, the i64 period conversion and the expiry clamp.
- **Invariants.** Property tests (fast-check, 2,000 random states each) check that an allowed payment never exceeds the allowance, the balance or the instant limit (I1), only passes the allowlist with this agent's entry for the destination (I2), never happens while anything is frozen (I3), marks strikes exactly as the master table does, and never mutates its input.
- **Tested on the real binaries.** The owner builders, reads and `LeashAgent` run in LiteSVM against the committed `leash.so` (byte for byte the devnet deployment) and the audited `subscriptions.so`: every admin instruction, every reporting rule, the tripwire, approvals, races between simulation and send, and parity mismatches.
- **Events match the contracts.** `test/events.test.ts` encodes every event of the demo storyline fixture plus the ten other types with the generated codecs, decodes them, and requires exactly the contract JSON back (validated by `LeashEventSchema`).
- **100% coverage** of statements, branches, functions and lines in `src/evaluate/`, `src/allowance.ts`, `src/events.ts`, `src/convert.ts`, `src/pda.ts` and `src/program-errors.ts`; at least 95% of branches everywhere else. `pnpm test` (and so CI) fails below that.

### Edge cases the spec leaves open

The SDK chose these, and the program does the same ([WS1's answer](../../docs/workstreams/messages/20260930-1000-from-ws1-to-ws2-idl-ready.md)):

| Case | SDK result |
| --- | --- |
| A window end (`start + secs`) beyond i64 | error `MathOverflow` |
| A payee's `spent + amount` beyond u64 | error `MathOverflow` |
| Allowance check | `amount > per_period - pulled` (as upstream; cannot overflow). `pulled > per_period` → `allowanceExceeded` |
| Recurring period of 0 or beyond i64 (upstream never creates one) | error `UnsupportedDelegation` |

## Develop

```bash
pnpm --filter @leash/sdk test        # all tests (LiteSVM included), with the coverage gates
pnpm --filter @leash/sdk typecheck
pnpm --filter @leash/sdk lint
pnpm --filter @leash/sdk generate    # regenerate src/generated/ after the IDL changes
```

No environment variables. The tests need no network. Never edit `src/generated/` by hand.

On a machine that reaches devnet (the laptop), with funded demo keys in `.keys/`:

```bash
pnpm devnet:setup    # onboard owner-demo's agent with the research-assistant preset (resumable)
pnpm devnet:smoke    # an allowed payment, one that needs approval, one blocked and recorded
```

Both take `--cluster localnet` (after `pnpm localnet`) and `--rpc <url>`.

## Next

1. **Step 7:** API feedback from WS3, WS6 and WS7, then freeze the API as 1.0.
