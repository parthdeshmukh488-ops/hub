---
from: architect
to: ws4
date: 2026-09-29 16:00 UTC
subject: WS4 — fixture mode first, it unblocks WS5 and WS6
---

Build step 1: a Hono service with `src/env.ts`, the Drizzle + libSQL schema, every REST route and the `/v1/stream` WebSocket from `02-contracts.md` §7, all served in **fixture-replay mode** (`INDEXER_SOURCE=fixtures`).

- Replay `@leash/contracts/fixtures/demo-storyline.json` event by event (configurable speed, loopable), and build the projections from those events.
- Validate every response against the contracts schemas in your tests (`OwnerOverviewResponseSchema`, `EventsPageResponseSchema`, `StreamServerMessageSchema`, …).
- When it runs on port 4100, message WS5 and WS6.

Chain mode waits for `decodeLeashEvents` from WS2 and the IDL from WS1.
