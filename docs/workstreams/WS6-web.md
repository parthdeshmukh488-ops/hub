# WS6: Web control panel (`apps/web`)

## Mission

Give the owner calm, total control. In ten seconds they must see which agents are running, what they spent, what was blocked and why, and have the off switch under their thumb. This is what judges and first users *see*, so it has to feel like a finished product, not a hackathon dashboard.

## Read first

[00-overview](../architecture/00-overview.md) (all flows) · [02-contracts](../architecture/02-contracts.md) (§4 copy table, §5 views, §7 API, §10 Actions, §11 pairing, §13 env) · [03-security](../architecture/03-security.md) (T10, T11, T13, T18) · [04-conventions §8](../architecture/04-conventions.md#8-ui-conventions-ws6-also-any-other-ui) · [ADR-0005](../adr/0005-kit-and-codama-clients.md) · [ADR-0006](../adr/0006-monorepo-and-service-stack.md) · the Foundation's Subscriptions web app (`webapp/` in github.com/solana-foundation/subscriptions) as a reference for Kit + ConnectorKit usage

## You own

`apps/web/`

## You consume and provide

| Consumes | Provides |
| --- | --- |
| `@leash/sdk` (owner builders, `fetch*View`, `evaluatePayment` for previews), `@leash/contracts` (views, events, copy, presets, Actions types), indexer REST and WebSocket, a wallet (Kit-native connector) | The owner app, the pairing page, Solana Actions endpoints, the landing page |

## Screens

| Route | Purpose | Key elements |
| --- | --- | --- |
| `/` | Landing page for judges and visitors | One-line promise, the 60-second story (attack → blocked → frozen), how it works (three steps), "Why Solana", a live counter of blocked attempts on devnet, links to the repo and the app |
| `/app` | Overview | Global freeze switch; agent cards (status, spent today vs allowance, last activity, strikes, pending approvals); recent blocked attempts |
| `/app/agents/new` and `/pair` | Pairing wizard | Agent key (from the pairing link, with a **fingerprint** to compare against the agent's terminal), label, preset, allowance, limits, allowlist → **plain-language review** ("This agent can spend up to 5 USDC per day, only with Research API, at most 1 USDC per payment…") → sign 1–2 transactions → success |
| `/app/agents/[agent]` | Agent detail | Big freeze/unfreeze toggle; allowance gauge (remaining this period, period end); policy summary with edit; allowlist table (add, edit, remove, per-payee spend); live activity feed; strike meter; "hard stop: revoke allowance" (danger zone) |
| `/app/approvals` | Inbox | Pending requests with payee, amount, purpose and expiry; approve or reject in one tap |
| `/app/activity` | Full event log | Filters (agent, type, blocked only), explorer links, export as CSV |
| `/app/settings` | Account | Guardian setup (Sentinel's address), Telegram setup instructions, cluster and program info |

## Design notes

- **Stack:** Next.js App Router, Tailwind v4, shadcn/ui (Radix), TanStack Query, a Kit-native wallet connector (`@solana/connector` by default, ADR-0005).
- **Data sources:** `NEXT_PUBLIC_DATA_SOURCE=fixtures|indexer`. Fixture mode reads `@leash/contracts/fixtures` so the whole UI can be built before any chain exists. Live mode uses REST for initial loads and the WebSocket stream for events, merged into the query cache and deduplicated by `event.id`.
- **Writes:** only through `@leash/sdk` owner builders, signed by the connected wallet. Before building any transaction, re-read the accounts it depends on **from RPC**, not from the indexer (T13).
- **Transaction UX:** summary → wallet → pending (with signature) → confirmed (explorer link) → the UI updates from the stream. Map errors to the copy table in 02 §4.
- **Previews:** in the policy editor, `evaluatePayment` from the SDK powers a "what would happen if…" tester ("the agent tries to pay 3 USDC to Research API" → "Needs your approval").
- **Solana Actions:** route handlers under `app/api/actions/…` per 02 §10, plus `actions.json`. They build transactions with the SDK and never sign anything.
- **Mobile and PWA:** installable, and the freeze switch is two taps from the home screen. Test at 375 px width.
- **Visual language:** a calm, dark-first "security console" with a light theme too. Status colours follow 04-conventions §8, always paired with an icon and a label.
- **Safety:** labels and memos render as text only (T18). Addresses are shortened with copy buttons and a full value on hover.

## Build order (quality gates)

1. **Shell and design system.** Layout, navigation, theme, typography, core components (AgentCard, StatusBadge, AmountText, AllowanceGauge, EventRow, FreezeSwitch), fixture data layer. Overview and agent detail are read-only on fixtures.
2. **Wallet and pairing.** Wallet connection, pairing wizard with fingerprint and plain-language review, transaction building on localnet.
3. **Live control.** Indexer data and stream, activity feed, approvals inbox, freeze and unfreeze, policy and allowlist editing with previews.
4. **Actions and mobile.** Solana Actions routes with tests; PWA manifest; mobile polish.
5. **Landing page and quality.** The landing page, an accessibility pass (keyboard, contrast, screen reader labels), and Playwright smoke tests (overview renders, pairing wizard reaches the review step, freeze flow on localnet).

## Definition of done (in addition to the general one)

- Every screen works in fixture mode and live mode.
- Every on-chain action shows a plain-language summary before the wallet opens.
- Google Lighthouse accessibility score ≥ 95 on `/`, `/app` and the agent page.

## Pitfalls

- Don't let the UI become the security boundary. It only builds transactions; the chain enforces.
- Don't block the UI on the indexer. Show cached data with a "live" indicator that turns grey when the stream drops.
- Avoid wallet-adapter libraries built on web3.js v1 (ADR-0005).

## Starter prompt

```text
You are the WS6 (Web control panel) engineer on Leash, a spending firewall for AI agents on Solana.

Before anything else:
1. Merge the latest main into your branch.
2. Read CLAUDE.md, docs/architecture/00-overview.md, docs/workstreams/WS6-web.md and every document its "Read first" section lists.
3. Read docs/workstreams/status/WS6.md (create it from docs/workstreams/status/README.md if missing) and any ADRs newer than it. Then read docs/workstreams/BOARD.md and every file in docs/workstreams/messages/ addressed to ws6 or to all.

Then tell me in a short message: what you understand your job to be, which build step you will do now, your plan for it (including a sketch of the layout and component list), and anything in the spec that looks wrong or underspecified. Wait for my OK before writing code.

Rules: only edit apps/web and your status file; follow docs/architecture/04-conventions.md; contract changes go through an ADR; end every work block by updating your status file, committing and pushing.
```
