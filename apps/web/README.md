# @leash/web

The owner's control panel: see every agent, what it spent, what was blocked and why, and freeze it. Later also the pairing wizard, Solana Actions and the landing page.

Owned by **WS6**. Brief: [docs/workstreams/WS6-web.md](../../docs/workstreams/WS6-web.md). Status: [docs/workstreams/status/WS6.md](../../docs/workstreams/status/WS6.md).

## What exists today (build step 1)

| Route | What it shows |
| --- | --- |
| `/` | Redirects to `/app` (the landing page comes in build step 5) |
| `/app` | Overview: agents running / blocked / waiting, the global freeze switch, one card per agent (status, allowance left, last payment, blocked attempts, strikes), recent blocked attempts |
| `/app/agents/[agent]` | Agent detail: status and freeze reason, freeze switch, allowance gauge, tripwire strikes, approvals waiting, the spending rules in plain language, allowed payees with their spend, the full activity feed |

Everything reads the demo storyline from `@leash/contracts/fixtures`, parsed with the same zod schemas the indexer's responses will use. Switches are visible but disabled ("Sample data is read-only"): wallet connection comes in step 2, live control in step 3.

## Run it

```bash
pnpm --filter @leash/web dev     # http://localhost:3000
pnpm --filter @leash/web build   # production build
```

## Environment

Read only in [`src/env.ts`](src/env.ts), validated with zod.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_DATA_SOURCE` | `fixtures` | `fixtures` (sample data, no backend) or `indexer` (build step 3; throws until then) |
| `NEXT_PUBLIC_LEASH_CLUSTER` | `localnet` | Cluster shown in the header in indexer mode |
| `NEXT_PUBLIC_INDEXER_URL`, `NEXT_PUBLIC_INDEXER_WS_URL`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_APP_URL` | unset | Used from step 2–3 on |

## Structure

| Path | Contents |
| --- | --- |
| `src/app/` | Routes (App Router, server components) and `globals.css` (design tokens, dark first, light follows the system) |
| `src/components/` | `AgentCard`, `StatusBadge` + `ToneIcon`, `AmountText`, `AllowanceGauge`, `EventRow`, `FreezeSwitch` (Radix), `StrikeMeter`, `PayeeList`, `Address` (short, full on hover, copy), `RelativeTime`, `Card` |
| `src/lib/` | Pure logic: formatting, agent status, event descriptions, plain-language policy lines, allowlist rows |
| `src/data/` | `LeashDataSource` (the only way pages read data) and its fixture implementation |

## Design rules applied

- Status colours: executed green, blocked red, needs approval amber, frozen blue ([04-conventions §8](../../docs/architecture/04-conventions.md#8-ui-conventions-ws6-also-any-other-ui)). Every colour comes with an icon and words.
- Amounts are `bigint` base units until display: two decimals, up to six when needed. Times are relative with the UTC time on hover.
- Labels and agent memos are untrusted and render as text only (T18). A test renders a label containing HTML and checks it comes out escaped.
- Blocked amounts are struck through, because that money never moved.
- Works at 375 px; keyboard focus rings; the allowance is a native `<meter>` for screen readers.

## Test

```bash
pnpm --filter @leash/web test       # logic, fixture data source, component rendering
pnpm --filter @leash/web typecheck
pnpm --filter @leash/web lint
```

## Next

- **Step 2:** wallet connection and the pairing wizard (reusing `policyLines` for the plain-language review).
- **Step 3:** the indexer data source (REST + WebSocket with TanStack Query), approvals, freeze and unfreeze, policy editing with `evaluatePayment` previews.
- **Steps 4–5:** Solana Actions, PWA, landing page, accessibility pass, Playwright smoke tests.
