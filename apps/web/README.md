# @leash/web

The owner's control panel: see every agent, what it spent, what was blocked and why, and act with your wallet: approve or reject requests, freeze and unfreeze, pair new agents, set the guardian. Also the Solana Actions (Blinks), and a landing page for judges and visitors.

Owned by **WS6**. Brief: [docs/workstreams/WS6-web.md](../../docs/workstreams/WS6-web.md). Status: [docs/workstreams/status/WS6.md](../../docs/workstreams/status/WS6.md).

## What exists today

| Route | What it shows |
| --- | --- |
| `/` | The landing page: the one-line promise, the 60-second story (paid → asks → blocked → frozen), how it works in three steps, why Solana, links to the app, the repo and the program on devnet. Static, no data |
| `/app` | Overview: agents running / blocked / waiting, the **global freeze switch**, one card per agent (status, allowance left, last payment, blocked attempts, strikes), recent blocked attempts |
| `/app/agents/[agent]` | Agent detail: the **big freeze toggle**, allowance gauge, tripwire strikes (with **Clear strikes**), approvals waiting (**Approve** / **Reject**), the rules in plain language, allowed payees with their spend, a "what would happen if…" tester, the activity feed |
| `/app/agents/new`, `/pair` | The **pairing wizard** (below) |
| `/app/activity` | Every event, filtered by agent and kind, older pages on demand, CSV export |
| `/app/approvals` | Payment requests waiting for the owner, with **Approve** and **Reject** |
| `/app/settings` | The **guardian** (set, change, remove), Telegram alert setup, cluster and program |

**Two data sources** (`NEXT_PUBLIC_DATA_SOURCE`):

- `fixtures` (default): the demo storyline, **read-only**, no backend. A wallet connects, but nothing can be signed.
- `indexer`: live data from `@leash/indexer`. REST loads the screens; the `/v1/stream` WebSocket keeps them current (events deduplicated by id, agent updates applied everywhere, `?after=` backfill on reconnect). The screens show the **connected wallet's** agents; before a wallet connects, the demo storyline's owner (whom the indexer's replay serves).

**The what-if tester** runs the SDK's `evaluatePayment` on the agent's current state.

## How the owner acts

1. **Connect a wallet** with the header's button. Any Wallet Standard wallet that signs Solana transactions works (Phantom, Solflare, Backpack). The header shows the address with a copy button, and **"Wallet not on devnet"** when the wallet does not list the app's cluster. Wallets don't tell apps which cluster they currently use, only which ones they support, so on devnet switch the wallet to devnet yourself. The wallet only **signs**: the app sends every transaction to its own cluster (`NEXT_PUBLIC_RPC_URL`), which is why localnet works with any wallet.
2. **Click** Approve, Reject, a freeze switch, Clear strikes, Set guardian or Sign and pair. Every one runs the same flow (`src/lib/owner/`):
   - **plan**: the accounts are re-read from the RPC, never from the indexer (T13); the app checks that your wallet may do this and that it still makes sense (an agent already frozen, a request expired), then builds the instructions with the SDK's owner builders;
   - **summary**: a dialog says in plain words what will happen ("Approve 1.50 USDC to Research API for “weekly market report”."), before the wallet opens;
   - **wallet**: you sign each transaction (pairing a new owner can take two);
   - **pending** with the signature, then **confirmed** with a Solana Explorer link;
   - the screens update from the indexer's stream (and reload once as a fallback).
   - A failure reads as a sentence that says whether anything changed. Denials use the copy table of 02-contracts §4; the program's other errors, a declined signature, missing SOL and an unreachable RPC have their own sentences (`src/lib/owner/errors.ts`).
3. **The UI is never the security boundary.** Its checks only spare you a failed transaction; the Leash program enforces every rule. A wallet that is neither owner nor guardian is refused by the app *and* by the program (both are tested).

**What each wallet may do** (01 §6.1): the owner everything; the guardian only freeze (one agent or all) and reject. Unfreezing an agent clears its strikes. An active agent with leftover strikes gets **Clear strikes**: freeze and unfreeze in one transaction, so it never stays frozen.

**Pairing** (`/pair?agentKey=…&label=…&preset=…&cluster=…`, 02-contracts §11, or `/app/agents/new` by hand):

- the agent key's **fingerprint** (the whole key in groups of four) to compare with what the agent's terminal printed (T11);
- the preset filled in, **every limit editable**: allowance per period and how long it lasts, the instant limit, the approval limit, rate limit, tripwire, the allowlist with per-payee limits;
- the preset's demo merchant and the token mint are pre-filled from your existing agents (or the cluster's USDC on devnet); otherwise you enter them;
- the **plain-language review** ("This agent can spend up to 5.00 USDC per day, only with Research API, at most 1.00 USDC per payment."), then **Sign and pair**;
- on success the app opens the new agent's page. A link for another cluster than the app's is refused.

## Run it

```bash
pnpm --filter @leash/web dev                                      # sample data, read-only, http://localhost:3000

# live, against the indexer's replay of the storyline (two terminals; read-only in practice:
# the replay's accounts are not on any chain)
INDEXER_SOURCE=fixtures INDEXER_REPLAY_SPEED=10 pnpm --filter @leash/indexer start
NEXT_PUBLIC_DATA_SOURCE=indexer pnpm --filter @leash/web dev

pnpm --filter @leash/web build                                    # production build (NEXT_PUBLIC_* are baked in)
```

### The owner on localnet (laptop, Solana toolchain)

```bash
bash scripts/localnet.sh                                          # 1: validator with leash.so and subscriptions.so
pnpm devnet:setup --cluster localnet                              # 2: the demo world (owner-demo, agent, allowlist)
INDEXER_POLL_INTERVAL_MS=2000 pnpm --filter @leash/indexer start  # 3: indexer in chain mode (localnet is the default)
NEXT_PUBLIC_DATA_SOURCE=indexer pnpm --filter @leash/web dev      # 4: the app (localnet, http://127.0.0.1:8899)
```

Import `.keys/owner-demo.json` into a browser wallet (most wallets have "Import private key"; it is a demo key, never a real one), connect it, and act. The wallet may warn that it does not know localnet: it only signs; the app sends to the local validator.

### The owner on devnet

```bash
LEASH_CLUSTER=devnet INDEXER_POLL_INTERVAL_MS=2000 pnpm --filter @leash/indexer start
NEXT_PUBLIC_DATA_SOURCE=indexer NEXT_PUBLIC_LEASH_CLUSTER=devnet pnpm --filter @leash/web dev
```

Set `NEXT_PUBLIC_RPC_URL` (for example a Helius devnet URL) if the public devnet RPC rate-limits you. The connected wallet pays the network fees, so it needs a little devnet SOL. To act on the demo world of `pnpm devnet:setup`, connect the `owner-demo` key; to start fresh, connect any wallet and pair an agent.

### Deploy the control panel with sample data (Vercel)

So judges get a link: the landing page and the control panel on sample data. Nothing in it can sign or move funds (sample data is read-only), and it needs no indexer, keys or secrets.

1. Check the build locally: `NEXT_PUBLIC_DATA_SOURCE=fixtures pnpm --filter @leash/web build` (it succeeds; checked 2026-10-03).
2. On vercel.com: **Add New → Project**, import the GitHub repo.
3. **Root Directory:** `apps/web`. Vercel sees the pnpm workspace and installs from the repo root; keep the detected framework (Next.js) and the default build command.
4. **Node.js version** (Settings → General): 22.x.
5. **Environment variables:** `NEXT_PUBLIC_DATA_SOURCE=fixtures` and `NEXT_PUBLIC_LEASH_CLUSTER=devnet` (so a judge's wallet is asked for devnet). Nothing else; never put a key there.
6. **Deploy.** The URL opens the landing page; **Open the control panel** goes to `/app`. Put the URL in the root README and the submission.

The Solana Actions routes are deployed too. They only return unsigned devnet transactions for a wallet to sign; without a real request or agent they answer with an error.

### The whole owner side without a validator (cloud)

```bash
pnpm --filter @leash/web e2e:stack    # LiteSVM testbed + JSON-RPC endpoint + indexer (chain mode) + the app on :3102
```

This is what the live browser tests run: the real `leash.so` and `subscriptions.so` on LiteSVM behind a small JSON-RPC endpoint (`e2e/litesvm-rpc.ts`), the real indexer in chain mode on it, and the app in live mode. Its owner is the deterministic test key `owner`, so only the test wallet can sign there.

## Environment

Read only in [`src/env.ts`](src/env.ts), validated with zod.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_DATA_SOURCE` | `fixtures` | `fixtures` (sample data, no backend) or `indexer` (live) |
| `NEXT_PUBLIC_INDEXER_URL` | `http://localhost:4100` | Indexer REST API |
| `NEXT_PUBLIC_INDEXER_WS_URL` | `ws://localhost:4100/v1/stream` | Indexer stream |
| `NEXT_PUBLIC_LEASH_CLUSTER` | `localnet` | The cluster the owner's transactions go to, and the chain the wallet is asked for (`solana:localnet` / `solana:devnet`). With `devnet` and live data, events link to Solana Explorer |
| `NEXT_PUBLIC_RPC_URL` | the cluster's | The RPC the owner's writes read from (T13) and send to |
| `NEXT_PUBLIC_APP_URL` | the request's origin | Absolute links in Solana Actions |

## Structure

| Path | Contents |
| --- | --- |
| `src/app/` | Routes (thin server components) and `globals.css` (design tokens: light by default, dark from the header toggle, remembered per browser) |
| `src/screens/` | The client screens: overview, agent, activity, approvals, pairing, settings |
| `src/wallet/` | Wallet Standard through `@solana/react` (Kit's hooks): the provider (selected account, silent reconnect, the Kit signer) and the header's connect button |
| `src/lib/owner/` | The owner's write path: `plans.ts` (re-read, check, build, summarize), `send.ts` (sign and send), `errors.ts` (the copy), `use-owner-action.ts` (the flow), `chain.ts` (the browser's RPC) |
| `src/lib/pairing.ts` | The pairing link, preset → form, validation, the plain-language review, the fingerprint |
| `src/live/` | Live updates: `merge.ts` (pure rules), `apply.ts` (query cache), `stream.ts` (WebSocket client with reconnect and backfill), `live-provider.tsx` |
| `src/components/` | `OwnerActionDialog` (summary → wallet → pending → confirmed), `AgentCard`, `StatusBadge` + `ToneIcon`, `AmountText`, `AllowanceGauge`, `EventRow`, `FreezeSwitch` (Radix), `StrikeMeter`, `PayeeList`, `Address` (short, full on hover, copy), `RelativeTime`, `Card` |
| `src/lib/` | Pure logic: formatting, agent status, event descriptions, plain-language policy lines, allowlist rows, what-if, CSV |
| `src/data/` | `LeashDataSource` with fixture and indexer implementations, the query hooks screens use, and `viewer.ts` (whose agents, and whether the wallet can act) |
| `e2e/` | Browser tests: the fake Wallet Standard wallet, the LiteSVM JSON-RPC endpoint, the live stack |

## Design rules applied

- Status colours: executed green, blocked red, needs approval amber, frozen blue ([04-conventions §8](../../docs/architecture/04-conventions.md#8-ui-conventions-ws6-also-any-other-ui)). Every colour comes with an icon and words.
- Amounts are `bigint` base units until display: two decimals, up to six when needed. Times are relative with the UTC time on hover.
- Labels and agent memos are untrusted and render as text only (T18). A test renders a label containing HTML and checks it comes out escaped. The CSV export also neutralizes text a spreadsheet would run as a formula.
- Responses from the indexer are validated against the contract schemas before the UI uses them.
- Blocked amounts are struck through, because that money never moved.
- Works at 375 px; keyboard focus rings; the allowance is a native `<meter>` for screen readers.

## Test

```bash
pnpm --filter @leash/web test       # 117 tests: logic, data sources, live merge, what-if, CSV, Actions,
                                    # every owner action on the LiteSVM testbed, summaries and error copy, pairing
pnpm --filter @leash/web test:e2e   # Chromium: 7 on sample data, 8 live on LiteSVM (not part of pnpm check)
pnpm --filter @leash/web typecheck
pnpm --filter @leash/web lint
```

- **`test/owner.test.ts`** runs every function of `src/lib/owner` on the real programs (LiteSVM): the wallet's signature makes the change, and a wrong signer (a stranger, the guardian where only the owner may act) is refused by the plan and, sent anyway, by the program.
- **The browser tests** inject a Wallet Standard wallet that signs with a deterministic test key (`e2e/fake-wallet.ts`). On sample data: the landing page (headings, status words, the skip link by keyboard, the way into the app), connect, copy, reconnect after reload, the cluster warning, read-only buttons, the pairing wizard up to its review, broken and wrong-cluster links. Live (`e2e/live-stack.ts`): approve, reject, freeze and unfreeze an agent, freeze and resume all, a declined signature, another wallet, the guardian, and a full pairing that ends on the new agent's page. They use the Chromium Playwright finds (pre-installed in the cloud; `pnpm exec playwright install chromium` elsewhere).

## Next

- Policy and allowlist editing on the agent page (`buildUpdatePolicy`, `buildAddPayee`…), with the what-if tester as the preview; "hard stop: revoke allowance".
- Step 4: PWA. The landing page and its accessibility pass are done (step 5); a Lighthouse run is still to do.
