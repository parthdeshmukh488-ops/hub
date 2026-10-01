# WS3 status: x402 layer and facilitator

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth said "start" on the critical path)
- Last updated: 2026-09-30
- Current build step: 1–5 done (every row of the test table passes); next: a real run on localnet/devnet
- Messages handled: through `20260930-1713-from-ws1-to-ws2-rpcchain-first-real-run.md` (for WS3: `20260930-0500-from-ws7-to-ws3-leash-fetch-port.md`, `20260930-1655-from-ws2-to-all-owner-builders-and-leashagent-ready.md`)

## Plan

What the installed `@x402/*` 2.27.0 packages provide, and what we add:

| Piece | Official interface | Leash part |
| --- | --- | --- |
| Client scheme | `SchemeNetworkClient` (`@x402/core/types`): `createPaymentPayload(version, requirements) → { x402Version, payload: { transaction } }` | `LeashExactSvmScheme`: validates the requirements, derives memo and reference (02 §3), lets the SDK evaluate, simulate and report a denial, then builds `[SetComputeUnitLimit, SetComputeUnitPrice, leash::pay, Memo]` with fee payer `extra.feePayer`, signed only by the agent key |
| Fetch | `wrapFetchWithPayment(fetch, x402Client)` (`@x402/fetch`) | `createLeashFetch({ agent, network })` → WS7's `LeashFetchPort`: typed errors, receipt from `PAYMENT-RESPONSE` |
| Facilitator | `x402Facilitator` + `ExactSvmScheme(signer, cache, options)` (`@x402/core/facilitator`, `@x402/svm/exact/facilitator`) | `createLeashFacilitator`: the 02 §9 options (smart-wallet path on, allowlist = package defaults + Leash, 400k CU and 50k priority-fee caps) |
| Service | – | `services/facilitator`: Hono, `POST /verify`, `POST /settle`, `GET /supported`, `GET /health`, per-IP rate limit, structured logs, low-balance warning |
| Merchant | `paymentMiddleware(routes, x402ResourceServer)` (`@x402/hono`) + `ExactSvmScheme` server | `leashMerchant({ payTo, facilitator, network, asset, routes })`, prices as exact base-unit amounts of the configured mint |
| Tests | `FacilitatorSvmSigner` (base64 in, base64 out) | `@leash/x402/testing`: that signer over LiteSVM, so the official facilitator runs against the real `leash.so` and `subscriptions.so` with no network |

Decisions:

1. **`@x402/*` pinned at exactly 2.27.0**, the version 02 §9 names. It resolves to the repo's single `@solana/kit` 8.4.0; its older `@solana-program/*` helpers only warn about their kit peer range. `@x402/paywall` is optional and not installed.
2. **The client's own spend controls are off.** By default `x402Client` pays only "default assets" (devnet or mainnet USDC), and at most $1 per payment. That would refuse localnet's mock USDC and every approved payment above $1. Leash's on-chain policy is the spend control, so `createLeashFetch` sets `spendControls: false`.
3. **`wrapFetchWithPayment` turns scheme errors into plain `Error`s.** The Leash scheme keeps the typed error (`PaymentDeniedError`, `UnsupportedPaymentError`), and `leashFetch` rethrows it, so the tools see exactly the SDK's errors.
4. **Reference rule 1 over rule 2** (02 §3): paying an approved request uses the request's reference; otherwise the reference is `sha256(memo)`. The facilitator only checks the memo text, not the reference.
5. **SDK addition (WS2):** `LeashAgent.preparePayment`. It evaluates, simulates and, on a denial, applies the reporting policy, exactly as `pay` does. It returns the `pay` instruction for someone else's transaction.

Order: step 1 (facilitator + LiteSVM signer + Path 1 test) → step 2 (client scheme) → step 3 (Path 2 test table) → step 4 (`leashFetch`, merchant helper, end to end) → step 5 (service hardening, README).

## Done

- **Steps 1–3 (2026-09-30).** `packages/x402`, pinned `@x402/*` 2.27.0:
  - `@leash/x402/facilitator`: `createLeashFacilitator` configures the official `ExactSvmScheme` exactly as 02 §9 says. `X402_DEFAULT_SMART_WALLET_PROGRAMS` copies the package's default allowlist, which it doesn't export; a test checks it against the installed dist, so an upgrade that changes it fails.
  - `@leash/x402/testing`: `litesvmFacilitatorSigner` implements the official `FacilitatorSvmSigner` over LiteSVM:
    - simulations skip signature checks, like the RPC with `sigVerify: false`;
    - confirmed transactions come back in `jsonParsed` form, which the post-settlement check needs;
    - it resolves address lookup tables.
  - `LeashExactSvmScheme` (client), on top of the new SDK `LeashAgent.preparePayment`, which runs the pay flow up to the send: evaluate, simulate with the Memo, report a denial per the policy.
  - 15 tests on the real `leash.so` and `subscriptions.so` through the unmodified official facilitator:
    - Path 1: a standard wallet verifies and settles.
    - Path 2: a Leash payment verifies (payer = the Subscription Authority, the delegate) and settles, including post-settlement verification. The facilitator pays the fee.
    - Without Leash on the allowlist: `invalid_exact_svm_smart_wallet_program_not_allowed: HyL9…`.
    - A payment the program would deny fails verification (`…simulation_failed`).
    - The fee payer inside an instruction: `…fee_payer_not_isolated`.
    - The same payload settled twice pays once (`duplicate_settlement`).
    - An approved request is used with its own reference.
    - The client refuses nine kinds of bad requirements, reports a denial before building anything, and refuses payees without a token account.
- SDK (WS2): `LeashAgent.preparePayment` and `LeashAgent.mint()`, with tests; 238 SDK tests.

- **Steps 4–5 (2026-09-30).**
  - `@leash/x402/merchant`: `leashMerchant`.
  - `createLeashFetch` tested end to end: agent → official `@x402/hono` middleware → official facilitator → Leash, in process.
  - `services/facilitator`: Hono, the official v2 guards, rate limit, logs with `verificationPath`, 64 KB body limit, low-balance warning, one RPC for every network; 7 tests, including the official `HTTPFacilitatorClient` against our API.
  - READMEs with the sequence diagram and the two-option change a facilitator operator needs.

- **2026-10-01, the laptop's real-validator run found a blocking bug:** the service passed a bare kit RPC to `toFacilitatorSvmSigner`. Its detection (`"getBalance" in rpc`) is false for a kit RPC, a Proxy, so every simulation failed: `rpc.simulateTransaction is not a function`, on localnet and devnet alike.
  - Fixed in `src/signer.ts`, which passes `{ [network]: rpc }`.
  - The test runs over a kit RPC with a recording transport, no network. It also pins the upstream behaviour.
  - The tests had missed it because they use `litesvmFacilitatorSigner`, and nothing imported `main.ts`.
  - The x402 README's advice ("pass one RPC object") was wrong and is corrected.
  - Also: the rate limit went from 60 to 120 per minute.

## Next

- Laptop: run `services/facilitator` against `pnpm localnet`, then devnet, with `.keys/facilitator.json`; WS8 points the merchant at it.
- WS7 wires `createLeashFetch` into `leash_fetch` (structurally a `LeashFetchPort`).

## Open items

- The first run against a real validator is still to come (the laptop).
- Rate-limit numbers (120 per minute per IP, raised from 60 on 2026-10-01 so they stay above one agent's velocity limit) are constants in code; they become env vars only if the demo needs it (that would be a contracts change, WS0).

## Questions for other workstreams

- None.

## Contract changes proposed

- None.
