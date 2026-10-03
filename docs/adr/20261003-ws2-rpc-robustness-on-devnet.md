# On devnet, RPC calls are retried with backoff, and a payment makes as few round trips as it can

- Status: Accepted (implemented, on `main`)
- Date: 2026-10-03
- Workstream: WS2 (one line each in WS3's `services/facilitator` and `packages/x402`)
- Contract change: no. The SDK gains `createRetryingSolanaRpc`, `retryingTransport` and `PreparedPaymentResult.lifetime`; nothing is removed.

## Context

The laptop's first devnet runs ([20261003-1015](../workstreams/messages/20261003-1015-from-ws1-to-all-devnet-first-run-rate-limited.md), [20261003-1050](../workstreams/messages/20261003-1050-from-ws1-to-all-storyline-passes-on-devnet.md)) showed two problems that LiteSVM and a local validator cannot:

1. **The public RPC throttles.** `api.devnet.solana.com` answers HTTP 429 after a few transactions, and every service of the demo shares one IP. Nothing retried: one 429 stopped `devnet:smoke`. The official facilitator package gives up on the first error too, so a 429 while it confirms a settlement fails a payment the policy allowed.
2. **A paid call took about 20 s.** Each one is a chain of sequential RPC round trips (0.3–1 s each on the public RPC) plus the settlement.

## Decision

1. **Retries** (`src/retry.ts`, used by `rpcChain`):
   - What is retried: HTTP 429, a 5xx or a dropped connection, up to 4 times, after 250 ms, 500 ms, 1 s and 2 s. A `Retry-After` is honoured up to 5 s.
   - A send is repeated only after a 429: the RPC refused it before processing, and any other failure may have reached the network.
   - A failed send connection, and reads that still fail after the retries, are `LeashNetworkError`. The RPC's preflight error stays raw, because `LeashAgent` reads the program's error from it.
2. **The same rules for RPCs the SDK doesn't wrap.** `createRetryingSolanaRpc(url)` is `createSolanaRpc` over `retryingTransport`. The facilitator service builds the RPC it hands to the official package with it.
3. **Fewer round trips:**
   - `LeashAgent` reads the accounts and a blockhash in parallel. One blockhash serves an operation's simulations and its send; it stays valid for about a minute.
   - `PreparedPaymentResult.lifetime` hands the simulation's blockhash to the x402 scheme.
   - Result: 2 sequential agent-side round trips per x402 call instead of 4. A blocked attempt with its report makes 4 fewer: three blockhash fetches, and the block-height read on the first poll (item 4).
4. **Confirmation polling in `rpcChain`:**
   - The first two status polls come after 0.5 s, then once a second.
   - The blockhash expiry is checked from the fourth poll on, every fourth.
   - A confirmed transaction the node cannot return yet is asked for again after 0.5 s.
5. **The facilitator logs the `ms` of each `verify` and `settle`.** The settlement's share of a paid call becomes visible.

## Consequences

- One 429 no longer fails a payment, a report or a settlement. A provider that keeps throttling makes the demo slower, not broken.
- Don't hand an RPC built on `retryingTransport` to `rpcChain`: retries would multiply (`rpcChain` retries by itself).
- Reusing a blockhash within one operation is safe because the operation takes seconds. Separate operations still fetch their own.
- The demo still wants a dedicated RPC that allows `getProgramAccounts` (Helius' free plan does; Alchemy's free tier does not), and a priority fee above the default of 1 micro-lamport per compute unit if devnet is slow to land transactions (`LEASH_PRIORITY_FEE_MICROLAMPORTS`, up to 50000).

## Alternatives considered

- **Retry every send failure.** Lost: a send that reached the network and then lost its connection would be sent again. The cluster deduplicates the signature, but the agent would then misread the outcome.
- **Websocket confirmation (`signatureSubscribe`).** Lost: it needs a websocket endpoint per cluster and per provider, and polling over HTTP works everywhere.
- **Fork or patch the official facilitator package to retry.** Lost: ADR-0003 relies on running it unmodified. Wrapping its RPC achieves the same from outside.
