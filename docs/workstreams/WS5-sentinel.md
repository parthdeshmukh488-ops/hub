# WS5: Sentinel and alerts (`services/sentinel`)

## Mission

Watch every agent, tell the owner the moment something matters, and pull the brake when the owner allowed it. Sentinel is the second, off-chain safety layer on top of the on-chain tripwire, and the reason the owner's phone buzzes during the demo.

## Read first

[00-overview §5.3–§5.5](../architecture/00-overview.md#53-a-manipulated-agent-is-stopped-blocked-attempt-and-tripwire) · [02-contracts §7, §10, §12](../architecture/02-contracts.md#12-alerts-servicessentinel) · [01-onchain-program §6.1](../architecture/01-onchain-program.md#61-owner-and-guardian-instructions) (guardian rights) · [03-security](../architecture/03-security.md) (T14, T18) · [04-conventions](../architecture/04-conventions.md)

## You own

`services/sentinel/`

## You consume and provide

| Consumes | Provides |
| --- | --- |
| Indexer REST and WebSocket (`/v1/guardians/:guardian/owners`, `/v1/stream`), `@leash/sdk` (guardian freeze builders), `@leash/contracts` (`Alert`, events) | Alerts (Telegram and console) and, when enabled, guardian freezes |

## Design notes

- **Rules engine = pure functions.** `evaluate(state, event, now) → { state, alerts: Alert[], actions: Action[] }` per owner, over a sliding window of recent events. No I/O inside rules, so every rule is unit-tested with fixture event sequences.
- **Initial rules** (thresholds configurable in `sentinel.config.json`):

  | Rule | Trigger | Severity | Action if autofreeze is on |
  | --- | --- | --- | --- |
  | `tripwire_fired` | `AgentFrozen` with reason `tripwire` | critical | – (already frozen) |
  | `burst_denials` | ≥ 3 `PaymentDenied` across an owner's agents within 5 min; not when they all come from one agent whose tripwire fired ([ADR](../adr/20261003-ws5-sentinel-rule-refinements.md)) | warning | freeze the principal |
  | `approval_requested` | `PaymentRequested` | info | – |
  | `spend_spike` | spend in 10 min > 3× the trailing hourly average (and ≥ 1 USDC); payments of approved requests not counted | warning | freeze the agent |
  | `new_payee_spend` | payment ≥ 50% of a payee's cap within 10 min of `PayeeAdded`; payments of approved requests not counted | warning | – |
  | `allowance_low` | remaining allowance < 10% | info | – |
  | `guardian_freeze` | Sentinel itself froze something | critical | – |

- **Actions:** guardian freezes through the SDK builders, signed with `SENTINEL_GUARDIAN_KEYPAIR`, only when `SENTINEL_AUTOFREEZE=true` **and** the principal's on-chain guardian equals Sentinel's key. Idempotent; never retried in a loop.
- **Notifiers:** a `Notifier` interface with `console` (dev) and `telegram` (grammY) implementations. Telegram messages: a short title, one or two sentences, and buttons/links to the web app page (`/app/agents/<agent>`) and to the Solana Action URLs (freeze, approve, reject; 02 §10). Escape every user- or agent-controlled string (labels, memos).
- **Deduplication:** one alert per rule per agent per cooldown window. Alerts carry `eventIds`.
- **Resilience:** reconnect to the indexer with backoff, backfill with `after` cursors, a health endpoint on 4400.

## Build order (quality gates)

1. **Rules engine.** Pure rules and state with tests driven by the demo storyline fixture and hand-made sequences.
2. **Stream client and console notifier.** Runs against the indexer's fixture mode end to end.
3. **Telegram notifier.** Formatting, escaping, links. A test with a fake bot API.
4. **Guardian actions.** Freeze via SDK, guarded by the on-chain guardian check and the env flag. LiteSVM or localnet test.
5. **Docs.** README: rules table, config, how to create a Telegram bot and get the chat id, how to set Sentinel as guardian.

## Definition of done (in addition to the general one)

- Replaying the demo storyline fixture produces exactly the expected alerts (a snapshot test).
- With autofreeze off, Sentinel never sends a transaction.
- No alert text can inject Telegram markup (tested).

## Pitfalls

- The guardian can freeze but never unfreeze. Don't build UI flows that assume otherwise.
- Alert fatigue kills the demo. Keep messages short, and let the cooldowns work.

## Starter prompt

```text
You are the WS5 (Sentinel and alerts) engineer on Leash, a spending firewall for AI agents on Solana.

Before anything else:
1. Merge the latest main into your branch.
2. Read CLAUDE.md, docs/architecture/00-overview.md, docs/workstreams/WS5-sentinel.md and every document its "Read first" section lists.
3. Read docs/workstreams/status/WS5.md (create it from docs/workstreams/status/README.md if missing) and any ADRs newer than it. Then read docs/workstreams/BOARD.md and every file in docs/workstreams/messages/ addressed to ws5 or to all.

Then tell me in a short message: what you understand your job to be, which build step you will do now, your plan for it, and anything in the spec that looks wrong or underspecified. Wait for my OK before writing code.

Rules: only edit services/sentinel and your status file; follow docs/architecture/04-conventions.md; contract changes go through an ADR; end every work block by updating your status file, committing and pushing.
```
