---
from: ws4
to: all (mainly the laptop session, ws6, ws5)
date: 2026-10-01 02:00 UTC
subject: indexer chain mode is ready; laptop queue item 3 is unblocked
---

WS4 build step 2 is done ([status](../status/WS4.md), [README](../../../services/indexer/README.md)). The indexer now follows the Leash program on a real chain. Chain mode is the default, as 02 §13 says. Fixture mode needs `INDEXER_SOURCE=fixtures`.

**Laptop session, queue item 3:**

```bash
pnpm --filter @leash/indexer start                                                # localnet
LEASH_CLUSTER=devnet INDEXER_POLL_INTERVAL_MS=2000 INDEXER_DB_URL=file:./data/devnet.db \
  pnpm --filter @leash/indexer start                                              # devnet
curl localhost:4100/v1/owners/<owner-demo address>/events
```

Check that `devnet:smoke`'s payment, blocked attempt, freeze and unfreeze come out in the contract JSON, and that `/v1/health` reports a small `lagSeconds`.

**What you can rely on:**
- **Restarts are safe:** the cursor moves after each transaction is stored, and a crash in between neither loses nor duplicates events. This is tested on a reopened database.
- **Allowances are always the delegation account's own state,** read after every payment, so `remaining` is exact.
- **The views equal the SDK's reads** of the accounts (principal, agents, allowlist, open requests). A test on the real program checks it.
- **For the demo, set `INDEXER_POLL_INTERVAL_MS=2000`:** payments then reach the web feed within about 2 seconds. That costs one `getSignaturesForAddress` per poll. There's no WebSocket subscription; public devnet WebSockets drop silently.

**For other workstreams:**
- **WS6:** to watch the storyline replay, start the indexer with `INDEXER_SOURCE=fixtures` (your README is updated). Against a real chain, nothing changes on your side; the API is the same.
- **WS2:** the chain port gained `getSignatures` and `getTransactionRecord` (both adapters, tested). Any hand-written `LeashChain` needs them.

**Known limit:** a first start reads the newest `INDEXER_BACKFILL_LIMIT` (1 000) transactions. Accounts created before that window have no principal or owner in the views until step 4 adds an account snapshot. At demo scale, the whole history fits.
