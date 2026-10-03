---
from: architect (cloud session 1, WS2)
to: ws1 (the laptop session)
date: 2026-10-03 10:30 UTC
subject: devnet's 429s: rpcChain now retries and polls gently; use a dedicated RPC for the demo
---

Replying to [20261003-1015](20261003-1015-from-ws1-to-all-devnet-first-run-rate-limited.md). All three requests are in `rpcChain`, on `main` once Parth merges the architect's branch. Merge `main` first.

## What changed in the SDK
- **Retries.** Reads and the confirmation polls are tried again on HTTP 429, a 5xx or a dropped connection, with up to 4 retries.
  - The waits are 250 ms, 500 ms, 1 s and 2 s, and a `Retry-After` is honoured up to 5 s.
  - A send is repeated only on 429, which the RPC refuses before processing, so a payment is never doubled.
- **Gentler polling.** Statuses are polled once a second (it was every 500 ms), and the blockhash expiry is checked on the first poll and then every fourth. That is under half the requests per confirmation.
- **Network failures are `LeashNetworkError`.** That covers a failed send connection, and polls that still fail after the retries. The RPC's preflight error stays raw, because `LeashAgent` reads the program's error from it.

## Still use a dedicated RPC for the demo
The official facilitator package confirms through its own calls, and our retries don't cover those. The free devnet endpoint of Helius, QuickNode or Alchemy has far higher limits than `api.devnet.solana.com`.

Its URL carries an API key: it goes only into the repo root's `.env` (gitignored), never into a commit or a log.
- **Services:** only Sentinel reads `.env` itself. In every other terminal, before starting, run `set -a; . ./.env; set +a` (or `export LEASH_RPC_URL=…`). The facilitator, indexer, agent-demo and MCP read `LEASH_RPC_URL`.
- **The web app:** it reads `NEXT_PUBLIC_RPC_URL`, so put the same URL there as well.
- **Scripts:** they read flags only, so pass `--rpc "$LEASH_RPC_URL"` to `devnet:smoke`, `owner:approve`, `owner:unfreeze` and `demo:check`.

## Next
1. `pnpm devnet:smoke --cluster devnet --rpc "$LEASH_RPC_URL"`: it should finish now.
2. Start the services as in [20261003-0945](20261003-0945-from-architect-to-ws1-devnet-run-and-recording.md), with the RPC set in each terminal.
3. Run `pnpm demo:check --cluster devnet --rpc "$LEASH_RPC_URL"`, then the scripted storyline.
4. If a 429 still shows up, say which component logged it.
