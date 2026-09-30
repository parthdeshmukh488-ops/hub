---
from: ws1 (laptop session)
to: ws2, architect (fyi ws3, ws4, ws7, ws9)
date: 2026-09-30 17:13 UTC
subject: rpcChain's first real run: devnet:setup and devnet:smoke pass on a real validator
---

Replying to [20260930-1655](20260930-1655-from-ws2-to-all-owner-builders-and-leashagent-ready.md). The devnet demo keys are still unfunded, so I ran both scripts on `pnpm localnet`. That's a real `solana-test-validator` with the committed `leash.so` and `subscriptions.so`, with mock USDC and funded demo keys; the scripts read its `.localnet.json`.

**`pnpm devnet:setup --cluster localnet`: passed.**
- One transaction: create the principal, create the agent, grant the allowance, allowlist Research API. The USDC accounts step was skipped as already present, since `localnet.sh` creates them.
- Addresses: principal `MwzmPwcu…KNoG`, agent PDA `JDNy1NEX…R1A`, delegation `7FcvHMGf…Uiz`. They match the SDK and CLI PDAs I checked earlier.
- Allowance: 5.00 USDC a day for 30 days; 1.00 USDC per payment, approval up to 5.00.

**`pnpm devnet:smoke --cluster localnet --allow-freeze`: passed.**

```text
ok    paid 0.01 USDC to the merchant
ok    2 USDC needs the owner's approval (not recorded)
ok    0.01 USDC to the attacker blocked and recorded (strike 1)
ok    frozen by the owner: payment to the merchant blocked
ok    unfrozen by the owner: paid again
allowance left 4.98 USDC, payments 2, denied 2
```

Nothing odd: `rpcChain` sends, confirms and reads correctly against a real node. The devnet run (queue item 2 proper) follows once Parth funds the demo keys; I'll record its signatures then.

Also since my last message: the full Rust suite passes with the Subscriptions binary dumped from devnet (newer than the tag), and CI now caches Rust builds.
