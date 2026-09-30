# @leash/web

The owner's control panel: see every agent, what it spent, what was blocked and why, and freeze it. Later also the pairing wizard, Solana Actions and the landing page.

Owned by **WS6**. Brief: [docs/workstreams/WS6-web.md](../../docs/workstreams/WS6-web.md). Status: [docs/workstreams/status/WS6.md](../../docs/workstreams/status/WS6.md).

## What exists today (build steps 1 and 3, read side)

| Route | What it shows |
| --- | --- |
| `/` | Redirects to `/app` (the landing page comes in build step 5) |
| `/app` | Overview: agents running / blocked / waiting, the global freeze switch, one card per agent (status, allowance left, last payment, blocked attempts, strikes), recent blocked attempts |
| `/app/agents/[agent]` | Agent detail: status and freeze reason, freeze switch, allowance gauge, tripwire strikes, approvals waiting, the rules in plain language, allowed payees with their spend, a **"what would happen if…" tester**, the activity feed |
| `/app/activity` | Every event, filtered by agent and kind (blocked, payments, approvals, freezes and rule changes), older pages on demand, **CSV export** |
| `/app/approvals` | Payment requests waiting for the owner |

**Two data sources** (`NEXT_PUBLIC_DATA_SOURCE`):

- `fixtures` (default): the demo storyline, read-only, no backend.
- `indexer`: live data from `@leash/indexer`. REST loads the screens. The `/v1/stream` WebSocket then keeps them current: events are merged into the query cache and deduplicated by id, and agent updates replace the agent everywhere it is shown. On reconnect the app backfills with `?after=`, and it reloads everything if the indexer's history was reset. The header shows Live / Reconnecting.

**The what-if tester** runs the SDK's `evaluatePayment`, the same rules the program enforces, on the agent's current state. It answers "Goes through", "Needs your approval" or "Blocked", with the reason and whether the attempt would be a strike. It assumes your wallet holds enough USDC.

Freezing, approving and editing are visible but disabled. They need the wallet connection (step 2) and the program's transaction builders (WS2 step 4, which needs WS1's IDL).

## Run it

```bash
pnpm --filter @leash/web dev                                      # sample data, http://localhost:3000

# live, against the indexer's replay (two terminals)
INDEXER_REPLAY_SPEED=10 pnpm --filter @leash/indexer start
NEXT_PUBLIC_DATA_SOURCE=indexer pnpm --filter @leash/web dev

pnpm --filter @leash/web build                                    # production build (NEXT_PUBLIC_* are baked in)
```

## Environment

Read only in [`src/env.ts`](src/env.ts), validated with zod.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_DATA_SOURCE` | `fixtures` | `fixtures` (sample data, no backend) or `indexer` (live) |
| `NEXT_PUBLIC_INDEXER_URL` | `http://localhost:4100` | Indexer REST API |
| `NEXT_PUBLIC_INDEXER_WS_URL` | `ws://localhost:4100/v1/stream` | Indexer stream |
| `NEXT_PUBLIC_LEASH_CLUSTER` | `localnet` | With `devnet` and live data, events link to Solana Explorer (replays and localnet have no public transactions) |
| `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_APP_URL` | unset | Used from step 2 on |

## Structure

| Path | Contents |
| --- | --- |
| `src/app/` | Routes (thin server components) and `globals.css` (design tokens: light by default, dark from the header toggle, remembered per browser) |
| `src/screens/` | The client screens: overview, agent, activity, approvals |
| `src/live/` | Live updates: `merge.ts` (pure rules), `apply.ts` (query cache), `stream.ts` (WebSocket client with reconnect and backfill), `live-provider.tsx` |
| `src/components/` | `AgentCard`, `StatusBadge` + `ToneIcon`, `AmountText`, `AllowanceGauge`, `EventRow`, `FreezeSwitch` (Radix), `StrikeMeter`, `PayeeList`, `Address` (short, full on hover, copy), `RelativeTime`, `Card` |
| `src/lib/` | Pure logic: formatting, agent status, event descriptions, plain-language policy lines, allowlist rows, what-if, CSV |
| `src/data/` | `LeashDataSource` with fixture and indexer implementations, and the query hooks screens use |

## Design rules applied

- Status colours: executed green, blocked red, needs approval amber, frozen blue ([04-conventions §8](../../docs/architecture/04-conventions.md#8-ui-conventions-ws6-also-any-other-ui)). Every colour comes with an icon and words.
- Amounts are `bigint` base units until display: two decimals, up to six when needed. Times are relative with the UTC time on hover.
- Labels and agent memos are untrusted and render as text only (T18). A test renders a label containing HTML and checks it comes out escaped. The CSV export also neutralizes text a spreadsheet would run as a formula.
- Responses from the indexer are validated against the contract schemas before the UI uses them.
- Blocked amounts are struck through, because that money never moved.
- Works at 375 px; keyboard focus rings; the allowance is a native `<meter>` for screen readers.

## Test

```bash
pnpm --filter @leash/web test       # 40 tests: logic, both data sources, live merge, reconnect, what-if, CSV
pnpm --filter @leash/web typecheck
pnpm --filter @leash/web lint
```

## Next

- **Step 2:** wallet connection and the pairing wizard (reusing `policyLines` for the plain-language review). The owner then comes from the wallet instead of the demo storyline.
- **Step 3, write side:** freeze and unfreeze, approve and reject, policy and allowlist editing, all through the SDK's owner builders (they need WS1's IDL).
- **Steps 4–5:** Solana Actions, PWA, landing page, accessibility pass, Playwright smoke tests.
