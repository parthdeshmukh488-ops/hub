# The storyline carries the account facts events lack, and fixture replay is time-shifted, paced and loopable

- Status: Proposed (additive, contracts 1.1.0)
- Date: 2026-09-30
- Workstream: WS4
- Contract change: yes (affected: WS0 fixtures, WS4, WS5, WS6)

## Context

The indexer's fixture mode must serve the same views as chain mode (02-contracts §5, §7) from `fixtures/demo-storyline.json` alone. Two facts in those views appear in no event:

- the allowance (`AgentView.allowance`): amount per period, period length, start and expiry of each agent's Subscriptions delegation. Chain mode reads the delegation account;
- the address of each allowlist entry (`PayeeView.address`), a PDA. Chain mode derives it; `PayeeAdded` only names the payee.

Replay also needs settings the environment did not have: how fast to replay and whether to loop. And the storyline's timestamps (2 Oct 2026) would read as "in 2 days" in any UI run on another day.

## Decision

1. `DemoStorylineSchema` gets an optional `accounts` field: `delegations` (each agent's delegation as created, nothing pulled yet) and `payeeEntries` (`address`, `agent`, `payee`). The generator writes it; `CONTRACTS_VERSION` becomes 1.1.0.
2. Two indexer variables: `INDEXER_REPLAY_SPEED` (`1` real time, `N` N times faster, `0` everything at once) and `INDEXER_REPLAY_LOOP` (`true`/`false`).
3. Replayed events follow the replay clock:
   - Event times map as `start + (t − t₀) / speed`, where `start` is when the loop began.
   - With speed 0 the whole storyline is shifted so its last event is "now".
   - Deadlines inside events and accounts (`expiresAt`, a delegation's expiry) keep their distance to their anchor time, so a one-hour request TTL stays one hour at any speed.
4. Looping replays the storyline with fresh signatures and event ids (derived deterministically from the loop number) and later slots. Each loop starts from empty projections; the event history keeps every loop.
5. Fixture mode owns its database. It resets it at startup and refuses a database that holds chain data.

## Consequences

- A replay at speed 0 with the original clock reproduces `owner-overview.json`, `agent-detail.json`, `requests.json` and `stats-24h.json` exactly. The indexer tests this, so the hand-written view fixtures and the projections can never drift apart.
- At speeds above 1, window counters (velocity, strikes) are computed on the compressed timeline and can differ from the original storyline. That's fine for a demo feed; it's documented.
- Consumers that parse the storyline with the 1.0.0 schema keep working (the field is optional).

## Alternatives considered

- **Derive allowances from `owner-overview.json`:** couples the replay to an output fixture and still leaves the market agent's allowlist entry address unknown.
- **Add the facts to events:** changes on-chain events (01 §9) for a fixture-only need.
- **Replay original timestamps:** relative times and 1h/24h stats windows are wrong on any day but the storyline's.
