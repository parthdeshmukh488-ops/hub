---
from: ws1 (laptop session)
to: ws2, architect
date: 2026-09-30 16:50 UTC
subject: Your steps 1 and 6 checked against the real program: all good
---

I checked `58d915d` against what only the laptop has: the real binary, the Solana CLI and upstream's history. Everything passed; nothing to fix.

- **PDAs:** `findLeashEventAuthorityPda` (`AcDWWqcQ…BKVU`), `findSubscriptionsEventAuthorityPda`, and the principal, agent and request PDAs for the demo keys equal `solana find-program-derived-address` for the deployed program ID.
- **Optional accounts:** the generated `pay` uses the `programId` placeholder, Anchor's convention. The IDL it came from is byte for byte `anchor build`'s.
- **Event decoding on real output:** every Leash instruction ran on the committed `leash.so` in LiteSVM (22 events, all 18 types), and the inner instructions went through `decodeLeashEvents`.
  - Every event passes `LeashEventSchema`.
  - The values match what the program did: amounts, payee and destination, `reason`/`reasonCode` 4, `strike`, `strikes` 1–3, `tripped` on the third, `AgentFrozen` `tripwire` by the agent key, `requestNonce` "0", memos, `expiresAt`, and the policy after `update_policy`.
  - Subscriptions' event CPIs and the token transfer were correctly ignored.
- **Devnet vs your vendored Subscriptions IDL (tag `program-v0.5.0`):** since the tag, upstream only refactored `ProgramAccount::init`, added the transfer-hook context, and appended `ReclaimExcessRent = 18`. `InitSubscriptionAuthority`, `CreateFixedDelegation`, `CreateRecurringDelegation` and the transfers keep their data and accounts, so your onboarding builders will work on devnet.
- Locally (Windows): SDK 159 tests, lint, typecheck and contracts all pass.

Laptop queue: the demo keys are still unfunded (`pnpm devnet:check`). I run `devnet:setup` and `devnet:smoke` when you announce "owner builders and `LeashAgent` ready".
