# @leash/indexer

Turns Leash events into the read API the web app and Sentinel use: REST for views and history, and a WebSocket stream for live updates ([02-contracts §7](../../docs/architecture/02-contracts.md#7-indexer-api-servicesindexer-prefix-v1)). It only serves public on-chain data and never acts on-chain.

Owned by **WS4**. Brief: [docs/workstreams/WS4-indexer.md](../../docs/workstreams/WS4-indexer.md). Status: [docs/workstreams/status/WS4.md](../../docs/workstreams/status/WS4.md).

## Status

Build step 1 is done: every route and the stream, served in **fixture mode**, which replays the demo storyline from `@leash/contracts`. Chain mode (reading devnet or localnet) is build step 2.

## Run it

```bash
pnpm --filter @leash/indexer start                                # replay in real time (~7 min), looping
INDEXER_REPLAY_SPEED=10 pnpm --filter @leash/indexer start        # ten times faster
INDEXER_REPLAY_SPEED=0 pnpm --filter @leash/indexer start         # the whole story at once, no loop
```

It listens on `http://localhost:4100`. Try it:

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
| `INDEXER_SOURCE` | `fixtures` | `fixtures` now; `chain` arrives in step 2 |
| `INDEXER_REPLAY_SPEED` | `1` | `1` real time, `N` N times faster, `0` everything at once |
| `INDEXER_REPLAY_LOOP` | `true` | Replay again after the storyline ends |
| `WEB_ORIGIN` | `http://localhost:3000` | The only browser origin allowed (CORS and the stream) |
| `LEASH_CLUSTER`, `LEASH_PROGRAM_ID` | `localnet`, config | Reported by `/v1/health` and the stream's `hello` |
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
source (fixtures now, chain later)
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
- **Fixture replay** ([ADR 20260930-ws4-fixture-replay](../../docs/adr/20260930-ws4-fixture-replay.md)):
  - Times follow the replay clock; deadlines keep their duration.
  - Every loop gets fresh signatures and ids and starts from empty projections.
  - Fixture mode resets its database at startup and refuses a database holding chain data.
- **Ordering:** by slot, then ingestion order; cursors are event ids. Indexes: `events(owner, slot, seq)`, `events(agent, slot, seq)`, `events(owner, timestamp)` for stats.

## Develop

```bash
pnpm --filter @leash/indexer test          # 42 tests, including fixture parity and a real WebSocket
pnpm --filter @leash/indexer typecheck
pnpm --filter @leash/indexer lint
pnpm --filter @leash/indexer db:generate   # after changing src/db/schema.ts; commit drizzle/
```

The parity test replays the storyline and checks that the API returns exactly `owner-overview.json`, `agent-detail.json`, `requests.json` and `stats-24h.json`.
