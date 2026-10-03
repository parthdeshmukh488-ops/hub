---
from: architect (cloud session 1)
to: ws1 (the laptop session), parth
date: 2026-10-03 09:45 UTC
subject: the devnet run and the recording, step by step (laptop queue items 1–7)
---

Everything the demo needs is on `main` and green in CI:
- the program;
- x402 payments through the official facilitator;
- the demo agent and the merchants;
- the indexer, with its account snapshot;
- Sentinel and Telegram;
- the Solana Actions;
- the owner's actions in the web app (PR #5).

Only devnet and the recording are left, and only this laptop can do them: cloud sessions cannot reach devnet. Merge `main` first. Run every command from the repo root. Never print a key, and never commit `.keys/` or `.env`.

## 1. Funds and the demo world
1. `pnpm devnet:check` lists every key and what it lacks.
   - Parth funds them in his browser: SOL from faucet.solana.com for owner-demo, agent, guardian and facilitator, and 10–20 devnet USDC from faucet.circle.com for owner-demo.
   - Run it again until it is all green.
2. `pnpm devnet:setup --cluster devnet`, then `pnpm devnet:smoke --cluster devnet`. Record the addresses and signatures in `status/WS1.md` (no keys).

## 2. The services (one terminal each)
- Start the facilitator, the merchant with `MERCHANT_PAYMENTS=on`, and the indexer, as in [the agent-demo README](../../../apps/agent-demo/README.md#run-it-for-real-laptop), with `LEASH_CLUSTER=devnet`.
  - Run the indexer with `INDEXER_POLL_INTERVAL_MS=2000`.
  - At start it should log `account snapshot: the projections equal the chain`.
- Start Sentinel with `SENTINEL_GUARDIAN_KEYPAIR=.keys/guardian.json pnpm --filter @leash/sentinel start`. It reads the Telegram settings from the root `.env`.
  - Autofreeze can stay on: the storyline's burst comes from one tripped agent, so Sentinel adds no second freeze.
- Start the web app with `NEXT_PUBLIC_DATA_SOURCE=indexer NEXT_PUBLIC_LEASH_CLUSTER=devnet pnpm --filter @leash/web dev`.

## 3. Before every take: `pnpm demo:check --cluster devnet`
It checks, without sending anything:
- the SOL and USDC on the keys;
- that the agent is neither frozen nor carrying strikes that still count (with one left, the tripwire fires at strike 2);
- the allowance and the Research API's budget for the day (3 USDC: two full takes a day);
- requests left from earlier takes;
- that all five services answer: the merchant must answer its paid route with 402, and the indexer must see the agent.

Every ✗ prints the command that fixes it. Take only when it says "Ready for a take".

## 4. The take
- **The agent:** `pnpm --filter agent-demo demo:all -- --scripted`.
- **The owner approves the 1.50 USDC report in the web app's inbox:**
  - Parth imports owner-demo into a browser wallet on devnet himself. The session never prints the key.
  - The fallback is `pnpm owner:approve --cluster devnet`.
- **The phone** gets Sentinel's approval and tripwire alerts. For tappable buttons and Blinks, run the tunnel in [Demo on a phone](../../../apps/web/src/server/actions/README.md#demo-on-a-phone-laptop).
- **After each take:** unfreeze with the web app's toggle, or with `pnpm owner:unfreeze --cluster devnet`, which also clears leftover strikes. Then run `pnpm demo:check` again.
- **More impressive but riskier:** pair a fresh agent live from its pairing link in the web app, with Parth's own wallet as the owner. That wallet then needs devnet SOL and USDC of its own.

## 5. The recording
Follow [the storyboard](../../pitch/video-storyboard.md) and its honesty rules:
- "Solana devnet" only on devnet shots;
- the injection scene keeps its disclosure on screen;
- no speed-up without a label.

The [demo script](../../pitch/demo-script.md) has the timings and a fallback for every failure.

## 6. Report back
Write a message with:
- what passed, with explorer links;
- the timings;
- anything that failed, with its error.

Then the final README and deck pass:
- the devnet row → Done;
- the video link;
- the team;
- the test count.
