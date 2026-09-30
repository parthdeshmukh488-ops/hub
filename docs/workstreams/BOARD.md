# Coordination board

Maintained by the architect session. Every Claude session reads this at startup, right after `CLAUDE.md`. **Last updated: 2026-09-30.**

## Where the project stands

| Part | State |
| --- | --- |
| Architecture, ADRs, briefs | Done ([architecture/](../architecture/00-overview.md), [adr/](../adr/README.md)) |
| WS0 platform and contracts | Build steps 1, 2, 3, 5 done: monorepo, `@leash/contracts` 1.0.0 (144 tests), demo fixtures, 60 policy test vectors, CI guards. **Step 4 open** (local chain scripts; needs the Solana toolchain). |
| WS2 SDK | **Build step 2 done:** `evaluatePayment` and the allowance math, 60/60 vectors, 100 tests, 100% coverage ([status](status/WS2.md)). Step 1 waits for WS1's IDL. |
| WS6 web app | **Build step 1 done:** Next.js shell, design system, overview and agent pages on sample data ([status](status/WS6.md)). |
| WS4 indexer | **Build step 1 done:** every REST route and `/v1/stream` in fixture-replay mode on port 4100, 42 tests; contracts 1.1.0 ([status](status/WS4.md)). |
| WS1, WS3, WS5, WS7–WS9 | Skeletons only. Not started. |

## Who starts now

Start the sessions top-down, as many as you have terminals. Each session opens with the **starter prompt** at the bottom of its brief, then reads its messages in [messages/](messages/README.md).

| # | Session | Must run on | First build step | Unblocks |
| --- | --- | --- | --- | --- |
| 1 | **WS1** Leash program | your laptop (Solana toolchain) | Step 1: interface-complete IDL + real program ID | WS2 client generation, WS4 decoding |
| 2 | **WS2** SDK | anywhere | Step 2 done. Step 1 once the IDL lands, then step 3. | almost everyone |
| 3 | **WS6** web app | anywhere | Step 1 done. Step 2 (wallet + pairing wizard UI) next. | the demo UI |
| 4 | **WS0** step 4 | your laptop (Solana toolchain) | Keys, `subscriptions.so`, localnet, devnet check | WS1 program tests, every end-to-end run |
| 5 | **WS4** indexer | anywhere | Step 1 done. Step 2 (chain ingestion) needs the IDL and RPC access. | WS5, WS6 live data |
| 6 | **WS8** merchants and lab | anywhere | Step 1: content + catalog, payments off | WS7 demo |
| 7 | **WS7** tools, MCP, agent | anywhere | Step 1: `@leash/tools` against a mocked agent | the demo |
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
- **`main` exists** (created 2026-09-30 from `claude/whu-hackathon-ideas-lz8trx`). Start new sessions from it.
- **Contracts are 1.1.0** ([ADR 20260930-ws4-fixture-replay](../adr/20260930-ws4-fixture-replay.md), additive): the storyline carries account facts, plus two replay env vars.
- **The Leash program ID is a placeholder** (`LEASH_PROGRAM_ID_PLACEHOLDER`) until WS1 records the real one.
- **Money helpers, schemas and copy come from `@leash/contracts`.** If you need something that isn't there, message WS0 (or the architect) instead of redefining it locally.
