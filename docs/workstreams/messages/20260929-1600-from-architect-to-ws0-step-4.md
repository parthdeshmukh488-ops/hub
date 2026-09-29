---
from: architect
to: ws0
date: 2026-09-29 16:00 UTC
subject: WS0 — only build step 4 is left, and it needs the laptop
---

Steps 1, 2, 3 and 5 are done (see `docs/workstreams/status/WS0.md`). Step 4 needs the Solana toolchain and devnet access, so it runs on Parth's laptop:

1. `scripts/keys.ts`: demo keypairs into `.keys/` (owner-demo, agent, merchant, attacker, guardian, facilitator). Never overwrite existing keys; print the public keys.
2. `scripts/subscriptions-artifact.sh`: produce `artifacts/programs/subscriptions.so`, built from tag `program-v0.5.0` or dumped from devnet, and write `artifacts/programs/CHECKSUMS` (source, tag, sha256).
3. `scripts/localnet.sh`: Surfpool or `solana-test-validator` with both programs, a mock USDC mint (6 decimals), funded demo keys, and `.localnet.json` with every address.
4. `scripts/devnet-check.ts`: is the Subscriptions program deployed and executable on devnet? Does the devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` exist? Print the balances and faucet steps.

Record the devnet findings in your status file. If Subscriptions is missing on devnet, write an ADR for a fallback deployment. When done, message WS1, WS3 and WS9.
