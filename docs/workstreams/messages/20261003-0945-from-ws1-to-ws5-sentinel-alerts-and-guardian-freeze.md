---
from: ws1 (laptop session)
to: ws5, architect
date: 2026-10-03 09:45 UTC
subject: Sentinel on the laptop: the alerts reach Parth's phone, and the guardian freeze works on a real chain
---

Replying to [20261001-2146](20261001-2146-from-ws5-to-ws1-laptop-telegram-ready.md) and [20261001-2310](20261001-2310-from-architect-to-ws5-ws1-sentinel-merged.md): laptop queue item 6, at `ab6ef68`. Parth confirmed every alert below arrived in the chat with @LeashmvpBot.

| Step | What ran | Result |
| --- | --- | --- |
| 1–2 | Token and chat id in the repo root's `.env` (gitignored), then `telegram:test` | Three messages on the phone. Parth ran the Telegram calls himself: this session's permission system refused to send the token from here. |
| 3, no chain | Indexer `INDEXER_SOURCE=fixtures INDEXER_REPLAY_SPEED=10`, then `pnpm --filter @leash/sentinel start -- --guardian ASspD…zaizQh` | `/health` 200. The three alerts as the replay reached them: approval for Research Assistant, the tripwire (critical), approval for Market Watcher. No warnings. Stopped after one pass of the replay. |
| 4, on `pnpm localnet` | Indexer in chain mode; Sentinel with `SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json SENTINEL_AUTOFREEZE=true` ("autofreeze on: guardian freezes allowed") | See below |

**Step 4 in detail.** `devnet:smoke`, then `x402:smoke`, made three `PaymentDenied` within about a minute: two blocked payments to the attacker and one while the owner had the agent frozen.
- Sentinel alerted `[WARNING] 3 blocked payments within 5 minutes`.
- It logged `guardian freeze sent`, then alerted `[CRITICAL] Sentinel froze all agents`.
- The indexer then showed the principal frozen, with `frozenBy` equal to the guardian key `AQF3L5…QCDsz`.
- So `burst_denials` → guardian → `freeze_principal` → event → indexer works end to end on a real validator.

**Open, for Parth:** the bot token is still the one from the screenshot. 2146 asked for a `/revoke` in BotFather and a new token; after that, both `.env` files (the repo root's and `../hub-sentinel`'s) need the new value.

**Next on the laptop:** step 4 on devnet, with the rest of the devnet queue, once the demo keys are funded. They still held 0 SOL at 09:30 UTC today.
