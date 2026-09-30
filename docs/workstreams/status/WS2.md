# WS2 status: TypeScript SDK

- Session branch: `claude/whu-hackathon-ideas-lz8trx` (cloud session; Parth asked it to continue with the next step)
- Last updated: 2026-09-30
- Current build step: 1–6 done; 7 (API feedback, 1.0) next
- Messages handled: through `20260930-1713-from-ws1-to-ws2-rpcchain-first-real-run.md`

## Plan for build step 2

1. `src/evaluate/`: `evaluatePayment(input)`, a line-by-line mirror of 01-onchain-program §7 plus the three `20260929-ws0-*` ADRs. Inputs use the shapes Codama will decode (`bigint` for u64/i64, `number` for u8/u16/u32), so decoded accounts plug straight in later. It returns the outcome and, for allowed payments, the post-payment counters. Arithmetic is checked: a u64 overflow is a `MathOverflow` error, as on-chain.
2. `src/allowance.ts`: the Subscriptions semantics. Inclusive expiry, the recurring roll-forward with the expiry clamp, remaining allowance, `allowanceAt` (→ `AllowanceView`), and `decodeDelegation` for the v1 account layout (01 §8.3).
3. `src/testing/`: `testKeyAddress(name)`, the documented test-key derivation (ed25519 seed = sha256("leash:test-key:" + name)).
4. Tests: all 60 policy vectors (outcomes and effects), allowance and decoding unit tests, and property tests for the invariants the evaluator must never break (I1–I3). 100% branch coverage on the evaluator and allowance code.

## Done

- **Build step 2, complete (2026-09-29).** `packages/sdk`:
  - `src/evaluate/`: `evaluatePayment(input)` and `rollWindow`, a line-by-line mirror of 01 §7.1–§7.3 and the three `20260929-ws0-*` ADRs. Allowed results carry the counters the program would write (velocity window, payee period, delegation period or remaining amount, whether a request is consumed).
  - `src/allowance.ts`: `isAllowanceExpired`, `rollRecurringPeriod`, `allowanceRemaining`, `decodeDelegation` (v1 layouts only; anything else throws `LeashSdkError` `UNSUPPORTED_DELEGATION`), `allowanceAt` (→ contracts `AllowanceView`). Checked line by line against upstream `transfer_validation.rs`, including `saturating_sub` and the i64 period conversion.
  - `src/testing/`: `testKeySeed`, `testKeyAddress`.
  - 100 tests: all 60 policy vectors (outcomes and effects), allowance and decoding units, overflow and malformed-input cases, and fast-check properties for I1, I2, I3, strike marking and purity. Coverage 100% (statements, branches, functions, lines), enforced in `vitest.config.ts`.
  - README with usage, guarantees and the edge-case table.
- API refinements against the brief's target shape: `decodeDelegation(address, data)` returns `DecodedDelegation` (the brief said `decodeDelegation(data): DelegationData`), and `evaluatePayment` also returns the effects of an allowed payment and the strike flag of a denial.
- Messages sent: `20260929-1815-from-ws2-to-ws1-parity-edge-cases.md`, `20260929-1815-from-ws2-to-all-evaluator-ready.md`.

- 2026-09-30 (from the WS4 work): `allowanceAt` accepts any `{ address, mint, state }`, so the indexer can compute views from its stored delegation state. Type widening only; all 100 tests unchanged.

- 2026-09-30 (from the WS7 work): typed errors in `src/errors.ts` (`PaymentDeniedError` with `attempted`, `ApprovalNotPossibleError`, `NotPairedError`, `UnsupportedPaymentError`, `MerchantRejectedError`, `LeashNetworkError`), as the brief planned. WS7's port for `LeashAgent` is in `packages/tools/src/ports.ts` (message 20260930-0500).

- **Build steps 1 and 6, complete (2026-09-30).** `packages/sdk`:
  - `scripts/generate.ts` (`pnpm --filter @leash/sdk generate`): Codama clients in `src/generated/leash` (from the committed IDL, program `HyL9S5mA…Jncu`) and `src/generated/subscriptions` (from `idl/subscriptions.json`, vendored byte for byte from `solana-foundation/subscriptions` tag `program-v0.5.0`, sha256 `15225803…ffe89aa`). The official `@solana/subscriptions` 0.5.0 targets kit 7; generating our own keeps a single kit (8.4.0) in the tree. `packages/sdk/biome.json` keeps Biome off both.
  - `src/pda.ts`: every PDA of 02 §2.3 on both programs, plus both event authorities. The Subscriptions one matches the program's constant `3Hnj4BYo…kMcH7`.
  - `src/program-errors.ts`: `findLeashFailure` (kit errors through their `cause` chain, and raw simulation `err` JSON; only the Leash program's own custom codes count), `toSdkError` (`PaymentDeniedError` / `ApprovalNotPossibleError` / new `LeashProgramError`, code `PROGRAM_ERROR`).
  - `src/convert.ts`: chain enums ↔ contract names (exhaustive records, checked against the contract codes), `policyToView`, `policyFromView`, `payeeLimitsFromView`.
  - `src/events.ts`: `decodeLeashEvents` for all 18 events → contract `LeashEvent` JSON (ids `${signature}:${n}`, failed transactions skipped, `blockTime` falling back to the event's timestamp, `principal` filled through an optional `principalOf` lookup for agent-level events). `transactionRecordFromRpc` adapts kit's `getTransaction` (json) response, including loaded addresses.
  - 159 tests; 100% coverage now also enforced on events, convert, pda and program-errors. Label, memo and reference codecs stay in `@leash/contracts` (`encodeLabel`, `encodeMemo`, `referenceFromHex`).
- Handled: WS1's 20260930-1111 (regenerated against the real program ID), 20260930-1523 (2040 `ConstraintDuplicateMutableAccount` stays an unknown error: `findLeashFailure` returns null, so the pay flow never reports it), WS7's 20260930-0500 (the `LeashAgent` shape for steps 5), WS0's 20260930-1138 (testbed loads both `.so` files).

- **Build steps 3–5, complete (2026-09-30).** `packages/sdk`, commits `921930d` and `2d68638`:
  - `src/chain.ts`: the `LeashChain` port (accounts, program accounts, blockhash, simulate, send and confirm, recent transactions). `src/rpc-chain.ts` implements it over a kit RPC, confirming by polling `getSignatureStatuses` (no websocket). `@leash/sdk/testing` implements it with LiteSVM, with errors shaped like an RPC's.
  - Step 3, `src/read.ts`: `fetchPrincipalView`, `fetchAgentView`, `fetchAgentViews`, `fetchPayees`, `fetchOpenRequests`, `readAgentStatus`, and the pure mappers. Accounts are checked by owner program and discriminator.
  - Step 4, `src/owner.ts`: `buildOnboarding` does everything in one transaction on the testbed:
    - principal, agent, allowlist;
    - the Subscription Authority and a recurring or fixed delegation, created with Subscriptions' same-slot sentinel `UNKNOWN_INIT_ID`, or with the real init id when the authority exists;
    - resumable, and packed by size.
    It also includes every admin builder, including revoke allowance and expire request.
  - Step 5, `src/agent.ts`: `LeashAgent` implements WS7's port. It covers the ADR-0002 pay flow (reporting policy and 60 s cooldown), approved-request reuse, `requestApproval` per the approval ADR, the per-agent queue, idempotency by reference, `buildPayInstruction`, `reportDenied`, `simulatePay`, and compute units from simulation. On a parity mismatch it trusts the simulation and warns. It also warns when the agent key is low on SOL.
  - `@leash/sdk/testing`: `createTestbed()` onboards through `buildOnboarding` itself.
  - `pnpm devnet:setup` / `pnpm devnet:smoke` (laptop queue item 2): the research-assistant preset, USDC accounts for merchant and attacker, then an allowed, an approval-required and a recorded blocked payment.
  - 236 tests, most on the real `leash.so` and `subscriptions.so`. Coverage: 100% on the evaluator, events, conversions, PDAs and program errors; 95% or more of branches elsewhere (04 §4: meaningful coverage, not chased).
- **Decisions in steps 3–5** (Parth, please confirm or steer):
  1. **A revoked allowance reads as `allowanceExpired`, unrecorded.** With no delegation left, the program returns `DelegationMismatch`, which is a client error. The SDK throws `PaymentDeniedError("allowanceExpired", recorded: false)` instead, so the tools tell the model to stop.
  2. **A payee without a token account for the mint.** An allowed payment creates the account first; the agent key pays about 0.002 SOL rent. A denied payment to such a wallet cannot be recorded, because `report_denied_attempt` also needs the account, so it throws with `recorded: false` and warns. Setup creates the attacker's account so the demo's blocked attempts are recorded.
  3. **New error `TransactionFailedError`** (code `TRANSACTION_FAILED`) for transactions that fail for a non-Leash, non-network reason, for example the agent key cannot pay the fee. The tools rethrow it as a bug, as they do `LeashProgramError`.
  4. **`requestApproval` takes an optional `reference`**, so x402 can bind a request to its memo hash (02 §3); `buildPayInstruction` attaches an approved request only if the reference matches.
  5. **Scripts read flags only** (`--cluster`, `--rpc`), never the environment. Root `package.json` has two new aliases, `devnet:setup` and `devnet:smoke`, a WS0 file: the laptop queue named these commands.
- Found for WS3: `@solana-program/memo` 0.15 defaults to the new Memo program `Memo4c2p…`, not the SPL Memo `MemoSq4g…` of the x402 profile (02 §9). Pass `{ programAddress }` explicitly.

## Next

- Laptop: `pnpm devnet:setup`, then `pnpm devnet:smoke`, once the demo keys are funded (laptop queue item 2).
- Build step 7: API feedback from WS3, WS6 and WS7, then freeze the API as 1.0.

## Open items

- ~~The four arithmetic edge cases~~: closed. WS1 matched all four (message 20260930-1000), and the 60 vectors pass on the real `leash.so` (20260930-1523).
- ~~`rpcChain` untested on a real node~~: `devnet:setup` and `devnet:smoke --allow-freeze` passed on `pnpm localnet` (laptop, message 20260930-1713). The devnet run waits for funded demo keys.
- `getRecentTransactions` (idempotency) reads the agent's last 25 transactions one by one: fine for the demo, slow for a busy agent.
- `PaymentEffects` leaves out the payee and agent totals (`total_paid`, `payments_count`, `last_payment_at`): the vectors do not pin them and they are plain sums. Add them if a consumer needs them.

## Questions for other workstreams

- None.

## Contract changes proposed

- None.
