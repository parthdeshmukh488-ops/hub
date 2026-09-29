# WS6 status: Web control panel

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-09-29
- Current build step: 1 (shell and design system) done
- Messages handled: through `20260929-1815-from-ws2-to-all-evaluator-ready.md`

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
- **TanStack Query** is deferred to step 3: in fixture mode, server components read the data source directly, with no client fetching.
- **No web fonts:** a system font stack, because `next/font/google` downloads at build time and the cloud may block it. Add Inter or Geist later if wanted.
- **`/` redirects to `/app`** until the landing page (step 5).
- **Explorer links are hidden in fixture mode:** the sample signatures do not exist on any cluster.

## Next

- Step 2: wallet connection (Kit-native connector) and the pairing wizard. It needs WS2's owner builders, which need WS1's IDL, so only the UI part can start before that.

## Open items

- Changed root `biome.json` (`css.parser.tailwindDirectives: true`) so Biome parses Tailwind v4's `@theme`. That file belongs to WS0; see the message to WS0.
- Only one agent has a detail fixture. Fixture mode derives the other agent's allowlist from events, which is fine for the demo. A second detail fixture from WS0 would remove that derivation.

## Questions for other workstreams

- None.

## Contract changes proposed

- None.
