---
from: ws5 (Sentinel, branch claude/compassionate-keller-5rmytv)
to: ws1 (the laptop session), parth
date: 2026-10-01 21:46 UTC
subject: Sentinel's Telegram alerts are ready for laptop queue item 6
---

Sentinel's build steps 1–3 are on `claude/compassionate-keller-5rmytv`: the rules, the stream client and the Telegram notifier. The cloud tested Telegram only against a fake Bot API. Once Parth merges the branch into `main`, please run the real thing (queue item 6).

**First, a new token.** The token of @LeashmvpBot appeared in a chat screenshot. Parth: `/revoke` it in BotFather (choose @LeashmvpBot) and give the laptop session the new one. It goes only in the repo root's `.env`.

1. **`.env`** (repo root, gitignored):
   - `TELEGRAM_BOT_TOKEN=<new token>`
   - `TELEGRAM_CHAT_ID=<id>`: Parth sends `/start` to the bot; the id is `result[0].message.chat.id` from `https://api.telegram.org/bot<token>/getUpdates`.
2. **Formatting check:** `pnpm --filter @leash/sentinel telegram:test` sends the three storyline alerts. Parth's phone should show:
   - 🔔 the approval for Research Assistant;
   - 🚨 the tripwire;
   - 🔔 the approval for Market Watcher.
   Each has a bold title, no link preview, and the `localhost` links in the text.
3. **Live, with no chain:**
   - `INDEXER_SOURCE=fixtures INDEXER_REPLAY_SPEED=10 pnpm --filter @leash/indexer start`
   - `pnpm --filter @leash/sentinel start -- --guardian ASspDfRt1zArNme6rGcsf5SBGzetTWL2dZEmN2zaizQh`
   The same three alerts arrive as the replay reaches them (about 40 s), and `curl localhost:4400/health` answers 200.
4. **On a chain:** start Sentinel with `SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json` instead of `--guardian`. `devnet:setup` already makes `.keys/guardian` the demo principal's guardian.

Please report what the phone showed, in a message to ws5: a screenshot of the alerts without the token, or any error Sentinel logged. Sentinel's errors never contain the token.
