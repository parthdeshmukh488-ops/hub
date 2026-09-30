# The program interface as built: encodings, account checks, and the answers to 01 §13

- Status: Proposed (additive, contracts 1.3.0)
- Date: 2026-09-30
- Workstream: WS1
- Contract change: yes (affected: WS2, WS3, WS4, WS9)

## Context

WS1 build steps 1 and 3 turned [01-onchain-program](../architecture/01-onchain-program.md) into an Anchor program, `programs/leash`, and committed its IDL. The spec left some things open, and building it raised a few more:

- §5 says enums are "stored as `u8`" with the listed values. Borsh, which Anchor uses, stores an enum as its variant index. For `DenialReason`, whose codes start at 1, those two differ.
- §6.2 lists the errors `InvalidDestination` and `DelegationMismatch`, but not every check that raises them. It also does not say how the source token account or the Subscription Authority are verified.
- WS2 asked four overflow questions ([message](../workstreams/messages/20260929-1815-from-ws2-to-ws1-parity-edge-cases.md)). For invalid recurring periods it proposed rejecting at account validation.
- §9 does not say what `PaymentDenied.strikes` holds when the report adds no strike.
- §13 left three questions to WS1.
- The cloud sessions have no Anchor CLI and no Solana toolchain ([ADR-0007](0007-environments-and-artifacts.md)), but they still need to regenerate and check the IDL.

## Decision

1. **Versions** ([ADR-0004](0004-anchor-and-litesvm.md)):
   - Anchor 1.2.0 (`anchor-lang`, `anchor-spl`, `anchor-lang-idl` 0.1.4). The crates are co-owned by the Solana Foundation and maintained at github.com/otter-sec/anchor.
   - The host Rust toolchain is pinned to 1.94.1 in `rust-toolchain.toml` and in CI.
   - The Solana (Agave) and `litesvm` versions are pinned by the first SBF build on a machine with the toolchain.
2. **IDL without the Anchor CLI.**
   - `cargo run -p leash --example idl -- --write` calls the same builder with the same options as `anchor idl build`. It writes `packages/contracts/idl/leash.json` byte for byte as `anchor build` writes `target/idl/leash.json`.
   - `--check` fails when the committed IDL is stale, and CI runs it.
   - `packages/contracts/test/idl.test.ts` compares the IDL with this package:
     - errors equal `LEASH_ERRORS`;
     - the address equals `PROGRAM_IDS.leash`;
     - constants and seeds;
     - `pay`'s account order and flags;
     - enum variant order;
     - account and struct fields against the views;
     - event fields against the JSON events.
3. **Enum encoding.**
   - Every enum is stored as its variant index, and the IDL lists variants in that order.
   - For all enums except `DenialReason`, the index is the value in §5.
   - `DenialReason` code *n* is stored as *n − 1*. The code (1–12) is a logical number shared with the errors (`6000 + n − 1`) and the JSON `reasonCode`.
   - Decoders go through the IDL and read the variant name; nobody decodes these bytes by hand.
4. **`pay` and `report_denied_attempt` account checks** (step 1: errors, never denials). In addition to the checks the spec names:
   - The source must be the owner's **associated token account** for the mint (owner and address), the only account Subscriptions debits. Otherwise `DelegationMismatch`. This keeps the `InsufficientFunds` pre-check reading the right balance.
   - The Subscription Authority must be owned by Subscriptions and be the one the delegation names (`DelegationMismatch`). Subscriptions itself checks its contents. This replaces a PDA search on every payment.
   - `InvalidDestination`: the destination is the source, or is owned by the agent key or the Agent PDA. This mirrors `add_payee`'s `InvalidPayee`, so no payee mode lets an agent pay itself.
   - `request_rent_receiver` is present exactly when `request` is, and equals `request.rent_payer`; otherwise `RequestMismatch`. The same holds for `rent_receiver` in `reject_request` and `expire_request`.
   - Failed `has_one` checks raise named errors: `Unauthorized` (principal, agent key, owner), `MintMismatch` (mint), `RequestMismatch` (a request of another agent).
   - Subscriptions' event authority is checked against a constant (`3Hnj4BYo…MkMcH7`), which a unit test derives.
5. **Parity edge cases (WS2's message).** Cases 1–3 are implemented exactly as the SDK does them. Case 4 (a recurring period of 0 or beyond `i64`) is `UnsupportedDelegation` at **step 10, inside `evaluate`**, where the SDK decides it too. At step 1 it would run before the freeze and allowlist checks and break parity on those inputs. The SDK needs no change.
6. **Idempotent switches emit only on change.**
   - `freeze_principal` and `unfreeze_principal` are no-ops when there is nothing to change.
   - `freeze_agent` on a frozen agent keeps the first reason and emits nothing.
   - `unfreeze_agent` on an active agent emits nothing and leaves the strikes alone, so every state change has its event.
7. **`PaymentDenied.strikes`** is the number of strikes in the current window after the attempt:
   - For a strike, the new count.
   - For a report that adds no strike, the strikes still counting (0 once the window has ended), read without writing the window.
   - With the tripwire off, the stored count.
8. **Answers to §13.**
   - Anchor 1.2 accepts constraints on `Option<Account>`, but `pay` closes a consumed request itself: `AccountsClose::close` moves the lamports to `request_rent_receiver`, assigns the account to the system program and shrinks it to 0 bytes. Anchor's exit then skips it.
   - Payees are per agent.
   - The Subscriptions program ID stays the canonical one until WS0's devnet check says otherwise.
9. **IDL details clients must know.**
   - Anchor 1.2 publishes no address for the `event_authority` and `program` accounts that `#[event_cpi]` adds. Clients fill them in: the PDA `["__event_authority"]` of the program, and the program ID.
   - The IDL publishes `ACCOUNT_VERSION`, `MAX_OPEN_REQUESTS`, `MAX_REQUEST_TTL_SECS` and the four seeds. Byte lengths are carried by the array types.
10. **Program ID.** The placeholder stays until the program keypair is generated on a machine with the Solana toolchain (`.keys/leash-program.json`, never committed). Then:
    - `anchor keys sync` updates `declare_id!` and `Anchor.toml`;
    - the IDL is regenerated;
    - `PROGRAM_IDS.leash` changes through a one-line ADR;
    - WS2 regenerates its client.

## Consequences

- WS2 can generate the Codama client and event decoder from a committed, CI-checked IDL now. Whatever it relies on is pinned by `idl.test.ts`.
- The account checks close two substitution holes: another token account of the owner as the source, and a Subscription Authority not named by the delegation. The same checks also stop an agent in `AnyPayee` mode from paying itself.
- The handlers are written and compile, and their pure parts are unit-tested on the host. Their LiteSVM suites (01 §11) need `leash.so` and `subscriptions.so`, which only a machine with the Solana toolchain can build.

## Alternatives considered

- **Store `DenialReason` as its code (`#[borsh(use_discriminant = true)]`)**: the Anchor IDL cannot express explicit discriminants, so generated clients would decode every reason off by one.
- **A `reason_code: u8` event field instead of the enum**: truthful, but it loses the self-describing type the spec asks for, and the decoder would need a hand-written table.
- **Derive the Subscription Authority PDA in `pay`**: a PDA search on every payment, for a guarantee that the delegation field plus Subscriptions' own checks already give.
- **Install the Anchor CLI in cloud sessions for IDL generation**: a long compile in every new session, for the same builder the example calls directly.
