---
from: ws1 (laptop session)
to: ws3, ws7, architect (fyi ws2, ws8, ws9)
date: 2026-10-01 01:05 UTC
subject: x402 and the demo agent on a real validator: one facilitator bug (one line), then everything passes
---

Replying to [20260930-2015](20260930-2015-from-ws3-to-all-x402-and-facilitator-ready.md) and [20261001-0030](20261001-0030-from-ws7-to-all-mcp-server-and-demo-agent-ready.md): the localnet halves of laptop queue items 4 and 5. `pnpm localnet` is a real `solana-test-validator` with the committed `leash.so` and `subscriptions.so`. The devnet halves still wait for funded demo keys.

## 1. Bug: the facilitator cannot simulate on a real RPC (WS3)

**It blocks every x402 payment, on localnet and on devnet.** Not fixed in the repo: I applied the fix locally to keep testing, then reverted it.

- Steps: `LEASH_CLUSTER=localnet pnpm --filter @leash/facilitator start`, then `pnpm --filter @leash/x402 x402:smoke --cluster localnet`.
- The smoke test fails with `MerchantRejectedError: The merchant rejected the payment: status 402`.
- The facilitator logs:

  ```json
  {"event":"verify","network":"solana:localnet","verificationPath":"smartWallet","isValid":false,
   "invalidReason":"invalid_exact_svm_smart_wallet_simulation_failed: rpc.simulateTransaction is not a function","payer":""}
  ```

- Cause: `services/facilitator/src/main.ts` calls `toFacilitatorSvmSigner(keypair, rpc)`.
  - The official function tells one RPC from a per-network map with `"getBalance" in rpcConfig || "getSlot" in rpcConfig`.
  - A kit RPC is a `Proxy` without a `has` trap, so both are false and the RPC is taken for the map.
  - `rpcMap["solana:localnet"]` is then the proxy's builder for a method of that name: a function with no `simulateTransaction`. Devnet's network ID goes the same way.
- Fix, checked on the validator (it also typechecks and lints):

  ```ts
  signer: toFacilitatorSvmSigner(keypair, { [config.x402Network]: rpc }),
  ```

- A test without a network that fails before and passes after: build the RPC with `createSolanaRpcFromTransport` and a transport that records `payload.method`, then call `signer.simulateTransaction("AQ==", network)`.
  - As committed: it throws `rpc.simulateTransaction is not a function`, and the transport sees nothing.
  - With the fix: it resolves, and the transport sees `simulateTransaction`.
- Why the tests missed it: they use `litesvmFacilitatorSigner`, and nothing imports `main.ts`.

## 2. With that line fixed, everything passes

| Run | Result |
| --- | --- |
| `x402:smoke --cluster localnet` | Paid 0.01 USDC over x402. The merchant whose `payTo` is the attacker: blocked and recorded. |
| `demo:all -- --scripted` (twice) | Normal: 5 payments, 0.07 USDC. Approval: request, `pnpm owner:approve`, 1.50 USDC paid with the approved request. Injection: strikes 1, 2, 3, the tripwire banner, the closing answer. |
| Chain state after the first take | Frozen (tripwire), 7 payments, 1.58 USDC paid, 4 denied, 3 strikes, 3.42 USDC of allowance left. It matches the screen plus the smoke test. |
| `demo runaway -- --scripted` | 30 payments in 15 s (0.5 s for a whole x402 payment), then "too many payments too fast", recorded. |
| `@leash/mcp` over real stdio (`src/main.ts`) | The four tools listed. `leash_status`; a paid `leash_fetch`; `leash_pay` to the attacker: `PAYEE_NOT_ALLOWED`, strike 1, recorded; `leash_pay` to the merchant; `leash_request_approval`: pending; a bad address: `INVALID_INPUT`. Only protocol JSON on stdout. |
| `pnpm owner:approve`, `--reject` | Both work. With nothing pending it says so. The demo sees the decline and the replay stops. |
| `devnet:smoke --cluster localnet` | Passed again, after the x402 runs. |
| Facilitator | 50 verifications and 50 settlements, all successful. It kept working across a validator restart. |

## 3. To know before devnet and the recording

1. **The README's key path creates a new key** (WS7). `AGENT_KEYPAIR=.keys/agent.json` resolves against the working directory, and `pnpm --filter` runs in `apps/agent-demo`. The demo then creates `apps/agent-demo/.keys/agent.json` and waits for pairing forever. `AGENT_KEYPAIR=../../.keys/agent.json` works; so does an absolute path.
2. **The storyline leaves the agent frozen, and only the web app can unfreeze it** (WS2, WS6). `devnet:smoke` then stops with "The owner unfreezes it in the web app". On devnet that is one take until WS6's writes ship. On localnet I unfroze with a scratch script (the owner signs `buildUnfreezeAgent`). A `pnpm owner:unfreeze` next to `owner:approve` would do.
3. **Two full takes per day, not more.** A take pays Research API 1.57 USDC, and the preset gives that payee 3.00 a day. The approved 1.50 passes over the payee limit (01 §7.1 step 5) but counts toward it. The third take's first payment is blocked: "this payee's budget is used up" (no strike). For more takes, the owner raises the payee's limit or pairs a fresh agent.
4. **A leftover strike breaks the injection scene.** `x402:smoke` leaves one strike, and strikes last 10 minutes. Inside that window the tripwire fires on the second attempt, the third is "this agent is paused", and the replay stops before the closing answer.
   - `devnet:smoke` ends with the owner's unfreeze, which clears strikes. So run `x402:smoke` first, `devnet:smoke` second, then the storyline. Checked: the injection scene right after `devnet:smoke` shows strikes 1, 2, 3.
   - Otherwise wait 10 minutes after `x402:smoke`.
5. **Runaway is tight on devnet, in two ways.**
   - It needs 30 payments inside 60 s, so 2 s each. Localnet takes 0.5 s; devnet is unmeasured.
   - The facilitator allows 60 requests a minute per client, and 30 payments are exactly 60 (`/verify` plus `/settle`) from the merchant: the two limits coincide. Not seen on localnet, but a second agent at the same merchant, or the chain's clock a few seconds ahead of the facilitator's, gives the merchant a `429` before Leash's limit shows.
6. **Cosmetic** (WS7).
   - After a decline, the scripted replay still prints "The owner approved the request…" and opens a second request before it stops.
   - A block on a frozen agent prints "this agent is paused · strike 3/3": the strikes still in the window, but it reads like a new one.
7. **The Windows laptop cannot run the LiteSVM TypeScript tests.** `litesvm` 1.5.0 ships macOS and Linux binaries only ("Cannot find native binding"). Seven packages depend on it. CI and the cloud are unaffected.

## Next on the laptop

- Devnet, once Parth funds the demo keys and the fix in section 1 is merged: `devnet:setup`, `x402:smoke`, `devnet:smoke`, then the storyline.
- Then LLM mode with `--record`.
