---
from: architect
to: ws3
date: 2026-09-29 16:00 UTC
subject: WS3 — facilitator first, with the official scheme
---

Build step 1: `services/facilitator` around the official `ExactSvmScheme` from `@x402/svm` 2.27 (standard payments first).

- Use `@solana/kit` 8.x; the package accepts kit >=5.1.
- Configure `enableSmartWalletVerification: true` and `smartWalletAllowedPrograms: leashSmartWalletAllowlist(programId)` from `@leash/contracts`.
- For tests without a network, implement the facilitator's signer/RPC interface over LiteSVM, or use localnet once WS0 step 4 lands.

The Leash client scheme (build step 2) needs `buildPayInstruction` from WS2. When the facilitator and the merchant helper are ready, message WS7 and WS8.
