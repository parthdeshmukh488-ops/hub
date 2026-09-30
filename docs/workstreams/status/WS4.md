# WS4 status: Indexer and read API

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-09-30
- Current build step: 1 (API skeleton and fixture mode) done
- Messages handled: through `20260929-1900-from-ws6-to-ws0-biome-tailwind.md`

## Plan for build step 1 (as executed)

1. Hono service (`src/server.ts`, `src/main.ts`), `src/env.ts`, pino logs.
2. Drizzle + libSQL schema and a generated migration: `events` plus the projections the brief lists, `payee_entries` and `cursors`.
3. Event-sourced projections that follow the program's effects, using the SDK's window and allowance math.
4. Fixture source: paced, loopable replay of the storyline on the replay clock.
5. Every REST route and `/v1/stream`, with schema-validated tests.

## Done

- **Build step 1, complete (2026-09-30).** 42 tests: fixture parity (the API reproduces the four view fixtures exactly), paging and errors, replay timing and loops, projection edge cases, idempotent ingestion, the database guard, and the stream against a real server (subscriptions, heartbeat, slow clients, origin check).
- **Additive contract change** [ADR 20260930-ws4-fixture-replay](../../adr/20260930-ws4-fixture-replay.md), contracts 1.1.0:
  - The storyline carries `accounts` (delegations, allowlist entry addresses).
  - New `INDEXER_REPLAY_SPEED` and `INDEXER_REPLAY_LOOP`.
  - Updated the generator, `.env.example` and 02 §13–§14.
- In the SDK, `allowanceAt` now accepts any `{ address, mint, state }` (a type widening, no behaviour change), so the indexer reuses it instead of copying it.

## Next

- Step 2, chain ingestion. Needs WS1's IDL and WS2's `decodeLeashEvents`, and a machine that can reach Solana RPC (not this cloud).

## Open items

- `INDEXER_SOURCE` defaults to `fixtures` while chain mode does not exist; the contract's documented default is `chain`. Flip it in step 2.
- Fixture mode assumes a request's rent payer is the agent key (true for the SDK and the storyline). Chain mode will read it from the account.
- A replay faster than real time computes velocity and strike windows on the compressed timeline (documented in the ADR).
- `byAgent` in stats lists the owner's current agents only; payments by a closed agent still count in the totals.

## Questions for other workstreams

- None.

## Contract changes proposed

- [20260930-ws4-fixture-replay](../../adr/20260930-ws4-fixture-replay.md) (additive, status Proposed).
