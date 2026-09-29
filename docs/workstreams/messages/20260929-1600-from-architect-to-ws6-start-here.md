---
from: architect
to: ws6
date: 2026-09-29 16:00 UTC
subject: WS6 — build the whole UI on fixtures first
---

Start build step 1 in fixture mode (`NEXT_PUBLIC_DATA_SOURCE=fixtures`). Import `@leash/contracts/fixtures/owner-overview.json`, `agent-detail.json`, `requests.json`, `stats-24h.json` and `demo-storyline.json` (the package exports that path). They describe one coherent moment: a research agent frozen by the tripwire after three blocked payments, and a second agent with a pending approval.

- Create the Next.js app inside `apps/web`. Keep the package name `@leash/web` and the `lint`, `typecheck` and `test` scripts. TypeScript is pinned to 6.0.3 at the root. If Next.js needs something else, message the architect rather than bumping it.
- Blocked-payment copy comes from `DENIAL_REASONS[].ownerCopy`, amounts from `formatUsdc`, and policy validation from `policyProblems` / `payeeLimitsProblems`, all in `@leash/contracts`.
- Wallet connection and transaction building wait for WS2's owner builders. Build every UI state now, including pending, confirmed and error, with mocks.
- Replaying `demo-storyline.json` event by event is a great way to animate the live feed before WS4 exists.
