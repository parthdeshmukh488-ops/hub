# @leash/indexer

Turns Leash events into the read API the web app and Sentinel use: REST for views and history, and a WebSocket stream for live updates ([02-contracts §7](../../docs/architecture/02-contracts.md#7-indexer-api-servicesindexer-prefix-v1)). It only serves public on-chain data and never acts on-chain.

Owned by **WS4**. Brief: [docs/workstreams/WS4-indexer.md](../../docs/workstreams/WS4-indexer.md). Status: [docs/workstreams/status/WS4.md](../../docs/workstreams/status/WS4.md).

## Status

Build steps 1–2 are done:
- every route and the stream;
- **chain mode**, which follows the Leash program on localnet or devnet;
- **fixture mode**, which replays the demo storyline from `@leash/contracts` with no chain at all.

Next: build step 3 (stats from chain data), then reconciliation (step 4).

## Run it

**Chain mode** (the default) needs an RPC. It reads the program's transactions after its stored cursor, so a restart loses nothing and duplicates nothing.

```bash
pnpm --filter @leash/indexer start                                          # localnet (http://127.0.0.1:8899)
LEASH_CLUSTER=devnet INDEXER_POLL_INTERVAL_MS=2000 pnpm --filter @leash/indexer start
```

It polls every `INDEXER_POLL_INTERVAL_MS`, 15 s by default. For a live demo use 2 000, so a payment shows up in the web feed within about 2 seconds; that is one cheap `getSignaturesForAddress` call per poll. Use a database per cluster (`INDEXER_DB_URL`); a chain database refuses fixture mode and vice versa.

**Fixture mode** needs nothing:

```bash
INDEXER_SOURCE=fixtures pnpm --filter @leash/indexer start                          # replay in real time (~7 min), looping
INDEXER_SOURCE=fixtures INDEXER_REPLAY_SPEED=10 pnpm --filter @leash/indexer start  # ten times faster
INDEXER_SOURCE=fixtures INDEXER_REPLAY_SPEED=0 pnpm --filter @leash/indexer start   # the whole story at once, no loop
```

It listens on `http://localhost:4100`. Try it (fixture mode's owner shown; in chain mode use your owner wallet):

```bash
OWNER=H1Gk6MBearXpAg4aMH4oNJ3suHrseqYkgBu7iuxmJe3N          # the storyline's owner
curl localhost:4100/v1/health
curl localhost:4100/v1/owners/$OWNER
curl "localhost:4100/v1/owners/$OWNER/events?types=PaymentDenied&limit=5"
curl "localhost:4100/v1/owners/$OWNER/stats?window=24h"
```

## Environment

Parsed in [`src/env.ts`](src/env.ts); invalid values stop the service with a readable message.

| Variable | Default | Meaning |
| --- | --- | --- |
| `INDEXER_PORT` | `4100` | HTTP and WebSocket port |
| `INDEXER_DB_URL` | `file:./data/indexer.db` | libSQL database (created if missing) |
| `INDEXER_SOURCE` | `chain` | `chain`, or `fixtures` to replay the storyline without a chain |
| `LEASH_RPC_URL` | per cluster | Chain mode's RPC (e.g. a Helius devnet URL) |
| `INDEXER_POLL_INTERVAL_MS` | `15000` | Chain mode: how often to look for new transactions (2000 for a live demo) |
| `INDEXER_BACKFILL_LIMIT` | `1000` | Chain mode: transactions read on a first start (the newest ones) |
| `INDEXER_REPLAY_SPEED` | `1` | `1` real time, `N` N times faster, `0` everything at once |
| `INDEXER_REPLAY_LOOP` | `true` | Replay again after the storyline ends |
| `WEB_ORIGIN` | `http://localhost:3000` | The only browser origin allowed (CORS and the stream) |
| `LEASH_CLUSTER`, `LEASH_PROGRAM_ID` | `localnet`, config | The cluster and program followed; reported by `/v1/health` and the stream's `hello` |
| `LOG_LEVEL` | `info` | pino level |

## API

| Route | Response |
| --- | --- |
| `GET /v1/health` | `{ ok, cluster, programId, lastProcessedSlot, lastEventAt, lagSeconds }` |
| `GET /v1/owners/:owner` | `{ principal, agents }` (an owner without a principal gets `{ principal: null, agents: [] }`) |
| `GET /v1/agents/:agent` | `{ agent, payees, requests }`, 404 if unknown |
| `GET /v1/owners/:owner/events`, `GET /v1/agents/:agent/events` | `{ items, nextBefore }`. `?types=A,B`, `?agent=` (owner route), `?limit=` (≤ 200), `?before=<id>` (newest first) or `?after=<id>` (oldest first, for gaps). An unknown cursor is a 404: reload instead of trusting the gap. |
| `GET /v1/owners/:owner/requests?status=pending\|approved` | `{ items }` (open requests) |
| `GET /v1/owners/:owner/stats?window=1h\|24h\|7d` | `StatsView`, summed with bigint |
| `GET /v1/guardians/:guardian/owners` | `{ owners }` (for Sentinel) |
| `GET /v1/stream` (WebSocket) | `hello`, then `event` and `agent` messages for the owners you `subscribe` to; `ping` every 20 s, answer `pong` or be dropped. Slow clients are closed with code 1013. |

Errors are `{ "error": { "code": "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL", "message" } }`. Every response is checked against the `@leash/contracts` schemas in the tests.

## How it works

```text
source: chain (the Leash program via the SDK) or fixtures (the storyline)
  │  accounts(facts) · events(batch) · resetProjections()
  ▼
pipeline ── one delivery at a time ──► store (Drizzle + libSQL)
  │                                     ├─ events        history, idempotent by id
  │                                     └─ projections   principals, agents, payees, requests,
  │                                                      allowances, payee_entries
  └─► stream hub ── event / agent messages per owner ──► WebSocket clients
```

- **Projections** ([`src/projection/project.ts`](src/projection/project.ts)) apply each event the way the program changes its accounts (01 §6, §7.2), using the SDK's window and allowance math. Each event and its projection changes are written in one atomic batch.
- **Allowances** are stored as delegation state; the `AllowanceView` is computed at read time with the SDK's `allowanceAt`, because what remains changes as periods roll.
- **Chain mode** ([`src/sources/chain.ts`](src/sources/chain.ts)):
  - Each poll pages the program's signatures after the cursor (`getSignatures` on the SDK's chain port), oldest first.
  - Each transaction goes through `getTransactionRecord`, then `decodeLeashEvents`, and is stored. Then the cursor moves.
  - Failed transactions only move the cursor.
  - A transaction listed but not retrievable yet stops the poll; the next poll starts from it.
  - Allowlist entry addresses (PDAs) are reported before their `PayeeAdded`.
  - Delegations are read from the accounts after payments ("accounts give truth"), never derived from events, so nothing counts twice while catching up.
  - Agent-level events get their principal from the `AgentCreated` the source saw, or, after a restart, from the agents in the database.
  - At start, the delegations of the known agents are re-read.
  - `lagSeconds` is the time since the source last knew it had every transaction.
- **Fixture replay** ([ADR 20260930-ws4-fixture-replay](../../docs/adr/20260930-ws4-fixture-replay.md)):
  - Times follow the replay clock; deadlines keep their duration.
  - Every loop gets fresh signatures and ids and starts from empty projections.
  - Fixture mode resets its database at startup and refuses a database holding chain data.
- **Ordering:** by slot, then ingestion order; cursors are event ids. Indexes: `events(owner, slot, seq)`, `events(agent, slot, seq)`, `events(owner, timestamp)` for stats.

## Develop

```bash
pnpm --filter @leash/indexer test          # 47 tests: fixture parity, chain mode on LiteSVM, a real WebSocket
pnpm --filter @leash/indexer typecheck
pnpm --filter @leash/indexer lint
pnpm --filter @leash/indexer db:generate   # after changing src/db/schema.ts; commit drizzle/
```

- **Fixture parity:** replays the storyline and checks that the API returns exactly `owner-overview.json`, `agent-detail.json`, `requests.json` and `stats-24h.json`.
- **Chain mode** ([`test/chain.test.ts`](test/chain.test.ts)) runs on the real `leash.so` in LiteSVM, through the SDK's chain port:
  - Every view equals what the SDK reads from the accounts.
  - A crash between storing and saving the cursor loses and duplicates nothing.
  - Paging and the backfill limit; failed and not-yet-retrievable transactions; the background loop (start, `poke`, failures, stop).
