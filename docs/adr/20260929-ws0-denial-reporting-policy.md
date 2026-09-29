# Which blocked attempts the SDK records on-chain

- Status: Accepted
- Date: 2026-09-29
- Workstream: WS0
- Contract change: yes (resolves an inconsistency between ADR-0002, the WS2 brief and 02-contracts §8; affected: WS2, WS3, WS7)

## Context

ADR-0002 and the WS2 brief said the SDK reports *every* denial with `report_denied_attempt`. 02-contracts §8 said only strike-type denials. Each report is a transaction paid by the agent key. Reporting everything means an agent stuck in a loop that keeps hitting the rate limit would send one transaction per attempt. Reporting only strikes would hide useful owner information ("the budget ran out", "the rate limit kicked in") from the feed.

## Decision

1. **Strike-type denials** (`payeeNotAllowed`, `exceedsPaymentLimit`, `exceedsPayeePaymentLimit`): always reported. These drive the tripwire.
2. **`approvalRequired`:** never reported. It becomes a `PaymentRequested` event instead.
3. **All other denials:** reported at most once per reason per agent every 60 seconds (`NON_STRIKE_REPORT_COOLDOWN_SECS`). Within the cooldown the tool still returns the error, with `recorded: false`.
4. The lists live in `packages/contracts/src/tools.ts` (`REPORTED_DENIAL_CODES`, `NON_STRIKE_REPORT_COOLDOWN_SECS`).

## Consequences

- The owner's feed shows every kind of block without being flooded, and the tripwire behaviour is unchanged.
- The cooldown is SDK state (in memory, per `LeashAgent`); a restarted agent may report once more. Harmless.

## Alternatives considered

- **Report everything:** fee drain and feed spam in loops.
- **Report strikes only:** hides budget and rate-limit events that owners care about.
