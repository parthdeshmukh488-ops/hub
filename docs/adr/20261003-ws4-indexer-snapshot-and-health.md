# The indexer starts from an account snapshot, starts over only after three missed cursors, and its health says whether it can make progress

- Status: Proposed (implemented, on `main`; the 02 §7.1 sentence is new)
- Date: 2026-10-03 (recorded by the architect; built in WS4's steps 2–4 and Task E)
- Workstream: WS4
- Contract change: a clarification of `/v1/health.ok` in 02-contracts. Same fields, same types.

## Context

Following devnet is not following a fresh local validator:
- an indexer that starts late, or whose backfill limit is shorter than the program's history, misses older events;
- RPC nodes behind one URL lag behind each other;
- a restarted localnet makes the stored cursor point into a chain that no longer exists.

The first implementation projected only events. It took one missing cursor to mean a foreign chain, and its `/v1/health` said `ok: true` while every poll failed.

## Decision

1. **Account snapshot.** At start, and after every start-over, the indexer reads every Leash account through the SDK:
   - principals with `fetchPrincipalViews`, then agents, payees, open requests and delegations;
   - it overwrites the projections with them ("accounts give truth"), then polls.
   - If that poll found new transactions, it takes the snapshot again, up to 5 rounds.
   - It logs `account snapshot: the projections equal the chain`.
2. **Start-over only after three missed cursors in a row** (`FOREIGN_CURSOR_MISSES`). A miss is a failed poll while the RPC answers that it does not know the cursor's transaction. One miss is often a lagging node.
3. **`/v1/health.ok` is false when the source cannot make progress**: after three failed polls in a row (`UNHEALTHY_AFTER_FAILURES`), or when the database is unreachable. The HTTP status stays 200, because the service answers.
4. **Proposed sentence for 02-contracts** (§7.1, under the `/v1/health` row; Parth merges architecture changes): "`ok` is false when the database is unreachable or the event source has failed three polls in a row; the HTTP status stays 200."

## Consequences

- The control panel shows the right agents and limits even when the indexer starts after the demo world was set up, or its backfill missed older history.
- `pnpm demo:check` can trust `ok`: it means "following the chain", not just "the process is alive".
- The snapshot reads every account of the program with `getProgramAccounts`, so the indexer's RPC must allow it. Alchemy's free tier does not.

## Alternatives considered

- **A full backfill from the program's first transaction.** Lost: slow on a public RPC, and limited by how much history the node keeps.
- **Start over on the first missed cursor.** Lost: devnet's lagging nodes made it reset the database during normal runs.
