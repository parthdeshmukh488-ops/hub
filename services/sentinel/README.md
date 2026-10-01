# @leash/sentinel

Sentinel watches every agent of the owners it protects. It alerts the owner the moment something matters, and, when allowed, pulls the brake with a guardian freeze. It is the off-chain safety layer on top of the on-chain tripwire.

Owned by **WS5**. Brief: [docs/workstreams/WS5-sentinel.md](../../docs/workstreams/WS5-sentinel.md). Status: [docs/workstreams/status/WS5.md](../../docs/workstreams/status/WS5.md).

## Status

**All five build steps are done:**
- the rules engine;
- the service on the indexer's stream;
- alerts on the console and Telegram;
- guardian autofreeze;
- this README.

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

Parsed in [`src/env.ts`](src/env.ts) (02 §13); a bad value stops Sentinel with a readable message. `start`, `dev` and `telegram:test` also read the repo root's `.env` if it exists; variables set in the shell win.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SENTINEL_INDEXER_URL` | `http://localhost:4100` | REST and `/v1/stream` |
| `SENTINEL_GUARDIAN_KEYPAIR` | – | Path to the guardian keypair file; a relative path is the repo root's. Gives the address to watch, and signs guardian freezes. |
| `SENTINEL_AUTOFREEZE` | `false` | Allow rule-triggered guardian freezes. Needs `SENTINEL_GUARDIAN_KEYPAIR`: `true` with only `--guardian` stops Sentinel with a message. |
| `LEASH_RPC_URL` | per cluster | The RPC that guardian freezes are read and sent through |
| `SENTINEL_WEB_URL` | `http://localhost:3000` | Links in alerts |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | – | Both set: alerts also go to Telegram. Neither: console only. Only one: Sentinel stops with a message. |
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
- **Freezes asked for** by the rules go to the guardian ([below](#guardian-autofreeze)).
- **A notifier that fails** is logged and counted (`alertsFailed`); the other notifiers still get the alert.
- **Restarts:** history is read silently at start, so a restart never repeats old alerts. An event that happened while Sentinel was down and is older than the newest 200 is not alerted.

## Telegram

The demo bot is [@LeashmvpBot](https://t.me/LeashmvpBot).

**Setting it up** (on the laptop: this cloud may not reach Telegram):
1. Get the token from @BotFather. Keep it only in the repo root's `.env` as `TELEGRAM_BOT_TOKEN`: never in a chat, a commit, a log or a screenshot. If it leaks, `/revoke` it in BotFather and use the new one.
2. Send `/start` to the bot. Open `https://api.telegram.org/bot<token>/getUpdates` and copy `result[0].message.chat.id` into `.env` as `TELEGRAM_CHAT_ID`.
3. Check with `pnpm --filter @leash/sentinel telegram:test`. It sends the three storyline alerts to that chat.

**What a message looks like** ([`src/notifiers/telegram.ts`](src/notifiers/telegram.ts)):
- An emoji for the severity (🔔 info, ⚠️ warning, 🚨 critical) and the title in bold, then the body.
- **Links:** public `https` links become buttons. Other links, like `http://localhost:3000`, go in the text, because Telegram rejects such buttons and with them the whole message.
- **Plain text:** no `parse_mode`, so no label or memo can turn into markup. The bold title is a `bold` entity (offset and length in UTF-16 units, as Telegram counts). Link previews are off.
- **Errors** name Telegram's reason (`400: Bad Request: chat not found`) and never contain the token. A failed message is logged and counted in `/health`'s `alertsFailed`; the console still gets the alert.

## Guardian autofreeze

`burst_denials` asks to freeze the principal (every agent); `spend_spike` asks to freeze the agent. [`src/guardian.ts`](src/guardian.ts) is the only code in Sentinel that sends a transaction. It sends a freeze only when **all** of these hold:
1. **`SENTINEL_AUTOFREEZE=true` and `SENTINEL_GUARDIAN_KEYPAIR` is loaded.** Otherwise it logs the request and sends nothing. This is the default.
2. **The principal's on-chain guardian is that key.** It is read fresh from the chain before every freeze. A principal whose guardian is someone else is never touched.
3. **The target is not frozen yet.** This makes freezes idempotent.

The freeze is built with the SDK (`buildFreezeAgent`, `buildFreezePrincipal`), and the guardian key signs and pays the fee. A success sends a `guardian_freeze` alert ("Sentinel froze all agents"). Each request is tried once: a failure is logged, never retried in a loop. The cooldown decides when a rule may ask again.

The guardian can freeze and reject requests, nothing else (01 §6.1). It cannot unfreeze, pay or change the policy, so a stolen guardian key can at worst freeze (03-security T14). **Only the owner unfreezes:** `pnpm owner:unfreeze`, or the web app.

### Making Sentinel the guardian

1. **The key:** `pnpm keys` creates `.keys/guardian.json` (gitignored). It needs a little SOL for fees: `pnpm devnet:check` shows the balance.
2. **Name it as the principal's guardian:**
   - `pnpm devnet:setup` creates the demo principal with `.keys/guardian` as its guardian.
   - For another principal, the owner signs `set_guardian` (the SDK's `buildSetGuardian`).
   - Check with `curl localhost:4100/v1/guardians/<guardian address>/owners`: the owner must be listed.
3. **Run with freezes allowed:**
   ```bash
   SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json SENTINEL_AUTOFREEZE=true LEASH_CLUSTER=devnet \
     pnpm --filter @leash/sentinel start
   ```
   The log says `autofreeze on: guardian freezes allowed`.

## Rules

`evaluate(state, input, now, context) → { state, alerts, actions }` is a pure function per owner ([`src/rules/evaluate.ts`](src/rules/evaluate.ts)). Its input is one of:
- an event;
- an `AgentView` (for the allowance);
- an allowlist snapshot (labels and caps after a restart).

It never does I/O. `actions` are the guardian freezes the rules ask for; the guardian decides whether to send them.

| Rule | Trigger | Severity | Freeze it asks for |
| --- | --- | --- | --- |
| `tripwire_fired` | `AgentFrozen` with reason `tripwire`; the alert names the strikes behind it | critical | – (already frozen) |
| `burst_denials` | ≥ 3 `PaymentDenied` across the owner's agents within 5 min. Quiet when they all come from one agent whose tripwire fired (`PaymentDenied.tripped`) | warning | the principal |
| `approval_requested` | `PaymentRequested` | info | – |
| `spend_spike` | an agent's spend in the last 10 min > 3 × (its spend in the 60 min before ÷ 6), and ≥ 1 USDC | warning | the agent |
| `new_payee_spend` | a payment ≥ 50 % of the payee's per-payment cap (else the agent's) within 10 min of `PayeeAdded` | warning | – |
| `allowance_low` | < 10 % of the allowance left: once per period (recurring), once per delegation (fixed) | info | – |
| `guardian_freeze` | Sentinel itself froze something (sent by the guardian, not a rule) | critical | – |

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
pnpm --filter @leash/sentinel test        # rules (storyline snapshot), the loop against a fake indexer, Telegram against a fake Bot API
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
- **Telegram** ([`test/telegram.test.ts`](test/telegram.test.ts)) runs against a fake Bot API. It checks the exact `sendMessage` body for the storyline alerts, and that only public https links become buttons. It also checks that injection-shaped labels and memos arrive literal and defanged with only our bold entity, and that errors never contain the token.
- **Guardian freezes** ([`test/guardian.test.ts`](test/guardian.test.ts)) run on the LiteSVM testbed (`@leash/sdk/testing`, the real `leash.so`), with the testbed's `keys.guardian` as guardian. They check:
  - a burst of denials freezes the principal, signed by the guardian;
  - a spike request freezes one agent;
  - with autofreeze off, or without the keypair, no transaction is ever sent;
  - a principal whose guardian is someone else is never touched;
  - an already frozen target gets no transaction;
  - a failed send is tried once and never thrown.
