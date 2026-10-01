# @leash/x402

Leash payments as ordinary x402 v2 payments ([02-contracts §9](../../docs/architecture/02-contracts.md#9-x402-profile-how-leash-payments-travel-over-x402-v2), [ADR-0003](../../docs/adr/0003-x402-via-official-facilitator.md)). The official x402 packages do all the protocol work; this package adds a Leash payment scheme for agents, a merchant helper, and the facilitator configuration.

Owned by **WS3**. Brief: [docs/workstreams/WS3-x402-facilitator.md](../../docs/workstreams/WS3-x402-facilitator.md). Status: [docs/workstreams/status/WS3.md](../../docs/workstreams/status/WS3.md).

| Entry | For | What it gives |
| --- | --- | --- |
| `@leash/x402` | agents | `createLeashFetch` (WS7's `LeashFetchPort`), `LeashExactSvmScheme` |
| `@leash/x402/merchant` | merchants (WS8) | `leashMerchant`: the official `@x402/hono` middleware, prices in exact base units |
| `@leash/x402/facilitator` | facilitators | `createLeashFacilitator`: the official `ExactSvmScheme` with Leash allowlisted |
| `@leash/x402/testing` | tests (Node) | `litesvmFacilitatorSigner`: the official facilitator's signer over LiteSVM |

## How a Leash payment travels

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent (leashFetch)
    participant M as Merchant (@x402/hono)
    participant F as Facilitator (official ExactSvmScheme)
    participant L as Leash → Subscriptions → Token
    A->>M: GET /api/research
    M-->>A: 402 PAYMENT-REQUIRED (exact, asset, amount, payTo, extra.feePayer)
    A->>A: LeashAgent.preparePayment: policy check, simulation<br/>(a denial is reported on-chain and thrown)
    A->>M: PAYMENT-SIGNATURE: [CU limit, CU price, leash::pay, Memo],<br/>fee payer = facilitator, signed by the agent key only
    M->>F: POST /verify
    F->>F: static path fails (the transfer is a CPI) → smart-wallet path:<br/>Leash allowlisted, fee payer isolated, CU caps,<br/>simulation has exactly one matching TransferChecked
    F-->>M: isValid
    M->>F: POST /settle
    F->>L: fee payer signs, sends; the program re-checks everything
    F->>F: post-settlement check of the confirmed transfer
    F-->>M: success + signature
    M-->>A: 200 + resource + PAYMENT-RESPONSE
```

## For facilitator operators: accept Leash payments

Any facilitator running `@x402/svm` accepts Leash payments after two changes to `ExactSvmScheme`'s options:

```ts
new ExactSvmScheme(signer, undefined, {
  enableSmartWalletVerification: true, // 1. turn on the smart-wallet path
  smartWalletAllowedPrograms: [...X402_DEFAULT_SMART_WALLET_PROGRAMS, LEASH_PROGRAM_ID], // 2. allow Leash
});
```

`createLeashFacilitator` does exactly that, plus the 400k compute-unit and 50k priority-fee caps of 02 §9. No custom verification code: the official scheme checks everything, and a facilitator without the allowlist entry rejects the payment with `invalid_exact_svm_smart_wallet_program_not_allowed: HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu`.

## Usage

Agent side (Node):

```ts
import { CAIP2 } from "@leash/contracts";
import { LeashAgent, rpcChain } from "@leash/sdk";
import { createLeashFetch } from "@leash/x402";

const chain = rpcChain({ rpc });
const agent = new LeashAgent({ chain, signer: agentKey, owner: ownerWallet });
const leashFetch = createLeashFetch({ agent, chain, network: CAIP2.devnet });

const { status, body, payment } = await leashFetch({
  url: "https://merchant.example/api/research?q=solana",
  method: "GET",
  headers: {},
  body: undefined,
  purpose: "Research API: one report", // stored on-chain as the memo
});
// payment: { signature, amount, payee, payeeLabel, purpose, requestNonce, reference, memo } | null
```

Errors are only the SDK's typed ones:
- `PaymentDeniedError`: the policy blocked the payment, and the attempt is recorded per the reporting policy.
- `UnsupportedPaymentError`: a network, asset or scheme this agent can't pay, or a payee without a token account.
- `MerchantRejectedError`: the facilitator or merchant refused, and nothing was charged.
- `LeashNetworkError`: the merchant is unreachable.

After the owner approves a request for the same payee and amount, the next call pays with it and consumes it.

Merchant side:

```ts
import { leashMerchant } from "@leash/x402/merchant";

app.use(leashMerchant({
  payTo: merchantWallet,
  facilitator: "http://localhost:4200",
  network: CAIP2.devnet,
  asset: usdcMint,
  routes: { "GET /api/research": { price: "0.01", description: "One research report" } },
}));
```

## What the official packages do that you might not expect

- **The x402 client has its own spend controls.** By default it pays only known USDC mints, and at most $1 per payment. That would refuse localnet's mock USDC and any approved payment above $1. Leash's on-chain policy is the spend control, so `createLeashFetch` turns them off.
- **`wrapFetchWithPayment` flattens errors.** It rethrows anything the scheme throws as a plain `Error`. `createLeashFetch` rethrows the scheme's original typed error instead.
- **The Memo program.** x402 uses the SPL Memo `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, with no signer accounts; this package uses it. `@solana-program/memo` 0.15 defaults to a different program, so don't use its default.
- **Post-settlement verification reads parsed transfers.** The facilitator re-checks the confirmed transaction as `getTransaction(..., "jsonParsed")` returns it. `litesvmFacilitatorSigner` reproduces that format.
- **`toFacilitatorSvmSigner` misreads a kit RPC.** It tells a single RPC from a per-network map with `"getBalance" in rpc`, which is false for a kit RPC (a Proxy). It then treats the RPC as a map, and every simulation fails with `rpc.simulateTransaction is not a function`. Its default RPCs also know only devnet, testnet and mainnet. Pass `{ [network]: rpc }`, as `services/facilitator` does (`src/signer.ts`, tested).

## Versions

`@x402/core`, `@x402/svm`, `@x402/fetch` and `@x402/hono` are pinned at exactly **2.27.0**. Leash relies on the smart-wallet path (Path 2) behaving as tested, so upgrade only with the whole suite green. `test/facilitator.test.ts` also checks that `X402_DEFAULT_SMART_WALLET_PROGRAMS` still equals the installed package's default list, which the package doesn't export.

## Tests

```bash
pnpm --filter @leash/x402 test
```

22 tests, no network. The unmodified official facilitator runs against the real `leash.so` and `subscriptions.so` in LiteSVM:

| WS3 test table row | Result |
| --- | --- |
| A standard payment (plain `TransferChecked`) verifies and settles | ✓ Path 1 |
| A Leash payment verifies and settles | ✓ Path 2, including post-settlement verification |
| The same payment against a facilitator without Leash on the allowlist | ✓ `…program_not_allowed: HyL9…` |
| A payment the program would deny fails verification | ✓ `…smart_wallet_simulation_failed` |
| The fee payer inside an instruction is rejected | ✓ `…fee_payer_not_isolated` |
| Settling the same payload twice pays once | ✓ `duplicate_settlement` |
| `leashFetch` end to end against a Hono app with the merchant helper | ✓ paid, free, denied, approved, unsupported, refused, unreachable |
