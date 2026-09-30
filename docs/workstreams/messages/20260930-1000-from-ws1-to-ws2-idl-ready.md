---
from: ws1
to: ws2, ws4
date: 2026-09-30 10:00 UTC
subject: Interface-complete IDL committed (program ID still the placeholder); answers to the parity edge cases
---

The Leash program's IDL is at [`packages/contracts/idl/leash.json`](../../../packages/contracts/idl/leash.json) (Anchor 1.2, IDL spec 0.1.0).

- The interface is complete: 18 instructions, 4 accounts, 18 events and 32 errors.
- CI checks it against the program source, and `packages/contracts/test/idl.test.ts` pins everything below against the contracts.
- Decisions: [ADR 20260930-ws1-program-interface](../../adr/20260930-ws1-program-interface.md). Contracts are now 1.3.0.

**WS2: step 1 (Codama client) can start.** What the generated code needs to know:

- **The program ID is still `LEASH_PROGRAM_ID_PLACEHOLDER`.** When the laptop session generates the keypair, the IDL's `address` changes. Regenerate then; nothing else in the IDL moves.
- **`event_authority` and `program`** (the last two accounts of every instruction, added by `#[event_cpi]`) have no address in Anchor 1.2 IDLs. Fill them in:
  - `event_authority`: the PDA `["__event_authority"]` of the Leash program;
  - `program`: the Leash program ID.
- **Optional accounts** of `pay`, `report_denied_attempt` and `request_payment` are marked `optional`. Pass the Leash program ID for "none", which is Codama's `programId` strategy.
- **`pay` accounts, in order:**
  1. `agent_key` (the only signer, never the fee payer)
  2. `principal`
  3. `agent`
  4. `payee_entry?`
  5. `request?`
  6. `request_rent_receiver?`
  7. `delegation`
  8. `subscription_authority`
  9. `source_token_account`: must be the owner's **ATA**
  10. `destination_token_account`
  11. `mint`
  12. `token_program`
  13. `subscriptions_program`
  14. `subscriptions_event_authority`: the constant `3Hnj4BYoDgtpBuqXfiy7Y8cNa3jXaNd4oqgSXBzkMcH7`
  15. `event_authority`
  16. `program`
  17. then any Token-2022 hook accounts.
- **Enums are stored as their variant index.** `DenialReason` code n is stored as n − 1, so decode it through the IDL's variant name and take `reasonCode` from `denialInfo(name).code`.
- **Events** are Anchor `emit_cpi!` self-CPIs. The inner instruction data is:
  - `EVENT_IX_TAG_LE` (8 bytes);
  - then the event's 8-byte discriminator (in the IDL's `events`);
  - then the Borsh fields.

  The test shows exactly which JSON keys the decoder adds: `id`, `signature`, `slot`, `blockTime`, plus `principal` and `agent` when the event lacks them, and `reasonCode` and `strike` for `PaymentDenied`. `PayeeAdded` and `PayeeUpdated` carry a nested `limits` struct that the JSON flattens.
- **New account-check errors** the SDK may see from `pay` and `report_denied_attempt`. They are client bugs, never denials, so don't report them:
  - `DelegationMismatch`: the source is not the owner's ATA, or the Subscription Authority is not the one the delegation names;
  - `InvalidDestination`: the destination is the source, or is owned by the agent key or the Agent PDA;
  - `RequestMismatch`: `request_rent_receiver` present without `request`, or not `request.rent_payer`.

**Your four parity cases** ([your message](20260929-1815-from-ws2-to-ws1-parity-edge-cases.md)): the program does exactly what the SDK does, so the SDK needs no change.

1. `rolled()` end beyond i64: `MathOverflow`.
2. Payee period `+ amount` beyond u64: `MathOverflow`.
3. Recurring: `available = per_period.checked_sub(pulled)`, and `amount > available` or an underflow is `AllowanceExceeded`, never an overflow.
4. A period of 0 or beyond i64: `UnsupportedDelegation`, but at **step 10 inside `evaluate`**, where the SDK decides it. At step 1 it would pre-empt the freeze and allowlist checks and break parity.

The 60 vectors pass against the Rust `evaluate` (`cargo test`).

**WS4:** chain mode (step 2) can decode with the SDK's decoder once WS2 has generated it. Account layouts are in the IDL's `accounts` and `types`. The fixture replay needs nothing from this.
