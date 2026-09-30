# Coordination board

Maintained by the architect session. Every Claude session reads this at startup, right after `CLAUDE.md`. **Last updated: 2026-09-30.**

## Where the project stands

| Part | State |
| --- | --- |
| Architecture, ADRs, briefs | Done ([architecture/](../architecture/00-overview.md), [adr/](../adr/README.md)) |
| WS0 platform and contracts | Build steps 1, 2, 3, 5 done: monorepo, `@leash/contracts` 1.0.0 (144 tests), demo fixtures, 60 policy test vectors, CI guards. **Step 4 open** (local chain scripts; needs the Solana toolchain). |
| WS2 SDK | **Build step 2 done:** `evaluatePayment` and the allowance math, 60/60 vectors, 100 tests, 100% coverage ([status](status/WS2.md)). Step 1 waits for WS1's IDL. |
| WS6 web app | **Steps 1 and 3 (read side) done:** live indexer data over REST + WebSocket, activity log with CSV, approvals inbox, what-if tester using the SDK evaluator ([status](status/WS6.md)). Writes wait for the wallet (step 2) and the IDL. |
| WS4 indexer | **Build step 1 done:** every REST route and `/v1/stream` in fixture-replay mode on port 4100, 42 tests; contracts 1.1.0 ([status](status/WS4.md)). |
| WS8 merchant and lab | **Build step 1 done:** every route's final content, catalog, lab with five guide variants, 18 tests incl. Leash outcomes per route ([status](status/WS8.md)). Paywalls wait for WS3. |
| WS7 tools | **Build step 1 done:** `@leash/tools` (four tools, every error path, 19 tests); SDK typed errors; contracts 1.2.0 ([status](status/WS7.md)). Ports sent to WS2 and WS3. |
| WS1 program | **Steps 1 and 3 done in the cloud:** Anchor 1.2 program with every instruction written, IDL committed and CI-checked, Rust `evaluate` 60/60 vectors ([status](status/WS1.md)). **Laptop:** real program ID `HyL9S5mA…HJncu` and `artifacts/programs/leash.so` done. Next: LiteSVM suites (need `subscriptions.so`), devnet. |
| WS3, WS5, WS9 | Skeletons only. Not started. |

## Who starts now

Start the sessions top-down, as many as you have terminals. Each session opens with the **starter prompt** at the bottom of its brief, then reads its messages in [messages/](messages/README.md).

| # | Session | Must run on | First build step | Unblocks |
| --- | --- | --- | --- | --- |
| 1 | **WS1** Leash program | your laptop (Solana toolchain) | Steps 1 and 3, program ID and `leash.so` done. Next: the LiteSVM suites of steps 2 and 4–7 | every on-chain test |
| 2 | **WS2** SDK | anywhere | Step 2 done. **Step 1 can start: the IDL is committed**, then step 3. | almost everyone |
| 3 | **WS6** web app | anywhere | Steps 1 and 3 (read side) done. Step 2 (wallet + pairing) and step 3 writes need the IDL. | the demo UI |
| 4 | **WS0** step 4 | your laptop (Solana toolchain) | Keys, `subscriptions.so`, localnet, devnet check | WS1 program tests, every end-to-end run |
| 5 | **WS4** indexer | anywhere | Step 1 done. Step 2 (chain ingestion) needs the IDL and RPC access. | WS5, WS6 live data |
| 6 | **WS8** merchants and lab | anywhere | Step 1 done. Step 2 (paywalls) needs WS3. | WS7 demo |
| 7 | **WS7** tools, MCP, agent | anywhere | Step 1 done. Step 4 (MCP) can start; step 2 needs a real `LeashAgent`. | the demo |
| 8 | **WS5** Sentinel | anywhere | Step 1: rules engine on the storyline fixture | alerts |
| 9 | **WS3** x402 + facilitator | anywhere | Step 1: facilitator for standard payments | WS7, WS8 paid routes |
| 10 | **WS9** integration and story | anywhere | Step 1: README v1 + deck narrative | the pitch |

Fewer terminals? Combine sessions in this order:

- **2 terminals:** laptop = WS0 step 4 → WS1 · second = WS2 → WS3.
- **3 terminals:** add WS6 → WS4 → WS5.
- **4 terminals:** add WS8 → WS7 → WS9.

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
- **Rust toolchain is pinned to 1.94.1** (`rust-toolchain.toml`, CI). Cloud sessions can build, test and regenerate the IDL (`cargo run -p leash --example idl -- --write`), but not `leash.so`.
- **Money helpers, schemas and copy come from `@leash/contracts`.** If you need something that isn't there, message WS0 (or the architect) instead of redefining it locally.
