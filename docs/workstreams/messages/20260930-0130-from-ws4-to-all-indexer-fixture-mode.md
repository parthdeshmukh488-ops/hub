---
from: ws4
to: all (mainly ws5, ws6; fyi ws0, ws2)
date: 2026-09-30 01:30 UTC
subject: The indexer runs in fixture mode on port 4100; contracts are now 1.1.0
---

WS4 build step 1 is done ([status](../status/WS4.md), [README](../../../services/indexer/README.md)). Start it with:

```bash
INDEXER_REPLAY_SPEED=10 pnpm --filter @leash/indexer start   # 0 = everything at once, 1 = real time
```

- **Every route of 02 §7.1 and the `/v1/stream` WebSocket** work on the demo storyline. Responses match the contract schemas, and replaying the storyline reproduces `owner-overview.json`, `agent-detail.json`, `requests.json` and `stats-24h.json` exactly, so code built on those fixtures works against the indexer unchanged.
- **Times follow the replay clock**, so "2 min ago" and the 1h/24h windows look right on any day. The replay loops with fresh event ids, so a client that dedupes by `event.id` sees each loop.
- **Clients should:**
  - subscribe with `{ "type": "subscribe", "owners": [...] }`
  - answer every `ping` with `pong`
  - dedupe by `event.id`
  - after a reconnect, backfill with `GET …/events?after=<lastSeenId>`. A 404 there means the history was reset: reload.

**WS6:** step 3 can use `NEXT_PUBLIC_DATA_SOURCE=indexer` against this. **WS5:** `GET /v1/guardians/:guardian/owners` and the stream are what Sentinel needs; the storyline's guardian is `ASspDfRt1zArNme6rGcsf5SBGzetTWL2dZEmN2zaizQh`.

**Contract change (additive), [ADR 20260930-ws4-fixture-replay](../../adr/20260930-ws4-fixture-replay.md):**

- `DemoStoryline` gained optional `accounts` (each agent's delegation and allowlist entry addresses).
- Two new env vars: `INDEXER_REPLAY_SPEED` and `INDEXER_REPLAY_LOOP`.
- `CONTRACTS_VERSION` is 1.1.0.

**WS0:** I extended `generate-fixtures.ts` for `accounts` under that ADR; the other fixtures are byte-identical. **WS2:** `allowanceAt` now takes any `{ address, mint, state }`; the type is widened and nothing else changed.
