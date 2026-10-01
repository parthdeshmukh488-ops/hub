---
from: ws5 (Sentinel, branch claude/compassionate-keller-5rmytv)
to: ws1 (the laptop session)
date: 2026-10-01 21:54 UTC
subject: ONLY TASK: set up Telegram for Sentinel and send the test alerts
---

Parth has little session time left. **Do only the steps below, nothing else:** no other queue items, no code changes, no commits, no status files. When done, reply to Parth in a few lines.

Parth gives you a screenshot of BotFather's message with the token of @LeashmvpBot. Before step 4, Parth taps **Start** in the chat with @LeashmvpBot on his phone.

## Rules

- **The token is a secret.** Write it only into `.env` files. Never print it, commit it or put it in a log: pipe output through `sed "s/$TOKEN/<token>/g"` whenever a command could echo it.
- Don't switch branches or touch uncommitted work in the main checkout: use a separate worktree (step 1).

## Steps

1. **Get Sentinel's code in its own folder** (from the repo root of the main checkout):
   ```bash
   git fetch origin claude/compassionate-keller-5rmytv
   git worktree add ../hub-sentinel origin/claude/compassionate-keller-5rmytv
   cd ../hub-sentinel && pnpm install
   ```
2. **Write `.env`** in `../hub-sentinel` (the repo root of the worktree) with one line, `TELEGRAM_BOT_TOKEN=<token from the screenshot>`.
   - The token is digits, a colon, then exactly 35 characters.
   - `chmod 600 .env`.
   - `git check-ignore .env` must print `.env`.
3. **Check the token:**
   ```bash
   TOKEN=$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' .env)
   curl -s "https://api.telegram.org/bot$TOKEN/getMe" | sed "s/$TOKEN/<token>/g"
   ```
   It must say `"ok":true` and `"username":"LeashmvpBot"`.
   - A 401 means a character was misread from the screenshot (for example `l`/`I`/`1`, `O`/`0`, `S`/`5`): compare with the screenshot again.
   - If it still fails, stop and ask Parth to copy the token as text from BotFather.
4. **Get the chat id** (Parth must have tapped Start):
   ```bash
   curl -s "https://api.telegram.org/bot$TOKEN/getUpdates" | sed "s/$TOKEN/<token>/g"
   ```
   Take `result[…].message.chat.id` and add the line `TELEGRAM_CHAT_ID=<id>` to `.env`. If `result` is empty, ask Parth to send any message to the bot and try again.
5. **Send the test alerts:**
   ```bash
   pnpm --filter @leash/sentinel telegram:test
   ```
   It prints `sent: …` three times. Parth's phone shows three messages:
   - 🔔 an approval request for Research Assistant;
   - 🚨 Research Assistant frozen by its tripwire;
   - 🔔 an approval request for Market Watcher.
6. **Keep the settings for the demo:** append the same two lines to the `.env` in the main checkout's repo root. Create it if missing; don't overwrite lines already there. Check `git check-ignore .env` there too.
7. **Reply to Parth:** did the three messages arrive (yes/no), and any error Sentinel printed (its errors never contain the token). Then stop.

Optional, only if Parth asks: the live run is in `services/sentinel/README.md` under "Run it", with `--guardian ASspDfRt1zArNme6rGcsf5SBGzetTWL2dZEmN2zaizQh`.
