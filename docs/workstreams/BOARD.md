# Coordination board

Maintained by the architect session. Every Claude session reads this at startup, right after `CLAUDE.md`. **Last updated: 2026-10-03.**

## Where the project stands

| Part | State |
| --- | --- |
| Architecture, ADRs, briefs | Done ([architecture/](../architecture/00-overview.md), [adr/](../adr/README.md)) |
| WS0 platform and contracts | **All five build steps done:** monorepo, `@leash/contracts`, demo fixtures, 60 policy test vectors, CI guards, and (laptop) `pnpm keys`, `subscriptions.so` from the audited tag, `pnpm localnet`, `pnpm devnet:check` ([status](status/WS0.md)). |
| WS2 SDK | **Build steps 1–6 done:** generated clients, PDAs, errors, event decoding, reads, owner builders, `LeashAgent`, `rpcChain`, `@leash/sdk/testing` (LiteSVM testbed on the real binaries), `devnet:setup`/`devnet:smoke`; 260 tests; `rpcChain`, and the facilitator's RPC through `createRetryingSolanaRpc`, retry devnet's 429s and 5xx with backoff; one blockhash per payment, fetched alongside the account read; RPC failures are `NETWORK_ERROR`; `pnpm owner:approve` stands in for the owner's phone; `pnpm demo:check` checks the demo world and the five services before a take ([status](status/WS2.md)). Step 7 (API feedback, 1.0) next. |
| WS6 web app | **Steps 1–4 done, on `main`:** live indexer data; the owner acts in the app (Wallet Standard wallet, approve and reject, freeze and unfreeze, the global switch, pairing from a link, the guardian); Solana Actions (Blinks); a landing page at `/` (PR #6). 117 unit tests and 15 Playwright tests, 8 of them live on LiteSVM with the real program ([status](status/WS6.md), [Actions](status/WS6-actions.md)). |
| WS4 indexer | **Build steps 1–4 done, on `main`:** every REST route and `/v1/stream`; chain mode with an account snapshot at start, a start-over only after three missed cursors (devnet RPC lag), stats checked on chain data, and an honest `/v1/health`. `@leash/indexer/testing` runs it in other packages' tests. 57 tests ([status](status/WS4.md)). |
| WS8 merchant and lab | **Build steps 1–2 done:** final content, catalog, lab with five guide variants; `MERCHANT_PAYMENTS=on` puts the official x402 middleware (via `leashMerchant`) on every paid route, paid by a real Leash agent in tests; 22 tests ([status](status/WS8.md)). |
| WS7 tools, MCP, demo agent | **Build steps 1–4 done:** `@leash/tools` plus its Node runtime; `@leash/mcp`, a stdio MCP server Claude Code connects to (10 tests); `apps/agent-demo` with a Claude loop, scene scripts, scripted mode and the terminal UI. The scripted pitch storyline passes end to end on the real stack in LiteSVM (35 tests). Real LLM runs and recordings: laptop ([status](status/WS7.md), [message](messages/20261001-0030-from-ws7-to-all-mcp-server-and-demo-agent-ready.md)). |
| WS1 program | **All seven steps done, live on devnet** (slot 505952773, byte for byte the committed `leash.so`): Anchor 1.2 program, IDL, program ID `HyL9S5mA…HJncu`. The LiteSVM suites run on the real binaries (66 tests, plus all 60 policy vectors on-chain); security checklist ticked; `pay` ≈ 32k CU ([status](status/WS1.md), [CU.md](../../programs/leash/CU.md)). |
| WS3 x402 + facilitator | **Build steps 1–5 done:** `@leash/x402` (Leash client scheme, `createLeashFetch`, `leashMerchant`, `createLeashFacilitator`), `services/facilitator`. Every row of the test table passes on the real binaries through the unmodified official facilitator; 29 tests ([status](status/WS3.md)). |
| WS5 Sentinel | **Build steps 1–5 done, on `main`** (second account): the seven alert rules (storyline snapshot test), the indexer stream client, console and Telegram alerts (plain text, untrusted text defanged), guardian autofreeze (off by default, checks the on-chain guardian), health on 4400; 101 tests ([status](status/WS5.md)). On the laptop the alerts reached Parth's phone, and the guardian froze all agents on a local validator ([report](messages/20261003-0945-from-ws1-to-ws5-sentinel-alerts-and-guardian-freeze.md)). |
| WS9 story | **README, the pitch documents and the final polish on `main`** (second account, PR #6): the deck (`.pptx`, PDF), demo script, judge Q&A, video storyboard, `pnpm demo` (the whole story on LiteSVM in one command), the MIT licence ([status](status/WS9.md)). Team (Parth, solo), test counts and the [demo video](../pitch/leash-demo-devnet.mp4) (2:19, in the repo) filled in on Oct 3. |

## Who starts now

Start the sessions top-down, as many as you have terminals. Each session opens with the **starter prompt** at the bottom of its brief, then reads its messages in [messages/](messages/README.md).

| # | Session | Must run on | First build step | Unblocks |
| --- | --- | --- | --- | --- |
| 1 | **WS1** Leash program | your laptop (Solana toolchain) | Done, live on devnet. Rebuild and upgrade on the laptop after any program change. | the devnet demo |
| 2 | **WS2** SDK | anywhere | Steps 1–6 done. Step 7: API feedback from WS3, WS6, WS7, then 1.0. | almost everyone |
| 3 | **WS6** web app | anywhere | Steps 1–4 done (owner actions in the app, Solana Actions), plus the landing page. Left: the accessibility pass (step 5), if time allows. | the demo UI |
| 4 | **WS0** step 4 | your laptop (Solana toolchain) | Done: keys, `subscriptions.so`, localnet, devnet check | WS1 program tests, every end-to-end run |
| 5 | **WS4** indexer | anywhere | Steps 1–4 done. Next: the devnet run on the laptop (it should log "account snapshot" at start). | WS5, WS6 live data |
| 6 | **WS8** merchants and lab | anywhere | Steps 1–2 done (paid routes on through `leashMerchant`). | WS7 demo |
| 7 | **WS7** tools, MCP, agent | anywhere | Steps 1–4 done. Step 5: pitch polish with WS9. | the demo |
| 8 | **WS5** Sentinel | anywhere | Steps 1–5 done, on `main`; the laptop's live run passed on a local validator. Next: Sentinel beside the indexer in the devnet demo run (laptop queue item 7). | alerts |
| 9 | **WS3** x402 + facilitator | anywhere | Steps 1–5 done. x402 through `services/facilitator` passed on localnet and on devnet (laptop, 2026-10-03). | WS7, WS8 paid routes |
| 10 | **WS9** integration and story | anywhere | Final polish merged (PR #6); team, test counts and the demo video in. Nothing left but Parth's review ([status](status/WS9.md)). | the pitch |

Fewer terminals? Combine sessions in this order:

- **2 terminals:** laptop = WS0 step 4 → WS1 · second = WS2 → WS3.
- **3 terminals:** add WS6 → WS4 → WS5.
- **4 terminals:** add WS8 → WS7 → WS9.

## Laptop queue (needs the Solana toolchain or devnet)

Parth runs one Claude session on the laptop, which has the Solana toolchain and devnet access. The cloud session writes and tests the code: LiteSVM runs there on the committed `.so` files. The laptop does only what needs a real chain, in this order. Each item names its trigger; see the [message](messages/20260930-1554-from-architect-to-ws1-laptop-queue.md) for details.

| # | Task | Trigger | Who |
| --- | --- | --- | --- |
| 1 | Fund the demo keys on devnet. SOL for `owner-demo`, `agent`, `guardian`, `facilitator`, `merchant`. About 20 devnet USDC for `owner-demo`. Check with `pnpm devnet:check`. | **Done** 2026-10-03 | Parth in the browser (faucet.solana.com, faucet.circle.com); the laptop session verifies |
| 2 | `pnpm devnet:setup` (the demo world: principal, allowance, agents, allowlist) and `pnpm devnet:smoke` (one real payment, one blocked attempt reported, freeze and unfreeze). Commit the printed addresses and signatures. | Setup **passed** on devnet. Every smoke step passed, but no run finished: the public RPC answered 429 ([report](messages/20261003-1015-from-ws1-to-all-devnet-first-run-rate-limited.md)). The SDK now retries; run it again with a dedicated RPC and `--rpc` ([how](messages/20261003-1030-from-architect-to-ws1-rate-limits-handled.md)). | laptop session |
| 3 | Run the indexer in chain mode against localnet, then devnet (`LEASH_CLUSTER=devnet INDEXER_POLL_INTERVAL_MS=2000 pnpm --filter @leash/indexer start`), and check the smoke test's events come out as the contract JSON on `/v1/owners/<owner>/events`. | **Ready** (WS4 message 20261001-0200) | laptop session |
| 4 | x402 end to end on a real chain. | **Done** on localnet and on devnet: the first x402 payment through Leash on devnet ([explorer](https://explorer.solana.com/tx/3v4TaKJ6d3H5oaDMJGX16nU2qfk81sPVikRh8d7u8c5bccHTH8ftZGHU4qbMVudKQSWUYuFnLKtL7CmiwPB8drZE?cluster=devnet)) | laptop session |
| 5 | The demo agent on a real chain: `pnpm --filter agent-demo demo:all -- --scripted` (localnet, then devnet; the four terminals are in `apps/agent-demo/README.md`). Then LLM mode with `ANTHROPIC_API_KEY` and `--record`; promote good recordings. | **Ready** (WS7 message 20261001-0030); needs items 2 and 4 on that cluster | laptop session + Parth (API key) |
| 6 | **Telegram on the laptop.** Parth gives this session the bot token for [@LeashmvpBot](https://t.me/LeashmvpBot) in the chat. Write it to the repo root's `.env` as `TELEGRAM_BOT_TOKEN`, never to a tracked file. Then Parth sends `/start` to the bot, and `TELEGRAM_CHAT_ID` comes from `https://api.telegram.org/bot<token>/getUpdates`. When WS5's Sentinel lands, run it against the indexer and check that the storyline's alerts reach Parth's phone. | **Done** on a local validator: the alerts reached Parth's phone and the guardian froze all agents ([report](messages/20261003-0945-from-ws1-to-ws5-sentinel-alerts-and-guardian-freeze.md)). On devnet: with item 7. | laptop session + Parth |
| 7 | The full demo on devnet, and its recording: step by step in [20261003-0945](messages/20261003-0945-from-architect-to-ws1-devnet-run-and-recording.md), with `pnpm demo:check --cluster devnet` before every take. | **Done:** the storyline passed on devnet twice, and the narrated [video](../pitch/leash-demo-devnet.mp4) (2:19, in the repo) replays the second take, with the real Telegram alerts on Parth's phone ([report](messages/20261003-1145-from-ws1-to-all-video-done-and-what-remains.md)). Next takes only after 09:50 UTC on Oct 4 (the Research API's daily budget), on the latest `main`. | laptop session + Parth |
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
