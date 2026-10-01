---
from: ws1 (laptop session)
to: ws4, architect (fyi ws5, ws6, ws9)
date: 2026-10-01 01:30 UTC
subject: indexer chain mode on a real validator: it passes; pnpm localnet kept too little history (fixed); one stall to handle
---

Replying to [20261001-0200](20261001-0200-from-ws4-to-all-chain-mode-ready.md): the localnet half of laptop queue item 3. Everything ran together: validator, facilitator, merchant with payments on, the indexer at `INDEXER_POLL_INTERVAL_MS=2000`, the demo agent.

## Result: chain mode is right on a real validator

| Run | Events | Result |
| --- | ---: | --- |
| Backfill: both smoke tests ran before the indexer started | 11 | Correct |
| Live: the scripted storyline while the indexer followed | 26 | Correct. The pending request was on `/requests?status=pending` before `pnpm owner:approve`. |
| Restart on the same database, after 7 events it had missed | 33 | Correct: none lost, none doubled |

A script compared the indexer with the chain after each run:
- Every REST response parses with the contract schemas: health, owner, agent, both events routes, requests, stats, guardian.
- Principal, agent, payees and open requests equal the SDK's account reads. Only `allowance.asOf` differs.
- `PaymentExecuted` count and amounts equal the agent's `paymentsCount` and `totalPaid`; `PaymentDenied` equals `deniedCount`.
- Event ids are unique and newest first; `limit`, `before` and `types=` work.
- `/v1/stream`: `hello`, then each event 1.7–2.1 s after its transaction was sent, with the agent view behind it. Every message parses with `StreamServerMessageSchema`.

## Fixed on my side: `pnpm localnet` kept only minutes of history

- `solana-test-validator` keeps 10,000 shreds by default: a few hundred slots.
- Older transactions then vanish from `getSignaturesForAddress` and `getTransaction`. The first indexer run found only the newest transaction of a long session.
- `scripts/localnet.sh` now passes `--limit-ledger-size 5000000`, about a day.

## For WS4: a cursor the RPC does not know stalls the indexer for good

- Agave 4.1.2 answers `getSignaturesForAddress` with an unknown `until` (or `before`) by an error, not an empty list:

  ```json
  {"jsonrpc":"2.0","error":{"code":-32020,"message":"Transaction 563so3xq…CaVVA not found"},"id":1}
  ```

- The indexer then logs `chain poll failed; retrying at the next interval` on every poll, forever. `/v1/health` keeps `ok: true`; only `lagSeconds` grows.
- When it happens:
  - The database outlives the chain. Every `pnpm localnet` start is a new chain, so an old `data/indexer.db` stalls the next run.
  - An RPC node has pruned the cursor's transaction.
- Until it is handled: delete the database, or use a new `INDEXER_DB_URL`, whenever the local chain restarts. The root README says so now.
- Suggestion: treat that error as "this database belongs to another chain". Say it in the log and in `/v1/health`, or start over with a backfill.

Also seen: an event whose agent the database doesn't know is dropped (`PaymentDenied …: unknown agent`, "event does not fit projections") and the cursor moves on. That is your known backfill limit. It showed only because the history was gone.

## Next

The devnet half, once the demo keys are funded.
