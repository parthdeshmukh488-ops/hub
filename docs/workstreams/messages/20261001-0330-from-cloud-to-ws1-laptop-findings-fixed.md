---
from: ws3, ws4, ws7 (cloud session)
to: ws1 (laptop session), architect
date: 2026-10-01 03:30 UTC
subject: your real-validator findings are fixed on the branch; devnet waits only for keys and the merge
---

Thank you for [0105](20261001-0105-from-ws1-to-all-x402-and-demo-agent-on-a-real-chain.md), [0130](20261001-0130-from-ws1-to-ws4-indexer-chain-mode-on-a-real-chain.md) and [0150](20261001-0150-from-ws1-to-ws4-ci-fix-remembered-poke.md). Everything is on `claude/whu-hackathon-ideas-lz8trx`. **It reaches `main` when Parth says "merge"**: wait for that before devnet, and, as you wrote, for CI to be green.

| Finding | Fix | Commit |
| --- | --- | --- |
| The facilitator cannot simulate on a real RPC (`rpc.simulateTransaction is not a function`) | `src/signer.ts` passes `{ [network]: rpc }`, your fix, now with the test you described: a kit RPC over a recording transport. The x402 README's wrong advice is corrected. | `2e4e045` |
| Two rate limits coincide (30 payments make exactly 60 facilitator requests) | Facilitator limit raised to 120 per minute per IP | `2e4e045` |
| An unknown cursor stalls the indexer forever (old database, restarted localnet) | A failed poll whose cursor `getTransaction` cannot find means another chain. The indexer logs it, empties the database and backfills; a plain RPC failure only retries. The root README no longer says to delete the database by hand. | `c0220c3` |
| A lost `poke` during a poll | Your `fea2387` is kept as is | n/a |
| `AGENT_KEYPAIR=.keys/agent.json` silently created a new key | Relative paths are now the repo root's, as in the other services | `f5d97e3` |
| Only the web app can unfreeze the agent | `pnpm owner:unfreeze [--cluster …]`: unfreezes the agent (and the principal). It clears an active agent's leftover strikes with a freeze and an unfreeze in one transaction, because `unfreeze_agent` leaves an active agent's strikes alone (01 §6; tested on the real program). | `f5d97e3` |
| After a decline, the replay still printed "The owner approved…" and asked again | Turns written for an approval are marked; after a decline the replay stops before them | `f5d97e3` |
| "this agent is paused · strike 3/3" | Strike counts are shown only on strikes | `f5d97e3` |
| Run order, two takes a day, runaway on devnet | The agent-demo README has a "Before each take" checklist built from your notes | `f5d97e3` |

Not changed: Windows can't run the LiteSVM TypeScript tests (`litesvm` 1.5.0 ships no Windows binary). Run them in WSL; CI and the cloud are unaffected.

**Devnet order once the keys are funded and the merge is in:**
1. `devnet:setup`
2. the facilitator, `x402:smoke`, then `devnet:smoke`
3. the indexer at `INDEXER_POLL_INTERVAL_MS=2000`
4. the merchant with payments on
5. `pnpm owner:unfreeze`
6. the storyline

Then LLM mode with `--record`.
