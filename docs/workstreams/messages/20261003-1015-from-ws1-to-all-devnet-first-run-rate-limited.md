---
from: ws1 (laptop session)
to: all (mainly ws2, ws9, architect)
date: 2026-10-03 10:15 UTC
subject: devnet first run: setup and x402 pass; the public RPC rate-limits us after about five transactions
---

Laptop queue items 1, 2 and 4 on devnet, at `c127cbe`. The demo keys are funded: owner-demo 1 SOL and 20 USDC (Circle faucet), agent 0.5, guardian 0.2, facilitator 1 SOL.

## What ran

| Step | Result |
| --- | --- |
| `pnpm devnet:setup` | Passed. USDC accounts for merchant and attacker: [`3gpGnvJS…`](https://explorer.solana.com/tx/3gpGnvJSwkQWMMiw9GBABzXpNYFii8EcojeJaAieVSgEeLvZsosWZEcp6Xqqvr8xwX3cMtVJ5DyCmzA6WLoGcPVx?cluster=devnet). Principal, agent, allowance and allowlist in one transaction: [`2VF2XUZK…`](https://explorer.solana.com/tx/2VF2XUZKWvVy3BgEHi84wfVKXZukqdF2Ldg6oAmLZ2kHynegEJS8trQJKBf6Dcu8rtj4bynX1HXo7Yfk93nEQmSh?cluster=devnet). |
| `x402:smoke` through `services/facilitator` on devnet | Passed: the first x402 payment through Leash on devnet, [`3v4TaKJ6…`](https://explorer.solana.com/tx/3v4TaKJ6d3H5oaDMJGX16nU2qfk81sPVikRh8d7u8c5bccHTH8ftZGHU4qbMVudKQSWUYuFnLKtL7CmiwPB8drZE?cluster=devnet). The attacker merchant was blocked and recorded. |
| `pnpm devnet:smoke`, three tries | Each step passed at least once: payments [`4zR48dJS…`](https://explorer.solana.com/tx/4zR48dJSP6qxNh3d7m3MnDuAjL9s5j5cAuM1QEGtawmCp7YxHr9ifoMcGGgPn2f2wQsQ8JSVRtKjW7wxbjqHzaur?cluster=devnet) and [`5kfTgfP8…`](https://explorer.solana.com/tx/5kfTgfP8k6vNkkAkdX24Ga5Huj1t162FH6AhkWHZqNn7VpAEABuYa42UeoTmjx8BPcuJTd1u6L3rWbkgpjP8iZTK?cluster=devnet), approval required, attacker blocked and recorded, the owner's freeze. No run finished: each stopped on `HTTP error (429): Too Many Requests` from `api.devnet.solana.com`. |
| `pnpm owner:unfreeze` | Worked twice, cleaning up after the interrupted runs: [`T38R4uTu…`](https://explorer.solana.com/tx/T38R4uTuFZVoHkb2BfynMjHRL6qrbnxZ5iGibFbEnJsL8195wMYu1w7nfNVjAxmXjWNCRJVX7zENJU1327oxGBw?cluster=devnet), [`47JjWfur…`](https://explorer.solana.com/tx/47JjWfurTh4jfLpLXeD8Cg8AQ2wtRiRHg2h65JrZB7XGu4U5CGSUn2tVfQzeLdpEosSRGqCNtvQud9aTeP2qPBoV?cluster=devnet). |

**Addresses:** principal `MwzmPwcu2CZZCGURQDyD9NJ4vFRXB6Y6Y1R7fMTKNoG`, agent PDA `JDNy1NEXo9QsT9FDEFzvLXaFhJwiaM2yDt27NTFQ4R1A`, delegation `DZboPDETT6Xyob1eVgUmC1QRa25KKCzAUd1dFYo31eaw` (5 USDC a day until 2026-11-02). Now: the agent is active with no strikes; owner-demo holds 19.96 USDC and 0.988 SOL.

## The problem: rate limits on the public RPC

The 429s came in the 4th to 6th transaction of a run, with nothing else using the RPC from this machine. Waiting 60 s between runs did not help.
- `rpcChain.sendAndConfirm` polls `getSignatureStatuses` and `getBlockHeight` every 500 ms, so each confirmation costs several requests.
- Nothing retries a 429. Some errors stay raw `SolanaError`s (`sendTransaction`'s), others become `LeashNetworkError`. Once a report fails, `leash: could not record a denied payment … SolanaError` follows.
- The demo adds the indexer polling every 2 s, Sentinel, and the agent's own reads. The live demo would hit this too.

**Requests:**
1. **Parth:** a free devnet RPC from Helius, QuickNode or Alchemy, for the demo. Every part already takes one: `LEASH_RPC_URL` (facilitator, indexer, Sentinel, agent-demo, MCP), `NEXT_PUBLIC_RPC_URL` (web), `--rpc <url>` (scripts).
2. **WS2:**
   - Retry 429s with backoff, honouring `Retry-After`, in `reading()` and in `sendAndConfirm`'s send and polls.
   - Poll statuses about once a second, and check the block height every few polls rather than every one.
   - Wrap send errors in `LeashNetworkError` too.

## Next on the laptop

With a dedicated RPC: `devnet:smoke` once more, then the indexer and Sentinel on devnet, `pnpm owner:unfreeze`, and the scripted storyline. Then the recording (queue item 7).
