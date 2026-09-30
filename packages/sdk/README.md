# @leash/sdk

The one TypeScript way to talk to Leash. The web app, indexer, Sentinel, x402 layer, tools, MCP server and demo agent all go through this package.

Owned by **WS2**. Brief: [docs/workstreams/WS2-sdk.md](../../docs/workstreams/WS2-sdk.md). Status: [docs/workstreams/status/WS2.md](../../docs/workstreams/status/WS2.md).

## What exists today (build steps 1, 2 and 6)

| Module | What it does |
| --- | --- |
| `evaluatePayment` | Predicts what the Leash program's `pay` will do with a payment ([01-onchain-program §7](../../docs/architecture/01-onchain-program.md#7-evaluation)): allowed (with the counters it would write), denied (with the reason and whether it is a strike), or an error. Pure, no network. |
| `allowance` | The Subscriptions allowance rules: inclusive expiry, the recurring period roll-forward with its expiry clamp, the remaining allowance, decoding of v1 delegation accounts, and the contracts `AllowanceView`. |
| PDAs | `findPrincipalPda`, `findAgentPda`, `findPayeePda`, `findRequestPda`, `findLeashEventAuthorityPda`, and on the Subscriptions side `findSubscriptionAuthorityPda`, `findDelegationPda`, `findSubscriptionsEventAuthorityPda`. Seeds from [02-contracts §2.3](../../docs/architecture/02-contracts.md#23-pda-seeds). |
| Program errors | `findLeashFailure(error, message)` finds the Leash error in a failed send, a preflight failure or a raw simulation `err`, ignoring other programs' custom codes. `toSdkError` turns it into `PaymentDeniedError`, `ApprovalNotPossibleError` or `LeashProgramError`. |
| Events | `decodeLeashEvents(tx)` turns a transaction's `emit_cpi!` inner instructions into the contract `LeashEvent` JSON of [02-contracts §6](../../docs/architecture/02-contracts.md#6-events-json), all 18 types, ids `${signature}:${n}`. `transactionRecordFromRpc` adapts a `getTransaction` (json encoding) response. |
| Conversions | Chain enums ↔ contract names, `policyToView` / `policyFromView`, `payeeLimitsFromView`. |
| Generated clients | Codama clients for Leash (from `packages/contracts/idl/leash.json`) and Subscriptions (from the vendored `idl/subscriptions.json`, tag `program-v0.5.0`) in `src/generated/`. Internal: consumers use the exports above. |
| `@leash/sdk/testing` | `testKeyAddress(name)`: the shared test-key derivation (ed25519 seed = `sha256("leash:test-key:" + name)`), identical to the Rust tests. |

Not built yet: account reads, owner transaction builders, `LeashAgent`, and the LiteSVM testbed. See [Next](#next).

## Usage

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
- **Events match the contracts.** `test/events.test.ts` encodes every event of the demo storyline fixture plus the ten other types with the generated codecs, decodes them, and requires exactly the contract JSON back (validated by `LeashEventSchema`).
- **100% coverage** of statements, branches, functions and lines in `src/evaluate/`, `src/allowance.ts`, `src/events.ts`, `src/convert.ts`, `src/pda.ts` and `src/program-errors.ts`. `pnpm test` (and so CI) fails below that.

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
pnpm --filter @leash/sdk test        # all tests, with the 100% coverage gate
pnpm --filter @leash/sdk typecheck
pnpm --filter @leash/sdk lint
pnpm --filter @leash/sdk generate    # regenerate src/generated/ after the IDL changes
```

No environment variables, no network. Never edit `src/generated/` by hand.

## Next

1. **Step 3:** `fetch*View` reads on top of the generated account decoders, `decodeDelegation` and `allowanceAt`.
2. **Steps 4 and 5:** owner builders (onboarding through the Subscriptions client, all admin builders), `LeashAgent` (pay, simulate, report, request, queue, idempotency), and the `@leash/sdk/testing` LiteSVM testbed on the committed `artifacts/programs/*.so`.
3. **Step 7:** runnable README examples for owner and agent usage, API feedback from WS3, WS6 and WS7, then 1.0.
