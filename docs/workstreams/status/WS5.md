# WS5 status: Sentinel and alerts

- Session branch: `claude/compassionate-keller-5rmytv`
- Last updated: 2026-10-01
- Current build step: 1 (rules engine), **plan proposed, waiting for Parth's OK**

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

Expected storyline alerts: `approval_requested` (research agent, 1.50 USDC), `tripwire_fired` (research agent, after three blocked payments to an unknown wallet), `approval_requested` (market agent). Whether `burst_denials` also fires is question 1 below.

## Spec points that look wrong or underspecified (need Parth's call)

1. **`burst_denials` doubles the tripwire alert.** The storyline's three denials trip the tripwire, and they also meet the burst rule, so the phone buzzes twice at the same moment. **Proposal:** skip `burst_denials` when every denial in the window comes from agents that are now frozen by the tripwire. It still fires for denials across several agents, or below the tripwire's limit.
2. **`spend_spike` fires on the approved payment.** With no history, the trailing average is 0, so the owner's own approved 1.50 USDC payment counts as a spike. **Proposal:** leave payments of approved requests (`requestNonce` set) out of the spike sum. I read the rule as: the last 10 minutes' spend is above 3 × (the previous 60 minutes' spend ÷ 6), and is at least 1 USDC.
3. **`new_payee_spend`: "the payee's cap"** is the entry's `maxPerPayment`. When that is `"0"` (off), use the agent's `maxPerPayment`; when both are off, the rule doesn't apply.
4. **`allowance_low` for fixed allowances:** `AllowanceView` has no original amount for a fixed allowance. **Proposal:** recurring uses `amountPerPeriod`; fixed uses the highest `amountRemaining` Sentinel has seen. At most once per period.
5. **Which owners to watch in fixture mode.** Sentinel finds its owners with `/v1/guardians/<guardian>/owners`, so it needs the guardian's public key. The storyline's guardian (`ASsp…`) is a derived address with no keypair file, so in fixture mode there is nothing to point `SENTINEL_GUARDIAN_KEYPAIR` at. **Proposal:** an additive contract change (ADR), a new variable `SENTINEL_OWNERS` (comma-separated owner addresses, watched in addition to the guardian's). WS0 would add it to `ENV_VARS` in `config.ts`. Alternatives: `SENTINEL_GUARDIAN` (a public key only), or alerts in fixture mode only from tests.
6. **Telegram rejects `localhost` URLs in inline buttons.** With the default `SENTINEL_WEB_URL=http://localhost:3000` the whole `sendMessage` would fail. **Proposal:** URL buttons only for public `https` URLs; otherwise the links go in the message text.
7. **Escaping:** messages are sent with `parse_mode: "HTML"` only for the bold title, and every dynamic string goes through an HTML escaper (`& < >`). The tests check that labels such as `<a href=…>` and `*bold*` arrive literally.
8. **Action (Blink) URLs:** left out until Task C ships the routes. Adding them later is one function.

## Then (after the OK)

- **Step 2:** stream client (`ws`): subscribe to the owners, ping/pong, reconnect with backoff, backfill with `?after=`, dedupe by id; the console notifier. An end-to-end test against the indexer's Hono app in fixture mode (`INDEXER_REPLAY_SPEED=0`). Health endpoint on 4400. `src/env.ts` for every variable.
- **Step 3:** Telegram notifier with grammY, tested against a fake bot API (a local HTTP server via grammY's `apiRoot`); never logs the token.
- **Step 5:** README: rules table, config, the @LeashmvpBot setup, the chat id, setting Sentinel as guardian.
- **Step 4:** guardian freezes via `buildFreezeAgent` / `buildFreezePrincipal`, only when `SENTINEL_AUTOFREEZE=true` and the on-chain guardian is Sentinel's key. LiteSVM tests: a burst freezes the principal; autofreeze off sends nothing; someone else's principal is never touched.

New dependencies (to be added to `services/sentinel/package.json`): `ws`, `hono` + `@hono/node-server` (health), `pino`, `grammy`, `zod`, `@leash/contracts`, `@leash/sdk`; dev: `@leash/indexer` (end-to-end test).

## Done
- Read the brief, the contracts (§6, §7, §10, §12, §13), the storyline fixture, the indexer README and the denial reporting ADR. Plan above.

## Next
- Build step 1 once Parth approves the plan and answers the questions above.

## Open items
- Questions 1–8 above.

## Questions for other workstreams
- WS0 / architect: question 5 (`SENTINEL_OWNERS`), if Parth agrees.

## Contract changes proposed
- `SENTINEL_OWNERS` (question 5), additive. Not written yet.
