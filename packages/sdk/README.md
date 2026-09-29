# @leash/sdk

The one TypeScript way to talk to Leash. The web app, indexer, Sentinel, x402 layer, tools, MCP server and demo agent all go through this package.

Owned by **WS2**. Brief: [docs/workstreams/WS2-sdk.md](../../docs/workstreams/WS2-sdk.md). Status: [docs/workstreams/status/WS2.md](../../docs/workstreams/status/WS2.md).

## What exists today (build step 2)

| Module | What it does |
| --- | --- |
| `evaluatePayment` | Predicts what the Leash program's `pay` will do with a payment ([01-onchain-program §7](../../docs/architecture/01-onchain-program.md#7-evaluation)): allowed (with the counters it would write), denied (with the reason and whether it is a strike), or an error. Pure, no network. |
| `allowance` | The Subscriptions allowance rules: inclusive expiry, the recurring period roll-forward with its expiry clamp, the remaining allowance, decoding of v1 delegation accounts, and the contracts `AllowanceView`. |
| `@leash/sdk/testing` | `testKeyAddress(name)`: the shared test-key derivation (ed25519 seed = `sha256("leash:test-key:" + name)`), identical to the Rust tests. |

Not built yet (they need the program's IDL): PDAs, account reads, owner transaction builders, `LeashAgent`, event decoding, and the LiteSVM testbed. See [Next](#next).

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

All amounts and timestamps are `bigint` (u64/i64 on-chain); counts and window lengths are `number` (u8/u16/u32). These are the shapes the generated client will decode, so decoded accounts will plug straight in.

## Guarantees

- **Parity with the program.** `test/vectors.test.ts` runs all 60 cases of [`test-vectors/policy.json`](../contracts/test-vectors/policy.json), the same file the program's LiteSVM tests use, and checks outcomes and every written counter. If the evaluator and the program disagree, one of them has a bug.
- **Faithful to Subscriptions.** `src/allowance.ts` is ported from `transfer_validation.rs` of `solana-foundation/subscriptions`, including `saturating_sub`, the i64 period conversion and the expiry clamp.
- **Invariants.** Property tests (fast-check, 2,000 random states each) check that an allowed payment never exceeds the allowance, the balance or the instant limit (I1), only passes the allowlist with this agent's entry for the destination (I2), never happens while anything is frozen (I3), marks strikes exactly as the master table does, and never mutates its input.
- **100% coverage** of statements, branches, functions and lines in `src/evaluate/` and `src/allowance.ts`. `pnpm test` (and so CI) fails below that.

### Edge cases the spec leaves open

The SDK chose these; WS1 was asked to make the program match ([message](../../docs/workstreams/messages/20260929-1815-from-ws2-to-ws1-parity-edge-cases.md)):

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
```

No environment variables, no network.

## Next

1. **Build step 1** (once WS1 commits the IDL): Codama client in `src/generated/`, PDAs, codecs, program error mapping.
2. **Step 3:** `fetch*View` reads on top of `decodeDelegation` and `allowanceAt`.
3. **Steps 4–7:** owner builders, `LeashAgent` (pay, simulate, report, request), `@leash/sdk/testing` LiteSVM testbed, event decoding, frozen 1.0 API.
