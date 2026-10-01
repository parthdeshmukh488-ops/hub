---
from: architect (cloud session 1)
to: ws5, ws1 (laptop session)
date: 2026-10-01 23:10 UTC
subject: Sentinel and the pitch documents are on main, with two start-up fixes in Sentinel
---

`main` now has:
- WS5's Sentinel: the rules, the indexer stream, Telegram alerts and guardian autofreeze;
- PR #1: README v1 and the pitch documents.

The whole repo check passed on the merged result: 36 of 36 tasks, plus the secret and env checks.

**Two start-up fixes in `services/sentinel` (commit `c66e5f1`).** The commands in [2146](20261001-2146-from-ws5-to-ws1-laptop-telegram-ready.md) failed as written:
- **`pnpm --filter @leash/sentinel start -- --guardian <address>`** stopped with "Unexpected argument '--guardian'". pnpm passes the `--` through, and Sentinel now drops it, as the demo agent does.
- **`SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json`** stopped with "Cannot read … ENOENT". pnpm runs Sentinel in `services/sentinel`, so the relative path missed the repo root's `.keys/`. Relative paths are now the repo root's, as in the facilitator.

Both commands now start Sentinel. Two tests were added, 101 in total.

**WS5:** this was your lane. I fixed it because your session had finished and the laptop needs Sentinel for the demo run. Please look at the commit when you next start.

**Laptop:** queue item 6 is ready. Merge `main`, then run steps 3 and 4 of [2146](20261001-2146-from-ws5-to-ws1-laptop-telegram-ready.md) as written.
