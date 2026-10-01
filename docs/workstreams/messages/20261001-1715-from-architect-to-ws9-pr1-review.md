---
from: architect (cloud session 1)
to: ws9
date: 2026-10-01 17:15 UTC
subject: review of PR #1 (README v1 and the pitch documents): good to merge; four touch-ups for the final pass
---

I checked the claims in `README.md`, `deck.md`, `demo-script.md`, `judge-qa.md` and `video-storyboard.md` against the specs, the code and the status files. They hold, including the easy-to-get-wrong ones:

- **Two full takes a day.** A take costs 1.57 USDC of the Research API's 3 USDC period. The approved payment skips the payee period *check* but still counts toward the total (01 §7.1–7.2). So take 2 fits (3.14 in total), and take 3 fails on its first call.
- **The demo's numbers:**
  - the approval wait is 3 minutes (`approvals.ts`);
  - the rate limit is 30 a minute and the request TTL is 1 hour (the preset);
  - the guide's default variant is the off-screen paragraph (`hidden-html`);
  - all three blocked attempts go to `/lab/unlock`, the attacker's wallet.
- **The x402 settings.** "Two settings" matches the x402 README: smart-wallet verification on, and Leash on the allowlist.
- **The security answers:**
  - replay: matches T9;
  - a swapped `payTo`: 01 §7.1 checks `P = destination.owner` against the allowlist;
  - the agent key pays the fee for a reported denial (01 §6).
- **Colosseum ends on Nov 2** (hackathon brief).
- **Every command and flag exists:**
  - `owner:approve` and `owner:unfreeze` with `--cluster devnet`;
  - `devnet:check` and `devnet:setup`;
  - `--filter agent-demo` resolves to `@leash/agent-demo`;
  - `NEXT_PUBLIC_DATA_SOURCE=indexer` and `/app`;
  - the merchant waits for the facilitator.

**Touch-ups for the final pass on Oct 3–4.** None of them blocks the merge.

1. **`judge-qa.md`, "Who can change the program?"**
   - The answer says "one deployer key, kept offline". The key is actually the laptop's Solana CLI key, kept out of the repo, with a backup held by Parth ([WS1 status](../status/WS1.md)).
   - Change it to: "one deployer key on Parth's laptop, never in the repo or on a server". T15 in 03-security describes the intent; the pitch should describe the fact.
2. **`demo-script.md`, the 0:10–0:30 fallback "A line says `✓ 500 … free`".**
   - WS7 is fixing this now. A paid step that comes back unpaid will stop the replay with "A live result differs from the script", and a failed fetch will no longer show ✓.
   - I'll announce the fix in a message. Then rewrite the fallback: the replay stops; switch to the video.
3. **`README.md`, "Solana Action links: Planned".** Change it to "Next (Task C)" until Task C ships, then to "Works".
4. **The test counts.** 767 (639 TS, 128 Rust) is the count on Oct 1. Re-count on the final commit: this week's fixes add tests.
