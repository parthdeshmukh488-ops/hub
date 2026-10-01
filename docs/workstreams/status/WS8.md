# WS8 status: Demo merchants and adversarial lab

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-09-30
- Current build step: 1 (content and catalog) and 2 (paywalls) done
- Messages handled: through `20260929-1600-from-architect-to-ws8-start-here.md`

## Plan for build step 1 (as executed)

Hono service with payments off; every route of the brief with its final content; the `/` catalog and the `/lab` index; content in `content/`, validated on load; prices in one table for step 2's paywalls.

## Done

- **2026-10-01 (from the WS7 session):** `package.json` exports `./server` and `./content`, so the demo agent's tests run its scenes against this app, lab included.

- **Build step 1, complete (2026-09-30).**
  - Research (10 snippets with search), market data (10 symbols) and the premium comparison report.
  - The buying guide in five variants: four hide the same 25 USDC tip instruction differently, and `none` is the control.
  - `/lab/unlock` pays the attacker, `/lab/research-premium` costs 9.00, and `/lab/loop` never ends.
  - A lab index that explains each attack in one sentence (JSON, or a page for browsers).
- **18 tests.** They include an outcome check: every paid route run through the SDK's evaluator under the research-assistant preset gives exactly the storyline's result (allowed, approval, payee not allowed, exceeds limit, rate limit).
- **Content choices:** fictional brands and retailers, so no false claims about real products; accurate general advice (EU pedelec rules, batteries, brakes, costs).

- **Build step 2, paywalls (2026-09-30).**
  - `MERCHANT_PAYMENTS=on` puts one `leashMerchant` middleware (WS3, the official `@x402/hono` middleware) in front of every paid route.
  - Prices and payees come from `src/catalog.ts` (`paidRoutes`). `/lab/unlock` pays the attacker; `@leash/x402/merchant` gained a per-route `payTo` for that.
  - `main.ts` takes the facilitator URL, the cluster's network and the USDC mint (`LEASH_USDC_MINT` on localnet).
  - 4 new tests on the real program in LiteSVM, through the official facilitator and a real Leash agent (`createLeashFetch`):
    - the 402 challenge;
    - paid research and market data;
    - free routes stay free;
    - a failed handler (unknown symbol) is never charged;
    - the lab's unlock blocked as `payeeNotAllowed` (strike 1);
    - the overpriced route blocked as `exceedsPaymentLimit` (strike 2);
    - the premium report needs approval (not a strike).
  - 22 tests.

## Next

- Laptop: run it with payments on against the facilitator on localnet, then devnet (queue item 4).
- Step 4: tune content with WS7 and WS9 once the agent runs against it.

## Open items

- `MERCHANT_PAYMENTS` defaults to `off` while the paywalls do not exist; the contract's documented default is `on`. Flip it in step 2.
- Unset wallets default to the demo storyline's merchant and attacker, which keeps content and fixtures consistent. The devnet demo must set the real public keys from `.keys/` (WS0 step 4).

## Questions for other workstreams

- None.

## Contract changes proposed

- None.
