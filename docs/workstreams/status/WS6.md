# WS6 status: Web control panel

- Session branch: `ws6/owner-web-app-72mvts` (cloud session, 2026-10-02)
- Last updated: 2026-10-03
- Current build step: 2 and 3, write side (the owner acts in the app): done, PR into `main` open
- Messages handled: through `20261001-2310-from-architect-to-ws5-ws1-sentinel-merged.md` (none needed WS6 action)

## Build step 5: the landing page (2026-10-03, final-polish session, PR #6)

- **`/`** is the landing page (was a redirect to `/app`): the one-line promise, the 60-second story (paid → asks → blocked → frozen, each with an icon and a word), how it works in three steps, why Solana, links to the app, the repo and the program on devnet. Static server component; no data, no new env variables. The live counter of blocked attempts from the brief is left out: it needs a live indexer the deployed sample-data app won't have.
- **Accessibility:** a skip link (first Tab), header/main/footer landmarks, one `h1` and ordered `h2`/`h3`, lists for the story and steps, decorative icons `aria-hidden`, status colours always with a word, the existing AA tokens in both themes. Checked at 1280 px and 375 px, light and dark. A Lighthouse run is still to do.
- **Test:** one more Playwright test on sample data (headings, status words, skip link by keyboard, the way into `/app`): 7 on sample data, 8 live.
- **`next build` succeeds in fixture mode**; `apps/web/README.md` says how Parth deploys the sample-data app to Vercel (root directory `apps/web`) so judges get a link.

## Plan for the owner's side (Parth's brief of 2026-10-02, in his order; executed)

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

- **The owner acts in the app (2026-10-02), as planned above.**
  - Wallet: Wallet Standard + `@solana/react` 8.4.0 (`src/wallet/`): connect picker, address with copy, disconnect, silent reconnect after a reload, "Wallet not on <cluster>" warning. New dependencies: `@solana/react`, `@wallet-standard/react`; dev: `@playwright/test` 1.56.1 (matches the pre-installed Chromium), `@leash/indexer` (its `/testing` for the live stack). No web3.js v1 (`pnpm why @solana/web3.js` is empty).
  - One write path, `src/lib/owner/`: plans (RPC re-read, signer and state checks, SDK builders, plain-language summary), `sendOwnerPlan`, error copy, `useOwnerAction` + `OwnerActionDialog`.
  - Approve/Reject (inbox and agent page), the agent toggle, Clear strikes (freeze + unfreeze in one transaction), the global switch, the pairing wizard (`/pair`, `/app/agents/new`) ending on the new agent's page, guardian settings (`/app/settings`).
  - Screens show the connected wallet's agents in indexer mode; fixture mode stays read-only.
  - **Tests: 117 unit/integration** (`pnpm --filter @leash/web test`; was 68): 27 for `lib/owner` on the LiteSVM testbed (each action changes the real program; wrong signers refused by the plan and by the program), 12 for summaries and error copy (all 12 denials use the 02 §4 copy), 10 for the pairing logic. **14 in Chromium** (`pnpm --filter @leash/web test:e2e`): 6 on sample data, 8 live on LiteSVM through a JSON-RPC endpoint and the test indexer in chain mode, including a full pairing.
- **Build step 1, complete (2026-09-29).** Next.js 16.3 App Router + Tailwind 4.3, design tokens, core components, fixture data layer, read-only overview and agent detail.
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

- Review and merge the PR.
- **Laptop:** the owner on localnet and devnet as in `apps/web/README.md` ("The owner on localnet", "The owner on devnet"), with `owner-demo` imported into a browser wallet.
- Step 3's rest: policy and allowlist editing with the what-if preview; "revoke allowance" in a danger zone.

## Open items

- **Fingerprint format (contract gap, asked Parth).** 02 §11 and T11 ask the owner to compare a fingerprint with the agent's terminal, but no format is specified and the agent runtime prints only the pairing link. Default used: the whole base58 key in groups of four; the agent can print the same with no new code. An ADR could fix the format and have WS7 print it.
- **Owner copy for non-denial program errors** (Unauthorized, InvalidPolicy, RequestExpired, …) lives in `apps/web/src/lib/owner/errors.ts`: 02 §4 only covers the twelve denials. Worth moving to `@leash/contracts` if another app needs it.
- **Presets' "merchant-demo" payee and the localnet mint** have no web env variable; the wizard pre-fills them from the owner's existing agents and the cluster's USDC (devnet), else the owner types them.
- Wallets report the chains they support, not the cluster they are on: the warning catches a wallet without the app's chain, not a wallet switched to mainnet.
- Explorer links show only for live data on devnet in the feeds; the owner's own confirmed transactions always link (localnet: a custom-RPC Explorer link).
- After a replay loop resets, the overview briefly shows "0 of 0 running"; the replay's story, not a bug.
- Changed root `biome.json` earlier (`css.parser.tailwindDirectives`); see the message to WS0.

## Questions for other workstreams

- None.

## Contract changes proposed

- None.
