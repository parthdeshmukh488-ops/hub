# WS5 status: Sentinel and alerts

- Session branch: `claude/compassionate-keller-5rmytv`
- Last updated: 2026-10-01
- Current build step: all five done (1–5); ready to merge

## Scope (Task A of the [work queue](../messages/20261001-1200-from-architect-to-second-account-work-queue.md))

Build steps 1, 2, 3 and 5 of [the brief](../WS5-sentinel.md), then step 4 (guardian autofreeze), which the 1200 message added.

## Plan for build step 1: the rules engine

Pure functions, no I/O, in `services/sentinel/src/rules/`:

- `evaluate(state, input, now, config) → { state, alerts: Alert[], actions: Action[] }`, per owner.
  - `input` is either a `LeashEvent` or an `AgentView`: `allowance_low` needs the allowance, and only the stream's `agent` messages carry it.
- **State** per owner: a sliding window of recent events (the longest rule window, 70 min), the agents' policies and labels, payee entries with their `PayeeAdded` time, the cooldown table, and the event ids already seen (the stream is at-least-once).
- **Alert ids** are deterministic, `${kind}:${agent ?? owner}:${firstEventId}`, so a replay or reconnect never produces a different alert for the same thing. `createdAt` = `now`.
- **Cooldown:** one alert per rule per agent per window (default 10 min, configurable). `tripwire_fired` and `approval_requested` have no cooldown: each one is a distinct event the owner must see.
- **Actions** (`freezeAgent` / `freezePrincipal`) are returned by the rules but executed only in step 4.
- **Text:** titles ≤ 80 and bodies ≤ 500 chars, plain text; every alert is checked with `AlertSchema` in the tests. Amounts are formatted with `formatUsdc` from `@leash/contracts`.
- **Config:** `sentinel.config.json` with the thresholds of the brief's table, parsed with zod; defaults in code.

Tests (Vitest):
- **The storyline snapshot:** replaying `fixtures/demo-storyline.json` gives exactly the expected alerts.
- One hand-made sequence per rule, for both sides of each threshold, plus dedup and cooldown.
- Injection-shaped labels and memos pass through as plain text (the escaping test proper is in step 3).

Expected storyline alerts: `approval_requested` (research agent, 1.50 USDC), `tripwire_fired` (research agent, after three blocked payments to an unknown wallet), `approval_requested` (market agent). `burst_denials` does not fire: its three denials all come from the agent whose tripwire fired (decision 1).

## Decisions (architect session, 2026-10-01; plan approved)

1. **Burst + tripwire:** skip `burst_denials` (the alert and its freeze action) when every denial in the window comes from one agent whose tripwire fired. Read it from `PaymentDenied.tripped`, not from `AgentFrozen`'s arrival. Denials from two or more agents still fire.
2. **Spend spike:** leave approved payments (`requestNonce !== null`) out. The rule: the last 10 min's spend > 3 × (the previous 60 min's spend ÷ 6), and ≥ 1 USDC. No warm-up hour: the 1 USDC floor is enough. Every window is computed on event time, never the wall clock, so a catch-up after a reconnect gives the same alerts as live.
3. **New payee spend:** the cap is the entry's `maxPerPayment`, else the agent's, else the rule is off. Approved payments are left out here too (the storyline's approved 1.50 is 75 % of the cap, 205 s after `PayeeAdded`).
4. **Fixed allowance:** the baseline is the highest `amountRemaining` seen (the on-chain fixed delegation stores only the remainder, 01 §8.3). Once per delegation for fixed, once per period for recurring. The README says a restart resets the baseline.
5. **Owners to watch:** no `SENTINEL_OWNERS`, no ADR. A command-line flag `--guardian <address>` keeps the production path (`GET /v1/guardians/:guardian/owners`). It is watch-only and never signs; autofreeze still needs `SENTINEL_GUARDIAN_KEYPAIR` plus the on-chain guardian check. With neither the flag nor a keypair, Sentinel exits with a clear message.
6. **Telegram links:** URL buttons only for public `https` URLs, other links in the text; send with `link_preview_options: { is_disabled: true }`.
7. **No markup at all:** no `parse_mode`; the title is bold through `entities: [{ type: "bold", offset: 0, length: title.length }]` (UTF-16 units, as Telegram counts). The `<a href=…>` / `*bold*` test stays. Untrusted text (labels, memos) is also:
   - **defanged**, because Telegram links URLs, bare domains and @names even in plain text: `://` → `[:]//`, a dot before a letter → `[.]`, `@name` → `(at)name`;
   - **stripped** of control and bidi characters (U+202A–202E, U+2066–2069), which can make an address read differently.
8. **Blinks:** the URL function is written now, tested against 02 §10's routes, behind `"actionLinks": false` in `sentinel.config.json`. Task C flips the switch without editing `services/sentinel`.
9. **Step 2's end-to-end test** uses `@leash/indexer/testing` (an in-process indexer the architect session is adding) once it reaches `main`; until then a fake indexer. Never import the indexer's internals or edit `services/indexer`.

## Then (after the OK)

- **Step 2:** `--guardian <address>` flag; stream client (`ws`): subscribe to the owners, ping/pong, reconnect with backoff, backfill with `?after=`, dedupe by id; the console notifier. An end-to-end test against `@leash/indexer/testing` (a fake indexer until it lands). Health endpoint on 4400. `src/env.ts` for every variable.
- **Step 3:** Telegram notifier with grammY, tested against a fake bot API (a local HTTP server via grammY's `apiRoot`); never logs the token.
- **Step 5:** README: rules table, config, the @LeashmvpBot setup, the chat id, setting Sentinel as guardian.
- **Step 4:** guardian freezes via `buildFreezeAgent` / `buildFreezePrincipal`, only when `SENTINEL_AUTOFREEZE=true` and the on-chain guardian is Sentinel's key. LiteSVM tests: a burst freezes the principal; autofreeze off sends nothing; someone else's principal is never touched.

New dependencies (to be added to `services/sentinel/package.json`): `ws`, `hono` + `@hono/node-server` (health), `pino`, `grammy`, `zod`, `@leash/contracts`, `@leash/sdk`; dev: `@leash/indexer` (its `testing` export, once on `main`).

## Done
- Plan approved by the architect session with the decisions above.
- **Build step 1, the rules engine** (`services/sentinel/src/rules/`, `config.ts`, `text.ts`, `links.ts`):
  - `evaluate(state, input, now, context)` is pure. Its inputs are events, agent views and allowlist snapshots.
  - All six event-driven rules (`guardian_freeze` comes with step 4).
  - Stable alert ids, dedupe by event id, cooldowns on event time.
  - `untrusted()` defangs and strips labels and memos.
  - `actionUrl()` builds the 02 §10 routes, behind `actionLinks: false`.
  - `sentinel.config.json` with zod defaults.
- 58 tests:
  - the storyline snapshot gives exactly `approval_requested`, `tripwire_fired`, `approval_requested` and no freeze;
  - the approved 1.50 is shown to matter (it would alert as `spend_spike` and `new_payee_spend` if it were not approved);
  - doubled delivery and a late catch-up give the same alerts;
  - per-rule boundaries, purity, injection text.
- New dependencies of `services/sentinel`: `@leash/contracts`, `zod` (4.6.5, the pinned version).

- **Build step 2, the service** (`src/main.ts`, `sentinel.ts`, `stream-client.ts`, `indexer-client.ts`, `env.ts`, `args.ts`, `health.ts`, `notifiers/console.ts`):
  - `--guardian <address>` (watch-only) or the address of `SENTINEL_GUARDIAN_KEYPAIR`; both must agree; with neither, Sentinel exits with a clear message.
  - Owners from `/v1/guardians/:guardian/owners`, refreshed every 30 s.
  - Per owner: a silent warm-up (views, allowlists, the newest 200 events), then the subscription, then a `?after=` backfill. On every reconnect, the backfill runs before live messages. One serial queue keeps the inputs in order.
  - The stream client answers pings, reconnects with backoff, and drops a connection silent for 50 s. An unknown cursor triggers a silent re-warm.
  - Console notifier; health on 4400 (200/503).
  - Freezes asked for are logged only (step 4).
- 82 tests (24 new): the service against a fake indexer built from the contract and fixtures (live storyline, warm-up, backfill without repeats, ping, silence, reset indexer, late owner, unreachable indexer, failing notifier, health), plus env, flags, keypair, REST client and console format.
- **Ran against the real indexer** in fixture mode (`INDEXER_REPLAY_SPEED=10`) with `--guardian`: health 200, and exactly the three storyline alerts printed.
- New dependencies of `services/sentinel`: `@solana/kit` 8.4.0 (reads the keypair's address), `pino` 10.3.1, `ws` 8.22.0; dev: `@types/ws` 8.18.2, `tsx` 4.23.15. All are the versions the other services pin.

- **Build step 3, Telegram** (`src/notifiers/telegram.ts`, `select.ts`, `scripts/telegram-test.ts`):
  - grammY's `Api`, no `parse_mode`: the title is bold through an entity (UTF-16 length).
  - `link_preview_options: { is_disabled: true }`.
  - URL buttons only for public https URLs; other links go in the text.
  - Errors carry Telegram's reason and never the token.
  - Console always; Telegram too when both variables are set; only one set stops Sentinel with a message.
  - `start`, `dev` and `telegram:test` read the repo root's `.env` with Node's `--env-file-if-exists`; no new dependency for that.
  - `pnpm --filter @leash/sentinel telegram:test` sends the three storyline alerts (for the laptop).
- 91 tests (9 new) against a fake Bot API: the exact `sendMessage` bodies, buttons vs text links, injection text, errors without the token, URL classification, notifier selection.
- New dependency: `grammy` 1.46.0 (the current release).

- **Build step 4, guardian autofreeze** (`src/guardian.ts`; `main.ts` wiring):
  - The only code that sends a transaction. It freezes only when all of these hold:
    - `SENTINEL_AUTOFREEZE=true`;
    - the keypair is loaded;
    - the principal's on-chain guardian is that key (read fresh each time);
    - the target is not frozen yet.
  - Built with `buildFreezePrincipal` / `buildFreezeAgent`, signed and paid by the guardian.
  - One attempt per request, never a retry loop. A success sends a `guardian_freeze` alert through the notifiers.
  - `SENTINEL_AUTOFREEZE=true` with only `--guardian` stops Sentinel with a message.
  - `LEASH_RPC_URL` is now read (02 §13: used by all).
- 99 tests (8 new). 7 run on the LiteSVM testbed with the real `leash.so`:
  - a burst of denials (through the rules) freezes the principal, `frozenBy` = the guardian;
  - a spike request freezes one agent (reason `guardian`);
  - autofreeze off, or no keypair: zero transactions sent;
  - a principal whose guardian is the stranger key: never touched;
  - already frozen: nothing sent;
  - a failing send: one attempt, no throw;
  - an agent not under this owner: skipped.
  The eighth checks that the loop hands the rules' freezes to the guardian and delivers its alert.
- **Build step 5, README:** the rules table, config, the Telegram bot and chat id, running it, guardian autofreeze, and how to make Sentinel the guardian.
- New dependency: `@leash/sdk` (workspace).
- Telegram set up on the laptop by Parth (2026-10-01).

- **Reviewed the architect's start-up fixes (`c66e5f1`, message 20261001-2310):** correct; 101 tests pass. Messages handled: through `20261001-2310-from-architect-to-ws5-ws1-sentinel-merged.md`.

## Next
- Parth merges `claude/compassionate-keller-5rmytv` into `main` (open a PR if wanted).
- **Laptop, on devnet:** run Sentinel with `SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json SENTINEL_AUTOFREEZE=true` beside the indexer in chain mode during the demo run.

## Open items
- `--config <relative path>` still resolves from `services/sentinel`, unlike the keypair path (repo root). Unused in the demo; align it if anyone passes `--config`.
- **Known risk, accepted by Parth:** the token of @LeashmvpBot was shown in a chat screenshot on 2026-10-01 and was not revoked. If the bot ever misbehaves, `/revoke` it in BotFather and update the laptop's `.env`.
- The service tests move to `@leash/indexer/testing` once it is on `main` (the fake indexer goes then).
- An event that happened while Sentinel was down and is older than the newest 200 at start is learned silently, not alerted (documented in the README).

## Questions for other workstreams
- None.

## Contract changes proposed
- None (`SENTINEL_OWNERS` was dropped for the `--guardian` flag).
