# WS4: Indexer and read API (`services/indexer`)

## Mission

Turn on-chain events into a fast, reliable, real-time read model for the web app and Sentinel. The live activity feed ("blocked: tried to pay 25 USDC to an unknown address") is the most visual part of the demo, and it runs on this service.

## Read first

[02-contracts §5–§7](../architecture/02-contracts.md#5-views-indexer-and-sdk-read-models) (views, events, API: your contract) · [01-onchain-program §9](../architecture/01-onchain-program.md#9-events) · [00-overview](../architecture/00-overview.md) · [03-security](../architecture/03-security.md) (T13) · [04-conventions](../architecture/04-conventions.md) · [ADR-0006](../adr/0006-monorepo-and-service-stack.md)

## You own

`services/indexer/`

## You consume and provide

| Consumes | Provides |
| --- | --- |
| `@leash/sdk` (`decodeLeashEvents`, view decoders, `allowanceAt`), `@leash/contracts`, Solana RPC and WebSocket | REST and WebSocket API exactly as in 02 §7; **fixture replay mode** |

## Design notes

- **Sources**, behind one interface `EventSource`, selected by `INDEXER_SOURCE`:
  - `chain`: `logsSubscribe` (mentions the Leash program ID) for low latency. For each signature, `getTransaction` (v0, `confirmed`), decode with the SDK. On startup and every `INDEXER_POLL_INTERVAL_MS`, backfill with `getSignaturesForAddress` until the last processed signature, which covers WebSocket gaps.
  - `fixtures`: replays `packages/contracts/fixtures/demo-storyline.json` on a timer (speed configurable, loopable). **Build this first.** It lets WS5 and WS6 work without any chain.
- **Storage** (Drizzle + libSQL, the only writer):
  - `events` (id PK = `signature:innerIndex`, type, signature, slot, block_time, timestamp, owner, principal, agent, payload JSON). Inserts are idempotent.
  - Projections: `principals`, `agents`, `payees`, `requests`, `allowances`. Updated in the same database transaction as the event insert.
  - `cursors` (source, last signature, last slot).
- **Reconciliation:** events give history; accounts give truth. Every few minutes, and after every event for that agent, re-read the affected accounts (`getMultipleAccounts`) and overwrite the projections. `getProgramAccounts` with a `memcmp` on `owner` rebuilds everything for an owner on demand.
- **Allowances:** read the agent's Subscriptions delegation after every `PaymentExecuted` and on a timer, and compute `AllowanceView` with `allowanceAt(now)`. Remaining allowance changes with time as periods roll.
- **API:** Hono. Every response is validated against the `@leash/contracts` schema in tests. WebSocket hub: per-owner subscription sets, a heartbeat, backpressure (drop slow clients with an error message).
- **Stats:** computed from `events` with SQL over the window (1h, 24h, 7d). Fine at demo scale; document the indexes.

## Build order (quality gates)

1. **API skeleton and fixture mode.** Hono service, env, health, DB schema and migrations, fixture source, every REST route and the WebSocket stream serving fixture data, response-schema tests. *Unblocks WS5 and WS6.*
2. **Chain ingestion.** Chain source on localnet: subscribe, backfill, decode, projections. Tests with recorded transactions (from LiteSVM or localnet) as fixtures.
3. **Allowances and stats.** Delegation snapshots, `AllowanceView`, `StatsView`.
4. **Robustness.** Reconciliation, reconnect handling, `after` cursors for gap filling, lag metric in `/v1/health`, graceful shutdown.
5. **Docs.** README: architecture sketch, how to run in each mode, API examples with `curl`.

## Definition of done (in addition to the general one)

- The web app can be built entirely against fixture mode, and switched to chain mode with one env var.
- Killing and restarting the indexer loses no events and duplicates none (test it).
- `/v1/health` reports lag honestly.

## Pitfalls

- Public devnet WebSockets drop silently. The backfill loop is not optional.
- Don't parse event bytes yourself: `decodeLeashEvents` from the SDK is the single decoder.
- The indexer is not a security boundary (T13). Never add endpoints that act on-chain.

## Starter prompt

```text
You are the WS4 (Indexer and read API) engineer on Leash, a spending firewall for AI agents on Solana.

Before anything else:
1. Merge the latest main into your branch.
2. Read CLAUDE.md, docs/architecture/00-overview.md, docs/workstreams/WS4-indexer.md and every document its "Read first" section lists.
3. Read docs/workstreams/status/WS4.md (create it from docs/workstreams/status/README.md if missing) and any ADRs newer than it. Then read docs/workstreams/BOARD.md and every file in docs/workstreams/messages/ addressed to ws4 or to all.

Then tell me in a short message: what you understand your job to be, which build step you will do now (fixture mode first), your plan for it, and anything in the spec that looks wrong or underspecified. Wait for my OK before writing code.

Rules: only edit services/indexer and your status file; follow docs/architecture/04-conventions.md; contract changes go through an ADR; end every work block by updating your status file, committing and pushing.
```
