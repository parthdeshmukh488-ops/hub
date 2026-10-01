# Coordination board

Maintained by the architect session. Every Claude session reads this at startup, right after `CLAUDE.md`. **Last updated: 2026-10-01.**

## Where the project stands

| Part | State |
| --- | --- |
| Architecture, ADRs, briefs | Done ([architecture/](../architecture/00-overview.md), [adr/](../adr/README.md)) |
| WS0 platform and contracts | **All five build steps done:** monorepo, `@leash/contracts`, demo fixtures, 60 policy test vectors, CI guards, and (laptop) `pnpm keys`, `subscriptions.so` from the audited tag, `pnpm localnet`, `pnpm devnet:check` ([status](status/WS0.md)). |
| WS2 SDK | **Build steps 1–6 done:** generated clients, PDAs, errors, event decoding, reads, owner builders, `LeashAgent`, `rpcChain`, `@leash/sdk/testing` (LiteSVM testbed on the real binaries), `devnet:setup`/`devnet:smoke`; 239 tests; RPC read failures are `NETWORK_ERROR`; `pnpm owner:approve` stands in for the owner's phone ([status](status/WS2.md)). Step 7 (API feedback, 1.0) next. |
| WS6 web app | **Steps 1 and 3 (read side) done:** live indexer data over REST + WebSocket, activity log with CSV, approvals inbox, what-if tester using the SDK evaluator ([status](status/WS6.md)). Writes wait for the wallet (step 2) and the IDL. |
| WS4 indexer | **Build step 1 done:** every REST route and `/v1/stream` in fixture-replay mode on port 4100, 42 tests; contracts 1.1.0 ([status](status/WS4.md)). |
| WS8 merchant and lab | **Build steps 1–2 done:** final content, catalog, lab with five guide variants; `MERCHANT_PAYMENTS=on` puts the official x402 middleware (via `leashMerchant`) on every paid route, paid by a real Leash agent in tests; 22 tests ([status](status/WS8.md)). |
| WS7 tools, MCP, demo agent | **Build steps 1–4 done:** `@leash/tools` plus its Node runtime; `@leash/mcp`, a stdio MCP server Claude Code connects to (10 tests); `apps/agent-demo` with a Claude loop, scene scripts, scripted mode and the terminal UI. The scripted pitch storyline passes end to end on the real stack in LiteSVM (35 tests). Real LLM runs and recordings: laptop ([status](status/WS7.md), [message](messages/20261001-0030-from-ws7-to-all-mcp-server-and-demo-agent-ready.md)). |
| WS1 program | **All seven steps done, live on devnet** (slot 505952773, byte for byte the committed `leash.so`): Anchor 1.2 program, IDL, program ID `HyL9S5mA…HJncu`. The LiteSVM suites run on the real binaries (66 tests, plus all 60 policy vectors on-chain); security checklist ticked; `pay` ≈ 32k CU ([status](status/WS1.md), [CU.md](../../programs/leash/CU.md)). |
| WS3 x402 + facilitator | **Build steps 1–5 done:** `@leash/x402` (Leash client scheme, `createLeashFetch`, `leashMerchant`, `createLeashFacilitator`), `services/facilitator`. Every row of the test table passes on the real binaries through the unmodified official facilitator; 29 tests ([status](status/WS3.md)). |
| WS5, WS9 | Skeletons only. Not started. |

## Who starts now

Start the sessions top-down, as many as you have terminals. Each session opens with the **starter prompt** at the bottom of its brief, then reads its messages in [messages/](messages/README.md).

| # | Session | Must run on | First build step | Unblocks |
| --- | --- | --- | --- | --- |
| 1 | **WS1** Leash program | your laptop (Solana toolchain) | Done, live on devnet. Rebuild and upgrade on the laptop after any program change. | the devnet demo |
| 2 | **WS2** SDK | anywhere | Steps 1–6 done. Step 7: API feedback from WS3, WS6, WS7, then 1.0. | almost everyone |
| 3 | **WS6** web app | anywhere | Steps 1 and 3 (read side) done. Step 2 (wallet + pairing) and step 3 writes need the IDL. | the demo UI |
| 4 | **WS0** step 4 | your laptop (Solana toolchain) | Done: keys, `subscriptions.so`, localnet, devnet check | WS1 program tests, every end-to-end run |
| 5 | **WS4** indexer | anywhere | Step 1 done. Step 2 (chain ingestion) needs the IDL and RPC access. | WS5, WS6 live data |
| 6 | **WS8** merchants and lab | anywhere | Steps 1–2 done (paid routes on through `leashMerchant`). | WS7 demo |
| 7 | **WS7** tools, MCP, agent | anywhere | Steps 1–4 done. Step 5: pitch polish with WS9. | the demo |
| 8 | **WS5** Sentinel | anywhere | Step 1: rules engine on the storyline fixture | alerts |
| 9 | **WS3** x402 + facilitator | anywhere | Steps 1–5 done. Next: a real run on localnet/devnet (laptop). | WS7, WS8 paid routes |
| 10 | **WS9** integration and story | anywhere | Step 1: README v1 + deck narrative | the pitch |

Fewer terminals? Combine sessions in this order:

- **2 terminals:** laptop = WS0 step 4 → WS1 · second = WS2 → WS3.
- **3 terminals:** add WS6 → WS4 → WS5.
- **4 terminals:** add WS8 → WS7 → WS9.

## Laptop queue (needs the Solana toolchain or devnet)

Parth runs one Claude session on the laptop, which has the Solana toolchain and devnet access. The cloud session writes and tests the code: LiteSVM runs there on the committed `.so` files. The laptop does only what needs a real chain, in this order. Each item names its trigger; see the [message](messages/20260930-1554-from-architect-to-ws1-laptop-queue.md) for details.

| # | Task | Trigger | Who |
| --- | --- | --- | --- |
| 1 | Fund the demo keys on devnet. SOL for `owner-demo`, `agent`, `guardian`, `facilitator`, `merchant`. About 20 devnet USDC for `owner-demo`. Check with `pnpm devnet:check`. | now | Parth in the browser (faucet.solana.com, faucet.circle.com); the laptop session verifies |
| 2 | `pnpm devnet:setup` (the demo world: principal, allowance, agents, allowlist) and `pnpm devnet:smoke` (one real payment, one blocked attempt reported, freeze and unfreeze). Commit the printed addresses and signatures. | **Ready** (WS2 message 20260930-1655); needs funded keys (item 1) | laptop session |
| 3 | Run the indexer in chain mode against devnet and check the smoke test's events come out as the contract JSON. | WS4 announces chain mode | laptop session |
| 4 | x402 end to end on a real chain: `LEASH_CLUSTER=localnet pnpm --filter @leash/facilitator start`, then `pnpm --filter @leash/x402 x402:smoke --cluster localnet` (paid request settles through Leash; attacker payee blocked and recorded). Then the same on devnet. WS8's merchant joins when its paid routes are on. | **Ready** (WS3 message 20260930-2015); devnet needs item 1 | laptop session |
| 5 | The demo agent on a real chain: `pnpm --filter agent-demo demo:all -- --scripted` (localnet, then devnet; the four terminals are in `apps/agent-demo/README.md`). Then LLM mode with `ANTHROPIC_API_KEY` and `--record`; promote good recordings. | **Ready** (WS7 message 20261001-0030); needs items 2 and 4 on that cluster | laptop session + Parth (API key) |
| 6 | The full demo on devnet, and its recording. | WS9, Oct 3–4 | laptop session + Parth |
| – | After any program change: rebuild, update `CHECKSUMS`, upgrade on devnet with the deployer key, and check that the dump equals the committed `.so`. | only if WS1's source changes | laptop session |

## Handoffs to announce

When you finish one of these, write a message to the listed sessions ([how](messages/README.md)):

| From | To | Message |
| --- | --- | --- |
| WS1 | WS2, WS4 | Interface-complete IDL committed + the real program ID |
| WS0 | WS1, WS3, WS9 | `artifacts/programs/subscriptions.so` + localnet script ready; devnet check results |
| WS2 | WS3, WS6, WS7 | Evaluator + read path ready; later: `LeashAgent` + `@leash/sdk/testing` ready |
| WS4 | WS5, WS6 | Fixture mode running on port 4100 |
| WS3 | WS7, WS8 | Facilitator + merchant helper ready |
| WS8 | WS7 | Merchant content + lab ready |

## Rules added since the briefs were written

- **Branch per session**, created from the latest `main`: `ws<N>/<slug>`. Push often. When a build step meets its definition of done, ask Parth to merge it into `main`. That merge is also how your messages reach other sessions.
- **TypeScript is pinned to 6.0.3** and shared versions are pinned in the root `package.json` ([ADR-0006](../adr/0006-monorepo-and-service-stack.md#pinned-versions-ws0-2026-09-29)). Don't bump them in a feature branch.
- **zod 4 keeps running checks after one fails.** Never write a `refine` that assumes an earlier check passed.
- **Three spec corrections:** [inclusive allowance expiry](../adr/20260929-ws0-allowance-expiry-is-inclusive.md), [switched-off limits are not tracked](../adr/20260929-ws0-disabled-limits-are-not-tracked.md), [denial reporting policy](../adr/20260929-ws0-denial-reporting-policy.md).
- **`main` is the default branch** (since 2026-09-30). Start new sessions from it; `claude/whu-hackathon-ideas-lz8trx` is kept level with it.
- **Contracts are 1.4.0** ([ADR 20260930-ws1-program-id](../adr/20260930-ws1-program-id.md), additive): the real Leash program ID `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu` is `LEASH_PROGRAM_ID` and `PROGRAM_IDS.leash`; the IDL's `address` carries it.
- **Contracts 1.3.0** ([ADR 20260930-ws1-program-interface](../adr/20260930-ws1-program-interface.md), additive): the program's IDL is committed at `packages/contracts/idl/leash.json` and CI fails if it drifts from the source. `DenialReason` code n is stored on-chain as n − 1. `pay` also checks the owner's ATA, the Subscription Authority and `InvalidDestination`.
- **Contracts 1.2.0** ([ADR 20260930-ws7-approval-request-errors](../adr/20260930-ws7-approval-request-errors.md), additive): two tool codes for failed approval requests, honest "recorded" sentence.
- **Contracts 1.1.0** ([ADR 20260930-ws4-fixture-replay](../adr/20260930-ws4-fixture-replay.md), additive): the storyline carries account facts, plus two replay env vars.
- **The Leash program ID is real** (see contracts 1.4.0 above). Regenerate generated clients from the committed IDL; take the ID from `PROGRAM_IDS.leash`, never a literal.
- **`artifacts/programs/leash.so`** is built on the laptop after every program change, with its provenance in `artifacts/programs/CHECKSUMS` (`sha256sum -c CHECKSUMS` verifies it). LiteSVM tests load it, so they run anywhere.
- **Rust toolchain is pinned to 1.98.1** (`rust-toolchain.toml`, CI): LiteSVM 0.17 needs ≥ 1.97.1 ([ADR-0004](../adr/0004-anchor-and-litesvm.md)). Cloud sessions can build, run every test (the LiteSVM suites load the committed `.so` files) and regenerate the IDL (`cargo run -p leash --example idl -- --write`), but not `leash.so`.
- **Money helpers, schemas and copy come from `@leash/contracts`.** If you need something that isn't there, message WS0 (or the architect) instead of redefining it locally.
