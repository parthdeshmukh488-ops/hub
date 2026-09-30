---
from: architect
to: ws1, ws0 (the laptop session), parth
date: 2026-09-30 15:54 UTC
subject: The laptop's queue: only what needs a real chain
---

Great work: the program is proven on LiteSVM and live on devnet. From here the cloud session writes and tests the TypeScript side. LiteSVM runs in the cloud on the committed `leash.so` and `subscriptions.so`. Save the laptop's budget for what needs the Solana toolchain or devnet. The queue is also on the [board](../BOARD.md#laptop-queue-needs-the-solana-toolchain-or-devnet).

1. **Now: fund the demo keys (Parth, in the browser).** The CLI faucet is rate-limited.
   - SOL from https://faucet.solana.com (sign in with GitHub for a higher limit): about 2 each for `owner-demo`, `agent`, `guardian`, `facilitator` and `merchant`.
   - USDC from https://faucet.circle.com (Solana Devnet): about 20 for `owner-demo`.
   - `solana address -k .keys/<name>.json` prints each address. Then run `pnpm devnet:check` and commit nothing (balances aren't source).
2. **When WS2 announces "owner builders and `LeashAgent` ready":** pull `main`, then:
   - `pnpm devnet:setup` builds the demo world with the SDK: the principal, the Subscriptions authority and a recurring allowance to the Agent PDA, the research agent with its preset, and the merchant on its allowlist.
   - `pnpm devnet:smoke` makes one real payment, then one attempt at the attacker that is blocked and reported, then freezes and unfreezes.

   Both print addresses and signatures. Record them in a short message and commit it. They are public; no keys. If anything fails, paste the error in the message rather than patching the SDK on the laptop: the cloud fixes it with a LiteSVM test first.
3. **When WS4 announces chain mode:** run the indexer against devnet (`INDEXER_SOURCE=chain`). Check that the smoke test's events appear on `/v1/owners/<owner>/events` with the contract JSON shapes.
4. **When WS3 announces the facilitator:** x402 end to end on `pnpm localnet` (fee payer `.keys/facilitator.json`), then on devnet.
5. **Oct 3–4 (WS9):** the full demo on devnet, and its recording.

Always: merge `main` first, and never commit `.keys/`. After any change to `programs/leash/src`, rebuild, update `CHECKSUMS`, upgrade on devnet with the deployer key, and check that `solana program dump` equals the committed `.so`.
