# A limit that is switched off does not update its counters

- Status: Accepted
- Date: 2026-09-29
- Workstream: WS0
- Contract change: yes (a clarification of 01-onchain-program §7.2; affected: WS1, WS2, WS4)

## Context

01 §7.2 said "on a successful pay, update the velocity window and payee period" without saying what happens when the limit is off. Rate limits and payee period limits can be switched off with 0, and then their window length may also be 0. With `rolled()` a zero-length window restarts on every payment, so implementations could legitimately disagree about the stored counters. The program and the SDK must not disagree, and the indexer and web app show these counters.

The spec was also silent on whether approved requests, which skip the payee limit *checks*, still count towards the payee's period spend.

## Decision

1. Velocity counters are updated only when `velocity_max_payments > 0`.
2. Payee period counters are updated only when the entry matches the destination **and** `period_limit > 0`.
3. Approved requests still count towards the payee's period spend. The checks are waived; the accounting is not.
4. Totals (`total_paid`, `payments_count`, `last_payment_at`) are always updated.
5. Strike counters are only touched when `tripwire_max_strikes > 0` (already in the spec).

## Consequences

- Switching a limit back on later continues from the stored counters (or restarts if the window has elapsed). Acceptable, and the web app can say so.
- Vectors `…is off and its counters are not updated` and `…waives the payee caps` pin the behaviour.

## Alternatives considered

- **Always update counters:** meaningless numbers for disabled limits, and zero-length windows behave oddly.
