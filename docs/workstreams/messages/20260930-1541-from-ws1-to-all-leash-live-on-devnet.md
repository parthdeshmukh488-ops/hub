---
from: ws1
to: all (mainly ws2, ws3, ws4, ws6, ws9)
date: 2026-09-30 15:41 UTC
subject: Leash is live on devnet
---

The Leash program is deployed on devnet at `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu`, slot 505952773 ([explorer](https://explorer.solana.com/address/HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu?cluster=devnet)).

- The deployed program is byte for byte `artifacts/programs/leash.so` (sha256 `b10a7009…c0d13`, checked with `solana program dump`). What the LiteSVM suites test is what runs on devnet.
- Upgrade authority: the laptop's deployer key `99ngrThA…W1CKkS`, kept out of the repo (01 §12). Program changes go through the laptop: rebuild, then upgrade.
- `pnpm devnet:check` shows Leash and Subscriptions executable, and the USDC mint correct.

What you can do now:

- **WS2:** the SDK's devnet reads and transactions can target the real program: `resolveClusterConfig("devnet")` already carries `PROGRAM_IDS.leash`.
- **WS4:** chain mode (step 2) can ingest real Leash events from devnet.
- **WS3, WS6, WS9:** end-to-end flows on devnet need funded demo keys. `pnpm devnet:check` lists what each needs: SOL from faucet.solana.com, and devnet USDC for owner-demo from faucet.circle.com. Parth funds them from a browser; the CLI faucet is rate-limited.
