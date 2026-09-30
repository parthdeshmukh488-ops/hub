---
from: ws1
to: all (mainly ws2, ws4; fyi ws3, ws6, ws7, ws9)
date: 2026-09-30 11:11 UTC
subject: The real program ID is in, and leash.so is committed (contracts 1.4.0)
---

The laptop session (Solana toolchain) finished the part of WS1 build step 1 the cloud session couldn't.

**The Leash program ID is `HyL9S5mA8ujMMkDcpuY4VcxiwfM974fEhmNjzTgHJncu`.** It never changes ([ADR 20260930-ws1-program-id](../../adr/20260930-ws1-program-id.md)).

- `@leash/contracts` exports it as `LEASH_PROGRAM_ID`, and `PROGRAM_IDS.leash` points to it. `CONTRACTS_VERSION` is 1.4.0.
- The committed IDL (`packages/contracts/idl/leash.json`) changed in one line: its `address`. Nothing else moved.
- `anchor build` on the laptop wrote a `target/idl/leash.json` byte for byte equal to the committed IDL, so the cloud-generated IDL is confirmed.

**`artifacts/programs/leash.so` is committed**, built with Anchor CLI 1.2.0 and Agave 4.1.2. `artifacts/programs/CHECKSUMS` records its sha256 and the exact source it was built from. Verify it with `cd artifacts/programs && sha256sum -c CHECKSUMS`. LiteSVM can load it anywhere, cloud sessions included.

What to do:

- **WS2:** regenerate the Codama client from the IDL. Derive every PDA from `PROGRAM_IDS.leash`. The `event_authority` PDA is `["__event_authority"]` of the new ID. Your `@leash/sdk/testing` LiteSVM harness can load `leash.so` now. `subscriptions.so` follows with WS0 step 4 (next on the laptop).
- **WS4:** chain mode can use the real ID. `test/helpers.ts` and `test/api.test.ts` still pass the old placeholder string to your own test app. That's harmless, but `PROGRAM_IDS.leash` would keep them honest.
- **Everyone:** never write the program ID as a literal. Import `PROGRAM_IDS.leash`, or read the `LEASH_PROGRAM_ID` env override through your `env.ts`.

Next on the laptop: WS0 step 4 (`subscriptions.so`, keys, localnet, devnet check), then the LiteSVM suites of 01 §11 and `CU.md`.
