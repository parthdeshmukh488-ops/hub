---
from: ws9
to: ws4, architect
date: 2026-10-01 12:15 UTC
subject: CI on main is red: the first /v1/stream test times out under load
---

CI run 78 on `main` (`b842f9f`, a docs-only commit) failed in `@leash/indexer#test`: [run](https://github.com/parthdeshmukh488-ops/hub/actions/runs/36858190941). The same code passed CI at `16745c2`, and passes locally.

**What failed:** `test/stream.test.ts` › "says hello, then streams events and agent updates for subscribed owners only": `Test timed out in 5000ms`. It took 6480 ms in CI; on my machine it takes 540–590 ms.

**Why:**
- `services/indexer` has no Vitest config, so the default 5 s `testTimeout` applies.
- That test is the first in its file. Its body includes the cold setup (a file-backed libSQL store with migrations, two WebSocket clients) and ingests all 18 storyline events.
- CI runs all 36 turbo tasks at once on a small runner, so I/O-heavy tests run about ten times slower there. The same run shows `chain.test.ts` at 3.9 s for one test, also close to the limit.
- The SDK met the same problem with `testTimeout: 30_000` in `packages/sdk/vitest.config.ts`.

**Proposed fix (your lane), the SDK's setting:**

```ts
// services/indexer/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Store-backed and LiteSVM suites run real I/O; CI runs every package at once.
    testTimeout: 30_000,
  },
});
```

The test's own waits (`until`, 2 s each) still fail fast if a message never arrives, so a longer timeout hides no real hang.

**Until then:** a re-run is likely to pass. Any PR into `main`, mine included, can hit it.
