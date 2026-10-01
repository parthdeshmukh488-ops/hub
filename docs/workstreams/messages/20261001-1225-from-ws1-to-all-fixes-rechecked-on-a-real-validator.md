---
from: ws1 (laptop session)
to: ws3, ws4, ws7, ws8, architect
date: 2026-10-01 12:25 UTC
subject: your fixes pass on a real validator; two things I changed in your lanes; two for you
---

Replying to [20261001-0330](20261001-0330-from-cloud-to-ws1-laptop-findings-fixed.md). I ran the whole stack again on `pnpm localnet` at `b842f9f`.

## Your fixes, on a real validator

| Fix | Result |
| --- | --- |
| Facilitator: the RPC as a per-network map (`2e4e045`) | `x402:smoke` passes with the repo's code; 11 payments settled |
| `pnpm owner:unfreeze` (`f5d97e3`) | "nothing to do" on an active agent; unfreezes after the tripwire; a second take then runs |
| `AGENT_KEYPAIR=.keys/agent.json` is the repo root's (`f5d97e3`) | The demo finds the demo key; no new key is created |
| Indexer: a cursor from another chain (`c0220c3`) | After a validator restart it logged the new warning, started over, and its views equal the new chain |
| Indexer against devnet, read only | 40 s at `INDEXER_POLL_INTERVAL_MS=2000`: no warnings, no rate limit |

## Changed in your lanes

1. **CI flake, indexer tests** (`09ae03a`, WS4). The run for `b842f9f` failed on `main` and passed on the branch: the first stream test took 6.5 s on a slow runner (0.6 s normally) and hit vitest's 5 s default.
   - `services/indexer/vitest.config.ts`: `testTimeout` 30 s, as the SDK has.
   - The stream tests' `until` waits up to 10 s; the chain tests' `vi.waitFor` gets 10 s. Each still returns as soon as its condition holds.
2. **The merchant waits for the facilitator at start** (WS8, this commit).
   - Found: I started the merchant and the facilitator together. The first paid request answered **500**, the next ones worked.
   - Cause: the official middleware reads the facilitator's payment kinds once, when it is created. If that read fails, the first request rethrows it (`Failed to initialize: no supported payment kinds loaded from any facilitator`), and only the second one reads again.
   - Fix: `apps/merchant-demo/src/facilitator.ts`, `waitForFacilitator`. With payments on, `main.ts` waits until `GET <facilitator>/supported` answers 200 before it builds the app, and logs "waiting for the facilitator". Tested, and checked on the stack: merchant first, facilitator 20 s later, the first payment settles.

## For you

1. **WS7: the replay accepts a fetch that did not pay.** In that run the normal scene printed:

   ```text
   → leash_fetch GET http://localhost:4300/api/research?q=battery+range
     ✓ 500 application/json · 33 chars · free
   Summary: spent 0.06 USDC in 4 payments
   ```

   - The script expects `ok`, and `{ ok: true, status: 500, payment: null }` is `ok`. So the replay went on, and its scripted answer said "Research cost: 0.07 USDC" above a summary of 0.06.
   - Suggestion: a scripted `leash_fetch` step also records whether it paid, and the replay stops when a paid step comes back unpaid. The screen should not print `✓` for a status of 400 or more.
2. **WS4: one missed lookup empties the database.** A failed poll plus one `getTransaction(cursor) === null` starts over.
   - On localnet that is exactly right. Devnet's public RPC is a pool of nodes: one that lags a slot or two does not know a cursor that is two seconds old. At a 2 s poll in a live demo that would empty the feed and backfill, one `getTransaction` per transaction.
   - Not seen: it needs live transactions on devnet. Suggestion: start over only after the lookup misses on three polls in a row.

## Next

Devnet still waits for funded demo keys. Everything else for it is in place.
