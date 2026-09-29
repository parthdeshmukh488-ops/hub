# `pay` fails closed; blocked attempts are recorded by `report_denied_attempt`

- Status: Accepted
- Date: 2026-09-29
- Workstream: architecture
- Contract change: n/a (founding decision)
- Amended by: [20260929-ws0-denial-reporting-policy](20260929-ws0-denial-reporting-policy.md) (which denials are reported)

## Context

- We want every blocked attempt on-chain (audit, invariant I5) and a tripwire that freezes a manipulated agent (I4).
- A Solana transaction that fails leaves no state changes, so a failed `pay` cannot increment a strike counter.
- The obvious fix, "`pay` returns `Ok` with a `Denied` outcome and records the strike", has a sharp edge. An x402 facilitator verifies by simulation, then settles later. If state changes in between (another payment used the budget), the settled transaction would **succeed on-chain without paying**. The facilitator's post-settlement check would catch it, but facilitators, wallets and indexers all assume a successful payment transaction means money moved.

## Decision

1. **`pay` is strict.** It transfers exactly `amount` to an allowed payee or fails with the `Denied*` error for the first failing check. It never returns `Ok` without a transfer.
2. **`report_denied_attempt`** takes the same arguments and accounts (minus the token CPI). It re-evaluates the policy and:
   - if the payment would be **allowed**, it fails with `AttemptWouldSucceed`, so it can never pay and can't be used to fake strikes;
   - otherwise it increments `denied_count`, adds a strike for strike-type reasons, freezes the agent when the tripwire threshold is reached, and emits `PaymentDenied` (plus `AgentFrozen` if it tripped).
3. The SDK always simulates `pay` first. On a denial it sends `report_denied_attempt` (signed and paid by the agent key) before returning the error to the caller. Denials are reported before the agent can do anything else with that payment.

## Consequences

- Facilitators, wallets and indexers see standard semantics: a successful `pay` always moved money.
- The tripwire relies on the SDK reporting. That fits the main threat (T1: an honest runtime running a manipulated model). A thief holding the agent key can skip reporting, but can still only pay allowlisted payees within limits (T3).
- The agent key needs a little SOL to pay for reports. The SDK warns when its balance is low.
- Strikes count only reasons that signal manipulation or a bug (`payeeNotAllowed`, `exceedsPaymentLimit`, `exceedsPayeePaymentLimit`). Budget, rate and freeze denials are recorded but never trip the wire, so normal operation and concurrency races can't freeze an agent.

## Alternatives considered

1. **Denial-as-`Ok` inside `pay`.** Rejected for the settlement race above.
2. **A `mode` flag on `pay` (strict or record).** Same effect as two instructions, but one instruction with two meanings is easier to misuse and harder to audit.
3. **Tripwire only off-chain (Sentinel).** Keeps the program simpler, but the freeze would depend on our server being up, and "the agent stops itself on-chain" is a key part of the pitch. Sentinel remains as a second, off-chain layer.
