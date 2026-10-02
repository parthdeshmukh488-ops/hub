# WS6 status: Web control panel

- Session branch: `ws6/owner-web-app-72mvts` (cloud session, 2026-10-02)
- Last updated: 2026-10-02
- Current build step: 2 and 3, write side (the owner acts in the app): in progress
- Messages handled: through `20261001-2310-from-architect-to-ws5-ws1-sentinel-merged.md` (none needed WS6 action)

## Plan for the owner's side (Parth's brief of 2026-10-02, in his order)

1. **Wallet.** `@solana/connector` 0.3.0 does not fit: it pulls `@wallet-ui/core`, whose peer is `@solana/kit` ^6 || ^7 (we pin 8.4.0), plus React Native through the mobile adapter (~280 MB). So, as the brief allows: **Wallet Standard with `@solana/react` 8.4.0** (Kit's own hooks, same version as our Kit; `@wallet-standard/react` for the wallet list). No web3.js v1 anywhere. Header: Connect button (wallet picker), the connected address with copy, disconnect, and a warning when the wallet does not list the app's chain (`solana:devnet` / `solana:localnet`). The wallet only **signs**; the app sends through its own RPC (`rpcChain`), so localnet works with any wallet and errors come back typed.
2. **One write path**, `src/lib/owner/`:
   - `plans.ts`: pure `plan*(chain, input)` functions. Each re-reads the accounts from RPC through the SDK (`fetchAgentView`, `fetchPrincipalView`, `fetchRequestView`: T13), checks who may sign and the state (an already frozen agent, an expired request…), and returns `{ summary, transactions }` built by the SDK builders. Freeze/unfreeze agent, reset strikes (freeze + unfreeze in one transaction, as `owner-unfreeze.ts`), freeze/unfreeze all, approve, reject, set guardian, onboarding.
   - `send.ts`: sign each transaction with the wallet's `TransactionSigner`, send and confirm through the `LeashChain`.
   - `errors.ts`: any failure → owner-facing copy. Denials use the 02 §4 copy table (`DENIAL_REASONS[].ownerCopy`); the other program errors (Unauthorized, RequestExpired, …), a refused signature and an unreachable RPC get web copy.
   - `use-owner-action.ts`: one hook for every action: summary (dialog) → wallet signs → pending (signature) → confirmed (explorer link) → views refresh from the indexer stream (plus a query invalidation as a fallback).
3. **Approvals inbox:** Approve and Reject on every request, summary first ("Approve 1.50 USDC to Research API for “…”").
4. **Freeze:** the agent page's big toggle, the global switch on `/app`, and "Reset strikes" on an active agent with leftover strikes.
5. **Pairing** (`/pair?agentKey&label&preset&cluster`, and `/app/agents/new`): fingerprint of the agent key, preset filled in with every limit editable, the plain-language review, signing the onboarding transactions one by one, success → agent page. The preset's "merchant-demo" payee and the localnet mint are not in any env variable the web app reads: the wizard pre-fills them from the owner's existing agents and otherwise asks (no new env variable).
6. **Settings** (`/app/settings`): set, change or remove the guardian.
7. **Tests:**
   - every `lib/owner` function on the LiteSVM testbed: the wallet-signed transaction changes the real program's state; a wrong signer is refused by the plan and fails on-chain;
   - component tests for the summaries and the error copy;
   - Playwright (Chromium) with a fake Wallet Standard wallet signing with a test key: in fixture mode, connect and the pairing wizard's review; approve and freeze need a chain, so they run against a LiteSVM-backed JSON-RPC shim plus the in-process test indexer (`@leash/indexer/testing`), the real write path end to end.
8. **README:** how the owner acts, localnet and devnet runs.

Owner identity: in indexer mode the app shows the connected wallet's agents (the demo storyline's owner until a wallet connects, for the replay); fixture mode stays the read-only sample.

## Plan for build step 1 (as executed)

1. Next.js 16.3 App Router + Tailwind 4.3 in `apps/web`, design tokens in `globals.css` (AA contrast; light by default since 2026-09-30).
2. Core components from the brief: AgentCard, StatusBadge, AmountText, AllowanceGauge, EventRow, FreezeSwitch, plus Address, RelativeTime, StrikeMeter, PayeeList, Card.
3. A `LeashDataSource` interface with a fixture implementation (zod-validated fixtures, fixed clock at the fixtures' snapshot time).
4. `/app` and `/app/agents/[agent]`, read-only.
5. Tests for the pure logic, the fixture source and component rendering; `next build`; screenshots at 1280 px (dark and light) and 375 px.

## Done

- **Build step 1, complete (2026-09-29).** Everything above. 19 tests pass; `next build` passes; screenshots checked with no console errors.
- Plain-language policy lines (`src/lib/policy.ts`) are ready for the pairing review in step 2. Switched-off protections (allowlist off, no rate limit, tripwire off) are flagged as warnings.
- Allowlist rows for agents without a detail fixture are rebuilt from events, using the program's payee-window rule. A test proves the rebuild equals `agent-detail.json` for the research agent.

## Decisions to review (Parth)

- **Light is the default theme** (Parth, 2026-09-30: "i like the white plain interface design"). It is light whatever the device setting; dark is a header toggle, stored in the browser, applied before the first paint so it never flashes.

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
