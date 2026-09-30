# WS6 status: Web control panel

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-09-30
- Current build step: 1 done; 3 read side done (write side waits for the wallet and the IDL)
- Messages handled: through `20260930-0130-from-ws4-to-all-indexer-fixture-mode.md`

## Plan for build step 1 (as executed)

1. Next.js 16.3 App Router + Tailwind 4.3 in `apps/web`, design tokens in `globals.css` (dark first, light via the system setting, AA contrast).
2. Core components from the brief: AgentCard, StatusBadge, AmountText, AllowanceGauge, EventRow, FreezeSwitch, plus Address, RelativeTime, StrikeMeter, PayeeList, Card.
3. A `LeashDataSource` interface with a fixture implementation (zod-validated fixtures, fixed clock at the fixtures' snapshot time).
4. `/app` and `/app/agents/[agent]`, read-only.
5. Tests for the pure logic, the fixture source and component rendering; `next build`; screenshots at 1280 px (dark and light) and 375 px.

## Done

- **Build step 1, complete (2026-09-29).** Everything above. 19 tests pass; `next build` passes; screenshots checked with no console errors.
- Plain-language policy lines (`src/lib/policy.ts`) are ready for the pairing review in step 2. Switched-off protections (allowlist off, no rate limit, tripwire off) are flagged as warnings.
- Allowlist rows for agents without a detail fixture are rebuilt from events, using the program's payee-window rule. A test proves the rebuild equals `agent-detail.json` for the research agent.

## Decisions to review (Parth)

- **shadcn/ui:** components are hand-written in shadcn style on Radix (only `@radix-ui/react-switch` so far) instead of using the shadcn CLI, whose registry may not be reachable from the cloud. Same result, fewer files.
- **TanStack Query** is used since step 3. Screens are client components; pages are thin server components.
- **No web fonts:** a system font stack, because `next/font/google` downloads at build time and the cloud may block it. Add Inter or Geist later if wanted.
- **`/` redirects to `/app`** until the landing page (step 5).
- **Explorer links are hidden in fixture mode:** the sample signatures do not exist on any cluster.

- **Build step 3, read side (2026-09-30):**
  - An indexer data source with every REST response validated against the contract schemas.
  - TanStack Query caches kept current by the `/v1/stream` WebSocket: events merged and deduplicated by id, agent updates applied everywhere, reconnect with backoff, `?after=` backfill, and a full reload when the history was reset.
  - New `/app/activity` (filters, paging, CSV export that defuses spreadsheet formulas) and `/app/approvals`.
  - A "what would happen if…" tester on the agent page, running the SDK's `evaluatePayment` on the agent's current state.
  - A header with navigation, a pending-approvals count and Live / Reconnecting status.
  - 40 tests. End to end against the running indexer at 20× replay: the overview counted each blocked attempt as it happened (1, 2, 3), the agent froze itself, loops restarted cleanly, one WebSocket, no page errors.

## Next

- Step 2: wallet connection (Kit-native connector) and the pairing wizard. It needs WS2's owner builders, which need WS1's IDL, so only the UI part can start before that. The owner then comes from the wallet (today: the demo storyline's owner, `src/data/owner.ts`).
- Step 3, write side: freeze and unfreeze, approve and reject, policy and allowlist editing with the what-if tester as the preview.

## Open items

- Explorer links show only for live data on devnet: the indexer's replay and the fixtures use made-up signatures, and nothing in `/v1/health` says the indexer is replaying. An optional `source` field there (additive) would let the app decide exactly.
- After a replay loop resets, the overview briefly shows "0 of 0 running" until the storyline re-creates the agents. That is the replay's story, not a bug; at speed 1 it lasts 20 s.

- Changed root `biome.json` (`css.parser.tailwindDirectives: true`) so Biome parses Tailwind v4's `@theme`. That file belongs to WS0; see the message to WS0.
- Only one agent has a detail fixture. Fixture mode derives the other agent's allowlist from events, which is fine for the demo. A second detail fixture from WS0 would remove that derivation.

## Questions for other workstreams

- None.

## Contract changes proposed

- None.
