---
from: ws2
to: all (mainly the laptop session, ws3, ws4, ws6, ws7)
date: 2026-09-30 16:55 UTC
subject: Owner builders and LeashAgent ready; devnet:setup and devnet:smoke; @leash/sdk/testing
---

WS2 build steps 3–5 are done ([status](../status/WS2.md), [README](../../../packages/sdk/README.md)). 236 SDK tests pass, most on the committed `leash.so` and `subscriptions.so` in LiteSVM.

**Laptop session: queue item 2 is unblocked.** With funded demo keys, run from the repo root:

```bash
pnpm devnet:setup   # research-assistant preset: principal (guardian), agent, 5 USDC/day for 30 days,
                    # merchant allowlisted, USDC accounts for merchant and attacker; resumable
pnpm devnet:smoke   # allowed payment, approval required, blocked + recorded, owner freeze/unfreeze
```

- Both take `--cluster localnet` (after `pnpm localnet`) and `--rpc <url>`.
- They read `.keys/` and flags only, never the environment.
- `rpcChain` has only been tested against a scripted RPC, so this is its first real run. Please report anything odd, with the printed output.

**What each workstream can use now** (all from `@leash/sdk`):

- **WS7:** `LeashAgent` implements your `LeashAgentPort`. `pay` returns a superset of `PaymentResult`, adding `reference` and `destination`.
  - It throws only the typed errors.
  - Two errors mean a bug or operations problem, not policy. Your `fromError` rethrows them:
    - the new `TransactionFailedError` (e.g. the agent key can't pay fees);
    - `LeashProgramError` (e.g. `InvalidDestination`).
  - A revoked allowance surfaces as `allowanceExpired` with `recorded: false`.
- **WS3:** `agent.buildPayInstruction({ to, amount, purpose, reference })` gives the `pay` instruction for your `[CU limit, CU price, pay, Memo]` transaction.
  - It attaches an approved request only if its reference matches: pass the same `reference` to `requestApproval`.
  - `agent.reportDenied(...)` records a denial your simulation found.
  - **Pitfall:** `@solana-program/memo` 0.15 defaults to the new Memo program `Memo4c2p…`. The x402 profile's SPL Memo is `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr`, so pass `{ programAddress }` to `getAddMemoInstruction`. `test/agent.test.ts` builds this exact shape with a separate fee payer, and it passes on the real program.
- **WS4:** chain mode can use `rpcChain`, `transactionRecordFromRpc` and `decodeLeashEvents(tx, { principalOf })`.
  - Agent-level events carry only the agent; `principalOf` fills `principal`.
  - `fetchAgentViews(chain, owner)` and the other `fetch*` reads give the contract views straight from the chain.
- **WS6:**
  - Every owner action has a builder: `buildOnboarding`, `buildUpdatePolicy`, `buildAdd/Update/RemovePayee`, `buildFreeze/UnfreezeAgent`, `buildFreeze/UnfreezePrincipal`, `buildApprove/Reject/ExpireRequest`, `buildSetGuardian`, `buildRevokeAllowance`, `buildCloseAgent`.
  - They return kit instructions for the wallet to sign. `buildOnboarding(...).transactions` is ordered and already packed by size.
  - `policyStateFromView` converts a form's `PolicyView`.
- **Everyone's tests:** `createTestbed()` from `@leash/sdk/testing` (Node only). It gives a LiteSVM with both programs, a funded owner, an onboarded agent with 5 USDC a day, an allowlisted merchant, and clock and balance helpers. Use `bed.chain` wherever a `LeashChain` is expected.

**Decisions to confirm** (Parth): the five listed in the WS2 status under "Decisions in steps 3–5". The most visible: an allowed payment to a wallet without a token account creates it (the agent pays about 0.002 SOL rent). A denied payment to such a wallet cannot be recorded.
