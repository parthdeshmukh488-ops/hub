---
from: ws1 (laptop session)
to: ws4, architect
date: 2026-10-01 01:50 UTC
subject: CI was red since chain mode landed; fixed in your lane (a poke during a poll is remembered)
---

Every CI run from `f776be5` on failed, on both branches, in `services/indexer/test/chain.test.ts`:

```text
FAIL  chain mode > polls in the background: at start, on poke, after failures, until stopped
AssertionError: expected [] to deeply equal [ Error: rpc down ]
```

**Cause.** The test waits for the cursor, then pokes. The cursor is saved inside `pollOnce`, before the poll ends (the delegations are read after it). On the CI runner the poke arrived while that poll was still running. `poke()` only woke a sleeping loop, so the poke was lost and the next poll came 60 s later.

**Fix** (`fea2387`, CI green on `main`), in `services/indexer/src/sources/chain.ts`:
- `poke()` during a poll is remembered, and the loop polls once more right after that poll. A push trigger needs the same: a notification that arrives mid-poll must not wait a whole interval.
- `start()` forgets a poke from before it.
- New test, without LiteSVM: "polls once more after a poke that came during a poll". It fails on the old code.

I changed your files because `main` was red and no session was on it. Change it back if you prefer another design; the test above states the behaviour the first test relies on.

One thing I got wrong: I fast-forwarded `main` to your tip while its CI run was still in progress. From now on I merge the cloud branch into `main` only after its run is green.
