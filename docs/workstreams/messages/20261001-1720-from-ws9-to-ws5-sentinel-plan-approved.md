---
from: ws9 (second account, cloud)
to: ws5 (the fresh Task A session)
date: 2026-10-01 17:20 UTC
subject: your plan is already approved: Sentinel, build steps 1–3 and 5, then 4
---

The WS9 session read Task A's documents and proposed this plan. Parth approved it on Oct 1, including the two gap-fillers, through the architect's reply. Start building after your own reading; don't re-plan from scratch. Write it into `status/WS5.md` as your first commit.

Scope: [Task A](20261001-0400-from-architect-to-ws5-ws9-second-account-tasks.md), with step 4 added by the [work queue](20261001-1200-from-architect-to-second-account-work-queue.md). Lane: `services/sentinel/` and `status/WS5.md`. Branch: the one your session was created with; open a pull request into `main` when a step's tests pass.

## Facts already checked

| Fact | Where |
| --- | --- |
| The stack | Hono on `@hono/node-server`, pino, zod, grammY **1.46.0** (ADR-0006 pins 1.46). Every service has `src/env.ts`, `src/server.ts` and `/health`. |
| The health port | 4400 (02 §2.4) |
| The env vars | `SENTINEL_INDEXER_URL`, `SENTINEL_GUARDIAN_KEYPAIR`, `SENTINEL_AUTOFREEZE` (default `false`), `SENTINEL_WEB_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (alerts are only logged if unset). All are already in `ENV_VARS`, so there is no contract change. |
| Which owners Sentinel watches | `GET /v1/guardians/:guardian/owners`. `pnpm devnet:setup` makes `.keys/guardian` the guardian, so on devnet Sentinel uses `SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json`. |
| The storyline's guardian | `ASspDfRt1zArNme6rGcsf5SBGzetTWL2dZEmN2zaizQh`. It is a hashed placeholder with **no private key**: to follow the indexer's fixture replay, Sentinel needs a `--guardian <address>` flag. Flags are not env vars, so there is no contract change. |
| Owner-approved payments | `PaymentExecuted.requestNonce` is set when the payment used an approved request. |
| A tripwire freeze | `PaymentDenied.tripped` is true on the attempt that froze the agent, and `AgentFrozen` (reason `tripwire`) follows in the same transaction. |
| The guardian's builders | `buildFreezeAgent({ authority, owner, agent })` and `buildFreezePrincipal({ authority, owner })` in `@leash/sdk`. `fetchPrincipalView` gives the on-chain guardian. The LiteSVM testbed's guardian is `keys.guardian`. |

The storyline's timeline, in seconds after the start:
- 40 and 70: `PayeeAdded`;
- 120–170: four small payments;
- 200: `PaymentRequested` (1.50);
- 245: the approved 1.50 payment;
- 300, 310 and 320: three `PaymentDenied` (`payeeNotAllowed`, strikes 1–3; the third is `tripped`);
- 320: `AgentFrozen` (tripwire);
- 400: a second `PaymentRequested`, from Market Watcher.

## The approved plan

1. **The rules engine.**
   - Pure functions: `evaluate(state, event, now) → { state, alerts, actions }` per owner, with no I/O.
   - The brief's seven rules, with thresholds in `sentinel.config.json` (zod).
   - Alert ids are deterministic and `createdAt` is the event's time, so snapshots stay stable.
   - Dedupe: one alert per rule per agent per cooldown (10 minutes by default).
   - **Gap-filler 1:** owner-approved payments (`requestNonce` set) don't count toward `spend_spike` or `new_payee_spend`. Otherwise approving the 1.50 report fires two warnings right after the owner approved it.
   - **Gap-filler 2:** `spend_spike` needs a baseline: at least an hour of payment history. Otherwise the first larger legitimate payment always looks like a spike.
   - **The snapshot test on the storyline:** `approval_requested` ×2 (200 and 400), `burst_denials` (320), `tripwire_fired` (320), and nothing else.
2. **The stream client and console notifier.**
   - Owners come from the guardian route, refreshed every minute.
   - `/v1/stream`: subscribe, answer pings, dedupe by `event.id`, backfill with `?after=` after a reconnect (a 404 means the history was reset), reconnect with backoff.
   - Agent views come from REST and the `agent` messages (for `allowance_low`).
   - The console notifier strips control characters from untrusted text.
   - `/health` on 4400.
   - Tests use a fake indexer (HTTP and WebSocket in process). The status file also records a real run against `INDEXER_SOURCE=fixtures` with `--guardian ASspDf…`.
3. **The Telegram notifier.**
   - grammY's `Api` with a configurable `apiRoot`, so the tests run against a fake Bot API.
   - **Plain text, no `parse_mode`;** the title is bold through a message entity over the trusted part only. Labels and memos therefore can't inject markup by construction. A test sends hostile labels (`<b>`, `*x*`, `[a](https://evil)`) and checks that they arrive literally.
   - **Links:** Telegram rejects `localhost` URLs on inline buttons. Links become buttons only for public `https` URLs, and plain text lines otherwise.
   - Solana Action (Blink) URLs are Task C: leave them out.
5. **The README:**
   - the rules table and the config;
   - the env vars;
   - @LeashmvpBot: `/start`, then the chat id from `getUpdates`;
   - setting Sentinel as guardian (`devnet:setup` already does);
   - running it against fixture mode and against a chain.
4. **Guardian autofreeze, last.**
   - `burst_denials` → `freeze_principal`; `spend_spike` → `freeze_agent`.
   - **Only when `SENTINEL_AUTOFREEZE=true` and** the principal's on-chain guardian is Sentinel's key (read through `@leash/sdk`, on `LEASH_RPC_URL`).
   - Skip if it is already frozen. One attempt per alert, never retried in a loop. On success, a `guardian_freeze` alert.
   - Tests on the LiteSVM testbed: a burst freezes the principal; with autofreeze off no transaction is ever sent (a spy on the chain); a principal with another guardian is never touched.
   - **Keep autofreeze off for the pitch.** With it on, Sentinel would also freeze all the owner's agents right after the tripwire, which adds a second freeze to the story.

**Dependencies** for `services/sentinel/package.json`, at the indexer's pinned versions: `@leash/contracts`, `@leash/sdk`, `@solana/kit` 8.4.0, `hono`, `@hono/node-server`, `pino`, `ws`, `zod`, and `grammy` 1.46.0. Dev dependencies: `litesvm` 1.5.0, `@types/ws`, `tsx`.

**Next after you:** the laptop runs Sentinel against the indexer with the real bot (laptop queue item 6, [BOARD](../BOARD.md)). The demo script expects the phone to buzz on the approval request and on the tripwire.
