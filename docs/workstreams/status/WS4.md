# WS4 status: Indexer and read API

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-10-02
- Current build step: 1–4 done (steps 3–4 by Task E, branch `claude/compassionate-keller-5rmytv`)
- Messages handled: through `20261001-0150-from-ws1-to-ws4-ci-fix-remembered-poke.md`

## Plan for build step 1 (as executed)

1. Hono service (`src/server.ts`, `src/main.ts`), `src/env.ts`, pino logs.
2. Drizzle + libSQL schema and a generated migration: `events` plus the projections the brief lists, `payee_entries` and `cursors`.
3. Event-sourced projections that follow the program's effects, using the SDK's window and allowance math.
4. Fixture source: paced, loopable replay of the storyline on the replay clock.
5. Every REST route and `/v1/stream`, with schema-validated tests.

## Plan for build step 2 (as executed)

1. **SDK (WS2 lane):** the chain port pages a program's transactions (`getSignatures` with `before` and `until`, plus `getTransactionRecord`), for both `rpcChain` and the LiteSVM chain. The indexer reaches Solana only through the SDK.
2. **`src/sources/chain.ts`:** poll after a stored cursor; decode with `decodeLeashEvents`; report allowlist entry PDAs before `PayeeAdded`; store; move the cursor per transaction; read the delegations of the agents touched.
3. **Store:** cursors, the known agents (principal and delegation) for restarts, and `delegationsFromEvents` off in chain mode.
4. **`main.ts`:** `INDEXER_SOURCE` picks the source, defaulting to `chain` as 02 §13 says; `LEASH_RPC_URL` is read.
5. **Tests on LiteSVM** with the real program.

## Plan for build steps 3–4 (Task E, approved by the architect session, 2026-10-02)

0. **From the PR #3 review** (`e2e/`): scene 3 waits for `tripwire_fired` with `waitFor` before checking alerts, as scene 2 does, instead of a fixed 50 ms.
1. **Account snapshot ("accounts give truth")** in chain mode, at start and right after a start-over:
   - every principal (`fetchPrincipalViews`); per owner its agents (`fetchAgentViews`); per agent its allowlist (`fetchPayees`), open requests (`fetchOpenRequests`) and delegation;
   - overwrites the projections, and removes allowlist entries, requests and agents that no longer exist on-chain.
   - **No double counting:** events after the cursor would be applied on top of a snapshot that already includes them. So the snapshot runs after a catch-up poll, then polls again, and takes a fresh snapshot whenever that poll found new transactions.
   - **Events stored before their owner was known** get their owner.
   - `snapshot()` on the chain source and in `@leash/indexer/testing`.
   - **Test:** a first start whose backfill limit misses the onboarding still lists the owner with its agents, allowlist and open requests, equal to the SDK's reads.
2. **Devnet RPC lag:** start over only after the cursor lookup misses on three polls in a row (one miss is often a lagging node). Tested both ways: two misses then a hit keep the database; three misses start over.
3. **Stats on chain data:** a chain-mode test that `/v1/owners/:owner/stats` matches the testbed's payments, denials and spend.
4. **Health:** `/v1/health` answers `ok: false` once three polls in a row failed (or the fixture replay failed), and `ok: true` again after a successful poll. HTTP 200, the contract's fields; `lagSeconds` stays honest.

## Done

- **Build steps 3–4 (Task E, 2026-10-02):**
  - **The account snapshot** (`src/sources/chain.ts`, `Store.applySnapshot`):
    - It runs after the first poll of a start and after a start-over.
    - It overwrites principals, agents, allowlist entries, open requests and delegations with the chain's accounts, and deletes what the chain no longer has. Events stored without an owner get one.
    - It then polls, and re-snapshots while new transactions arrived (at most 5 rounds), so nothing counts twice.
    - `snapshot()` is on the chain source and in `@leash/indexer/testing`; that package's first `sync()` takes the snapshot too.
  - **Start-over after three misses in a row** (`FOREIGN_CURSOR_MISSES`). A miss resets on any poll whose pages succeed or whose cursor the RPC knows.
  - **Health:** `EventSource.healthy()`. Chain mode: false after `UNHEALTHY_AFTER_FAILURES` (3) failed polls in a row, true after a success. Fixture mode: false once the replay failed. `/v1/health` keeps HTTP 200 and reports it as `ok`.
  - **Tests:** 57 (6 new):
    - the snapshot after a backfill that missed the onboarding equals the SDK's reads;
    - stale rows are removed;
    - two misses then a hit keep the database, three start over;
    - stats on chain data per window;
    - health both ways, plus the fixture failure.
  - **Two existing tests adjusted:** the start-over test now needs three misses, and the poke test counts the snapshot's settle poll.
  - **`e2e/`:** scene 3 waits for `tripwire_fired` (PR #3 review).

- **Build step 2, complete (2026-10-01).** 47 tests (5 new):
  - Every view equals the SDK's account reads: principal, agents with allowance, allowlist, open requests.
  - The owner's feed holds every event in chain order, agent-level ones included.
  - A crash between storing a transaction and saving its cursor loses and duplicates nothing, on a reopened database.
  - Paging and the backfill limit; failed and not-yet-retrievable transactions; the background loop.
  - **Design choice:** in chain mode, allowances come only from the delegation accounts. Replaying payments on top of a delegation read later would count them twice while catching up.
  - **Polling instead of `logsSubscribe`:** public devnet WebSockets drop silently (brief), and one `getSignaturesForAddress` per poll is cheap. With `INDEXER_POLL_INTERVAL_MS=2000`, the web feed is about 2 seconds behind. `poke()` is ready for a push trigger if we add one.

- **Build step 1, complete (2026-09-30).** 42 tests: fixture parity (the API reproduces the four view fixtures exactly), paging and errors, replay timing and loops, projection edge cases, idempotent ingestion, the database guard, and the stream against a real server (subscriptions, heartbeat, slow clients, origin check).
- **Additive contract change** [ADR 20260930-ws4-fixture-replay](../../adr/20260930-ws4-fixture-replay.md), contracts 1.1.0:
  - The storyline carries `accounts` (delegations, allowlist entry addresses).
  - New `INDEXER_REPLAY_SPEED` and `INDEXER_REPLAY_LOOP`.
  - Updated the generator, `.env.example` and 02 §13–§14.
- In the SDK, `allowanceAt` now accepts any `{ address, mint, state }` (a type widening, no behaviour change), so the indexer reuses it instead of copying it.

- 2026-09-30: `test/stream.test.ts` no longer depends on timing. It drives the heartbeat by hand and uses an in-order `sync()` barrier instead of sleeps. A short real ping interval once dropped the polite client on a busy CI runner (`main`, run 36701442666).

- **2026-10-01, after the laptop's real-validator run:**
  - It passed: backfill, live following and a restart, with views equal to the chain.
  - It found a stall: Agave fails `getSignaturesForAddress` when `until` names a transaction it doesn't know, which is what happens after a localnet restart with an old database. The indexer now starts over in that case (logged; `Store.startOver`, tested).
  - Its fix for a lost `poke` (`fea2387`) is kept.

- **2026-10-02, `@leash/indexer/testing`:** `startTestIndexer()` runs the real store, REST API and stream in process on a random port, fed by the storyline (optionally started after a client subscribed) or by a chain such as the LiteSVM testbed's, polled only on `sync()`. For Sentinel's end-to-end test and the e2e suite (Task D), so neither reaches into `src/`. 2 tests; 51 in total.

## Next

- **Laptop (queue item 3, now ready):** run chain mode against localnet, then devnet, with `INDEXER_POLL_INTERVAL_MS=2000`; check `devnet:smoke`'s events on `/v1/owners/<owner>/events`.
- **Laptop, devnet:** watch for `account snapshot: the projections equal the chain` at start, and for start-overs (now only after three misses in a row).
- Graceful shutdown review (not part of Task E).

## Open items

- A first start that reads fewer transactions than the program's history (`INDEXER_BACKFILL_LIMIT`) still lists every account (the snapshot), but the events before its window are not in the history.
- Fixture mode assumes a request's rent payer is the agent key (true for the SDK and the storyline). Chain mode's snapshot reads it from the account.
- A replay faster than real time computes velocity and strike windows on the compressed timeline (documented in the ADR).
- `byAgent` in stats lists the owner's current agents only; payments by a closed agent still count in the totals.

## Questions for other workstreams

- None.

## Contract changes proposed

- [20260930-ws4-fixture-replay](../../adr/20260930-ws4-fixture-replay.md) (additive, status Proposed).

