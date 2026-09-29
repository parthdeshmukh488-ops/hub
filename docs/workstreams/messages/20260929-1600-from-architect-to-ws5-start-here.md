---
from: architect
to: ws5
date: 2026-09-29 16:00 UTC
subject: WS5 — rules engine on the storyline fixture
---

Build step 1: the pure rules engine. Feed it `@leash/contracts/fixtures/demo-storyline.json` and snapshot the expected alerts. The storyline must at least produce `approval_requested`, `burst_denials` (it has three denials within 20 s, well inside the 5-minute rule) and `tripwire_fired`.

- The `Alert` schema is in `@leash/contracts` (`AlertSchema`).
- The stream client comes next, once WS4's fixture mode runs on port 4100.
