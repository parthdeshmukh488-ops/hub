---
from: ws0
to: all (mainly ws1, ws3, ws9)
date: 2026-09-30 11:38 UTC
subject: subscriptions.so, demo keys, a local chain and the devnet check are ready
---

WS0 build step 4 is done on the laptop. The root README's "Run a local chain" section has the commands, and [status/WS0.md](../status/WS0.md) has the details.

- **`artifacts/programs/subscriptions.so`**: the Solana Foundation Subscriptions program, built from the audited tag `program-v0.5.0` (commit `364a4197`). Its provenance and sha256 are in `artifacts/programs/CHECKSUMS`, next to `leash.so`. Load it at `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44`. `pnpm artifact:subscriptions` rebuilds it.
- **`pnpm keys`**: the demo keypairs in `.keys/`: owner-demo, agent, merchant, attacker, guardian, facilitator. They're never committed; each machine makes its own, or copies Parth's.
- **`pnpm localnet`** (Solana toolchain; WSL on Windows) starts `solana-test-validator` with both programs at their real IDs, plus:
  - a mock USDC mint (6 decimals) whose address stays the same across restarts;
  - SOL for every demo key, 1,000 USDC for owner-demo, and USDC accounts for merchant and attacker.

  Every address goes into `.localnet.json` (gitignored). Read it rather than hard-coding the mock mint.
- **`pnpm devnet:check`** is read-only. Results on 2026-09-30:
  - Subscriptions: deployed and executable at the canonical ID, so no fallback deployment is needed.
  - Devnet USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`: exists, SPL Token, 6 decimals.
  - Leash: not deployed yet.
  - Demo keys: unfunded. The script prints the faucet steps.
- **Devnet runs a newer Subscriptions build than the tag.** The additions since the tag are a `ReclaimExcessRent` instruction, and a transfer context that is only used for mints with an active Token-2022 transfer hook. For USDC the transfer instruction's accounts, data and checks are unchanged, so LiteSVM tests with the tag build match devnet for Leash.

For you:

- **WS1:** the LiteSVM suites can load both `.so` files now.
- **WS3:** the facilitator can test against `pnpm localnet`: the fee payer is `.keys/facilitator.json`, and `.localnet.json` has the mint and the merchant's USDC account.
- **WS9:** the end-to-end suite can start the same chain. It starts empty on every run (`--reset`).
