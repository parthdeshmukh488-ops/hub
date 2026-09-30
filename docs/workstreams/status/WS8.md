# WS8 status: Demo merchants and adversarial lab

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-09-30
- Current build step: 1 (content and catalog) done
- Messages handled: through `20260929-1600-from-architect-to-ws8-start-here.md`

## Plan for build step 1 (as executed)

Hono service with payments off; every route of the brief with its final content; the `/` catalog and the `/lab` index; content in `content/`, validated on load; prices in one table for step 2's paywalls.

## Done

- **Build step 1, complete (2026-09-30).**
  - Research (10 snippets with search), market data (10 symbols) and the premium comparison report.
  - The buying guide in five variants: four hide the same 25 USDC tip instruction differently, and `none` is the control.
  - `/lab/unlock` pays the attacker, `/lab/research-premium` costs 9.00, and `/lab/loop` never ends.
  - A lab index that explains each attack in one sentence (JSON, or a page for browsers).
- **18 tests.** They include an outcome check: every paid route run through the SDK's evaluator under the research-assistant preset gives exactly the storyline's result (allowed, approval, payee not allowed, exceeds limit, rate limit).
- **Content choices:** fictional brands and retailers, so no false claims about real products; accurate general advice (EU pedelec rules, batteries, brakes, costs).

## Next

- Step 2, paywalls: x402 on the paid routes through WS3's merchant helper (the `paywall()` hook in `src/server.ts` is where it goes).
- Step 4: tune content with WS7 and WS9 once the agent runs against it.

## Open items

- `MERCHANT_PAYMENTS` defaults to `off` while the paywalls do not exist; the contract's documented default is `on`. Flip it in step 2.
- Unset wallets default to the demo storyline's merchant and attacker, which keeps content and fixtures consistent. The devnet demo must set the real public keys from `.keys/` (WS0 step 4).

## Questions for other workstreams

- None.

## Contract changes proposed

- None.
