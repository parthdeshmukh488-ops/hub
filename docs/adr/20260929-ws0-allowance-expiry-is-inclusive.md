# Allowance expiry is inclusive, exactly as in the Subscriptions program

- Status: Accepted
- Date: 2026-09-29
- Workstream: WS0
- Contract change: yes (a correction of 01-onchain-program §7.3; affected: WS1, WS2)

## Context

While writing the policy test vectors, WS0 checked the upstream source. Subscriptions' `is_expired` is `expiry_ts != 0 && current_ts > expiry_ts` (`program/src/instructions/helpers/transfer_validation.rs`). A delegation is therefore still usable at exactly its expiry second. The founding spec said `now >= expiry_ts`. That disagrees with the program Leash calls, so Leash's pre-check would deny a payment at the boundary that Subscriptions would allow.

The same function also contains an "expiry clamp" in the recurring roll-forward: when the next period would start at or after expiry, no fresh period opens. Because of the inclusive expiry, the clamp is reachable only when `now == expiry_ts`.

## Decision

1. Leash's allowance pre-check uses the upstream rule: expired iff `expiry_ts != 0 && now > expiry_ts`.
2. The recurring roll-forward is ported exactly, clamp included.
3. Leash's own time limits keep their exclusive meaning: an agent is expired when `now >= valid_until`, and a request when `now >= expires_at`.
4. Test vectors pin the boundaries: allowed at exactly `expiry_ts`, denied one second later, and both clamp outcomes.

## Consequences

- The pre-check and the CPI can no longer disagree at the boundary.
- Two conventions coexist (inclusive for Subscriptions data, exclusive for Leash fields). This is documented in 01 §7.3 and covered by vectors.

## Alternatives considered

- **Keep `>=`** (one convention everywhere): Leash would deny payments the allowance permits, which violates "the CPI remains the authority" in spirit and confuses owners.
