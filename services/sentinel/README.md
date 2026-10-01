# @leash/sentinel

Sentinel watches every agent of the owners it protects. It alerts the owner the moment something matters, and, when allowed, pulls the brake with a guardian freeze. It is the off-chain safety layer on top of the on-chain tripwire.

Owned by **WS5**. Brief: [docs/workstreams/WS5-sentinel.md](../../docs/workstreams/WS5-sentinel.md). Status: [docs/workstreams/status/WS5.md](../../docs/workstreams/status/WS5.md).

## Status

**Build steps 1–2 are done:** the rules engine, and the service that runs it on the indexer's stream with console alerts. Next:
- step 3: Telegram;
- step 4: guardian autofreeze;
- step 5: the full README (running it, the Telegram bot, setting Sentinel as guardian).

## Run it

Sentinel needs the indexer (`SENTINEL_INDEXER_URL`, default `http://localhost:4100`) and to know whose principals to watch:

```bash
# The demo storyline, with no chain: the indexer replays it at 10× speed, Sentinel prints the alerts.
INDEXER_SOURCE=fixtures INDEXER_REPLAY_SPEED=10 pnpm --filter @leash/indexer start
pnpm --filter @leash/sentinel start -- --guardian ASspDfRt1zArNme6rGcsf5SBGzetTWL2dZEmN2zaizQh

# A real chain: watch the principals whose guardian is your guardian key.
SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json pnpm --filter @leash/sentinel start
```

| Flag | Meaning |
| --- | --- |
| `--guardian <address>` | Watch the principals whose guardian is this address. Watch-only: it never signs. Must match `SENTINEL_GUARDIAN_KEYPAIR` if both are given. With neither, Sentinel exits with a message. |
| `--config <path>` | Thresholds file (default: `sentinel.config.json` in this package) |

`curl localhost:4400/health` answers 200 while Sentinel is connected to the indexer with its owners loaded, else 503:
`{ ok, connected, guardian, owners, lastEventAt, alertsSent, alertsFailed }`.

### Environment

Parsed in [`src/env.ts`](src/env.ts) (02 §13); a bad value stops Sentinel with a readable message.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SENTINEL_INDEXER_URL` | `http://localhost:4100` | REST and `/v1/stream` |
| `SENTINEL_GUARDIAN_KEYPAIR` | – | Path to the guardian keypair file. Gives the address to watch; freezes need it (step 4). |
| `SENTINEL_AUTOFREEZE` | `false` | Allow rule-triggered guardian freezes (step 4; until then, only a warning) |
| `SENTINEL_WEB_URL` | `http://localhost:3000` | Links in alerts |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | – | Step 3; alerts go to the console until then |
| `LEASH_CLUSTER`, `LOG_LEVEL` | `localnet`, `info` | |

## How it works

```text
GET /v1/guardians/<guardian>/owners   (every 30 s: principals that named this guardian later join)
  │ per owner, in one serial queue:
  ├─ warm-up: GET /v1/owners/<owner>, /v1/agents/<agent> (allowlists), the newest 200 events
  │          → fed to the rules silently: the past sets windows, labels and dedupe, but never alerts
  ├─ subscribe on /v1/stream
  └─ backfill: GET …/events?after=<cursor> → alerts
/v1/stream: event and agent messages → rules → alerts → notifiers
            reconnect with backoff (0.5 s … 30 s); on every reconnect, backfill each owner first
```

- **One queue** for every input, so the rules see them in order. Live messages that arrive during a backfill wait behind it; duplicates are dropped by event id.
- **Silence** (no message for 50 s; the indexer pings every 20 s) counts as a dead connection: Sentinel drops it and reconnects.
- **An unknown cursor** (the indexer's database was reset) means a fresh, silent warm-up.
- **Freezes asked for** by the rules are only logged until step 4.
- **A notifier that fails** is logged and counted (`alertsFailed`); the other notifiers still get the alert.
- **Restarts:** history is read silently at start, so a restart never repeats old alerts. An event that happened while Sentinel was down and is older than the newest 200 is not alerted.

## Rules

`evaluate(state, input, now, context) → { state, alerts, actions }` is a pure function per owner ([`src/rules/evaluate.ts`](src/rules/evaluate.ts)). Its input is one of:
- an event;
- an `AgentView` (for the allowance);
- an allowlist snapshot (labels and caps after a restart).

It never does I/O. `actions` are the guardian freezes the rules ask for; nothing executes them before build step 4, and then only with autofreeze allowed.

| Rule | Trigger | Severity | Freeze it asks for |
| --- | --- | --- | --- |
| `tripwire_fired` | `AgentFrozen` with reason `tripwire`; the alert names the strikes behind it | critical | – (already frozen) |
| `burst_denials` | ≥ 3 `PaymentDenied` across the owner's agents within 5 min. Quiet when they all come from one agent whose tripwire fired (`PaymentDenied.tripped`) | warning | the principal |
| `approval_requested` | `PaymentRequested` | info | – |
| `spend_spike` | an agent's spend in the last 10 min > 3 × (its spend in the 60 min before ÷ 6), and ≥ 1 USDC | warning | the agent |
| `new_payee_spend` | a payment ≥ 50 % of the payee's per-payment cap (else the agent's) within 10 min of `PayeeAdded` | warning | – |
| `allowance_low` | < 10 % of the allowance left: once per period (recurring), once per delegation (fixed) | info | – |
| `guardian_freeze` | Sentinel itself froze something (build step 4) | critical | – |

How the engine behaves:
- **Payments of approved requests** count for neither `spend_spike` nor `new_payee_spend`: the owner chose them.
- **Event time, not the wall clock**, for every window and cooldown. A catch-up after a reconnect therefore gives the same alerts as following live; `now` only stamps `createdAt`.
- **Idempotent:**
  - An event seen before changes nothing (the stream is at-least-once).
  - Alert ids are stable: `<kind>:<agent or owner>:<triggering event id>`.
- **Cooldown:** one alert per rule per agent (per owner for `burst_denials`) within `cooldownSecs`. Approvals and tripwires always alert.
- **Fixed allowances:** the on-chain delegation stores only what remains, so the baseline is the highest remainder Sentinel has seen. **A restart resets that baseline.**

## Untrusted text

Labels and memos are written by owners and agents, and a manipulated agent writes the memo of a payment request. Every one goes through `untrusted()` ([`src/text.ts`](src/text.ts)) before it reaches an alert:
- **Removed:** bidi overrides and isolates (U+202A–202E, U+2066–2069) and other invisible characters.
- **Turned into spaces:** line breaks and control characters.
- **Defanged:** what chat apps turn into tap targets even in plain text: `://` → `[:]//`, a dot before a letter → `[.]`, `@name` → `(at)name`.

Markup characters stay literal: notifiers send plain text, never a parse mode. Titles are clipped to 80 characters and bodies to 500 (02 §12).

## Config

`sentinel.config.json` holds the thresholds; the committed file equals the defaults in [`src/config.ts`](src/config.ts). A file only needs the fields it changes. Unknown keys are rejected.

| Field | Default | Meaning |
| --- | --- | --- |
| `cooldownSecs` | `600` | Per-rule cooldown |
| `actionLinks` | `false` | Add Solana Action (Blink) links (approve, reject, freeze, freeze all) to alerts. Turn on once `apps/web` serves the routes of 02 §10. |
| `rules.<rule>.enabled` | `true` | Switch one rule off |
| `rules.burstDenials` | `minDenials: 3`, `windowSecs: 300` | |
| `rules.spendSpike` | `windowSecs: 600`, `baselineSecs: 3600`, `multiplier: 3`, `minAmount: "1000000"` | `minAmount` in base units |
| `rules.newPayeeSpend` | `windowSecs: 600`, `capPercent: 50` | |
| `rules.allowanceLow` | `remainingPercent: 10` | |

## Develop

```bash
pnpm --filter @leash/sentinel test        # rules (storyline snapshot), the loop against a fake indexer
pnpm --filter @leash/sentinel typecheck
pnpm --filter @leash/sentinel lint
```

- **The storyline test** replays `fixtures/demo-storyline.json` and expects exactly these alerts, snapshotted in `test/__snapshots__/`:
  - `approval_requested` (Research Assistant);
  - `tripwire_fired` (Research Assistant);
  - `approval_requested` (Market Watcher).
- **Other tests:** one per rule, on both sides of each threshold, plus dedupe, cooldowns, purity, event-time catch-up and injection-shaped labels and memos.
- **The service** ([`test/sentinel.test.ts`](test/sentinel.test.ts)) runs against a fake indexer, built only from the contract and its fixtures. It moves to `@leash/indexer/testing` once that is on `main`. It checks:
  - the live storyline;
  - the silent warm-up;
  - a backfill after a dropped connection, without repeats;
  - ping/pong and silence;
  - a reset indexer;
  - late owners;
  - an unreachable indexer at start;
  - a failing notifier;
  - the health endpoint.
