---
from: ws1 (laptop session)
to: all (mainly ws9, architect)
date: 2026-10-03 10:50 UTC
subject: the whole pitch storyline passes on devnet (rehearsal take); RPC split; three things for the recording
---

Replying to [20261003-0945](20261003-0945-from-architect-to-ws1-devnet-run-and-recording.md) and [20261003-1030](20261003-1030-from-architect-to-ws1-rate-limits-handled.md), at `cecef15`.

## The rehearsal take, on devnet

`pnpm demo:check --cluster devnet` said "Ready for a take" after one `pnpm owner:unfreeze` (a strike left by `x402:smoke`). Then `demo:all -- --scripted`, with every service running on devnet:

| Scene | What happened on devnet |
| --- | --- |
| Normal work | 5 payments over x402, 0.07 USDC: [`2Jkx…`](https://explorer.solana.com/tx/2JkxwonzaboCGRW1x3kPSNuCUHRv69RErhGFKgUnf16H1qAtEx24rUEtevB77AokwywZs3jUDfVEAXtaK2Y98k4G?cluster=devnet), [`2zmn…`](https://explorer.solana.com/tx/2zmneJ1NwAspFsqzoT9NRDsH6nsvR5MbwzZsFvcSnQsx7ak19TG2UFhuAtUk66Y41jHJvX8f6ZaGADy381Ap611q?cluster=devnet), [`4w6r…`](https://explorer.solana.com/tx/4w6rXMgxftChQfndhDzKsYCiAGgqyen53PsDZfUd5cK2VurWhiqFdqsA5tDLJWvH3w8beJdaZ2sXQvUsxn7skDqT?cluster=devnet), [`5LQi…`](https://explorer.solana.com/tx/5LQip2xbtczVmjxncg2hrMSoKNZHLB3WTdys388GeHkJ3UQHVC8SAcBVa6pVhbN6WHoJGJkYh2fN3qkYcEBbGYAb?cluster=devnet), [`3mz1…`](https://explorer.solana.com/tx/3mz1iSAkjhL9KgzRJ7sG577j5XH8J1QKUGnSoKKrdRGJm71GpHS8ZTr8Nvsqajo5J4qzP75ajE4e7BYJeSpsYUvb?cluster=devnet) |
| Approval | Request, `pnpm owner:approve --cluster devnet`, then 1.50 USDC paid with the approved request: [`3Uo5…`](https://explorer.solana.com/tx/3Uo5aweQ2uxcYh1XX5QfCxwiiayBvWfj6Jg9W6yqAzkiycNAWcEztPfx82peUZNaFa63ShY8qnnAVYYPHyDEiU3F?cluster=devnet). The explorer shows the owner's USDC going straight to the merchant through the Subscriptions program, with the facilitator as fee payer. |
| Injection | Three blocked attempts, strikes 1, 2 and 3 recorded on-chain, then the tripwire froze the agent: [`aLhh7Kdi…`](https://explorer.solana.com/tx/aLhh7KdigraxH56bLRzpTBmUHK6Gd3e8MHmGFSdcbjGQ2DRcGAkxuDnqZSt4RmAv88DuVXz7xnnwktBFBRMr4rW?cluster=devnet) |

- **Indexer** (devnet, 2 s polls): followed every event, 37 for the owner so far.
- **Sentinel:** sent the approval and tripwire alerts to Parth's phone.
- **Afterwards:** `pnpm owner:unfreeze --cluster devnet` and `demo:check` say "Ready for a take" again. 1.36 USDC of today's Research API budget is left: one more take today, two tomorrow after about 09:50 UTC.

## The RPC split

- **Alchemy's free tier refuses `getProgramAccounts`** ("not available on the Free tier"), and the SDK reads (`fetchPayees`, `fetchAgentViews`) and the indexer need it. So Alchemy serves only the facilitator: the root `.env` holds it as `FACILITATOR_RPC_URL`, and the facilitator starts with `LEASH_RPC_URL` set from it.
- **Everything else** uses `api.devnet.solana.com` with the new retries. No 429 reached the screen in the take.
- **`devnet:smoke` now finishes on the public RPC.**

## For the recording (WS9)

1. **About 20 s per paid call on devnet**, against 0.5 s on localnet. The normal scene takes about 2 minutes, and the whole take about 3.5 with the approval. Plan cuts, or a labelled speed-up as the storyboard allows.
2. **The agent's name differs:** the demo screen says "Research Assistant", but `devnet:setup` labels the agent "Research agent", so Sentinel's alerts and the explorer say that. One name in `devnet:setup` would make them match. A label change on devnet needs `update_policy` or a new agent, so decide before the recording.
3. **The web app in live mode shows the connected wallet's agents.** To show the owner's dashboard, Parth imports owner-demo into a devnet browser wallet (it is `.keys/owner-demo.json`; the session never prints it). Without that, approvals come from `pnpm owner:approve`.

## Next

The recording, with Parth: one take today, or two tomorrow morning.
