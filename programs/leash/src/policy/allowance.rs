//! The Subscriptions program's allowance rules, mirrored for the pre-check (01 §7.3).
//!
//! Ported from `program/src/instructions/helpers/transfer_validation.rs` of
//! github.com/solana-foundation/subscriptions at tag `program-v0.5.0`, commit
//! 364a41976c33347d092902443bbec2def9227e75:
//! <https://github.com/solana-foundation/subscriptions/blob/364a41976c33347d092902443bbec2def9227e75/program/src/instructions/helpers/transfer_validation.rs>
//!
//! Keep it line-for-line faithful. The Subscriptions CPI stays the authority: if this mirror
//! and the real program ever disagree, the CPI fails and the payment reverts (fail closed).
//! `@leash/sdk` `allowance.ts` is the TypeScript copy of the same port.

use crate::subscriptions::RecurringState;

/// Subscriptions' `is_expired`: expiry is inclusive, so a delegation can still be used at
/// exactly `expiry_ts` (ADR 20260929-ws0-allowance-expiry-is-inclusive). 0 = no expiry.
pub fn is_expired(expiry_ts: i64, now: i64) -> bool {
    expiry_ts != 0 && now > expiry_ts
}

/// The current period of a recurring delegation after the roll-forward.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecurringPeriod {
    pub current_period_start: i64,
    pub pulled_in_period: u64,
}

/// Why the roll-forward failed, in upstream's terms.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PeriodError {
    /// `period_length_s` is 0 or beyond `i64` (upstream `InvalidPeriodLength`; its create
    /// instruction never stores one).
    InvalidPeriodLength,
    /// `now` is before the current period start (upstream `DelegationNotStarted`).
    NotStarted,
    /// A checked operation failed (upstream `ArithmeticOverflow` / `ArithmeticUnderflow`).
    /// Unreachable for any account state, as the SDK tests show; kept to mirror upstream.
    Arithmetic,
}

/// The period roll-forward of `validate_recurring_transfer`: once the current period has
/// elapsed, the start moves forward by whole periods and the pulled amount resets. With a
/// finite expiry, no fresh period opens at or after the expiry boundary (the "expiry clamp").
///
/// Callers check `is_expired` first, as upstream does. The amount check that follows upstream's
/// roll-forward is `evaluate`'s step 10.
pub fn roll_recurring_period(
    delegation: &RecurringState,
    now: i64,
) -> Result<RecurringPeriod, PeriodError> {
    let expiry_ts = delegation.expiry_ts;
    let mut current_period_start_ts = delegation.current_period_start;
    let mut amount_pulled_in_period = delegation.pulled_in_period;

    let period_length =
        i64::try_from(delegation.period_length_s).map_err(|_| PeriodError::InvalidPeriodLength)?;
    if period_length == 0 {
        return Err(PeriodError::InvalidPeriodLength);
    }

    if now < current_period_start_ts {
        return Err(PeriodError::NotStarted);
    }

    let time_since_start = now.saturating_sub(current_period_start_ts);

    if time_since_start >= period_length {
        let periods_passed = time_since_start
            .checked_div(period_length)
            .ok_or(PeriodError::InvalidPeriodLength)?;
        let increment = periods_passed
            .checked_mul(period_length)
            .ok_or(PeriodError::Arithmetic)?;
        let candidate_start = current_period_start_ts
            .checked_add(increment)
            .ok_or(PeriodError::Arithmetic)?;
        if expiry_ts == 0 || candidate_start < expiry_ts {
            current_period_start_ts = candidate_start;
            amount_pulled_in_period = 0;
        } else {
            // Finite expiry and the next boundary lands at/after it: advance only to the last
            // period start strictly before expiry, so the final in-bounds period bills without
            // opening a fresh allowance for a period past expiry.
            let last_billable = expiry_ts.checked_sub(1).ok_or(PeriodError::Arithmetic)?;
            if last_billable >= current_period_start_ts {
                let span = last_billable
                    .checked_sub(current_period_start_ts)
                    .ok_or(PeriodError::Arithmetic)?;
                let periods_in_bounds = span
                    .checked_div(period_length)
                    .ok_or(PeriodError::InvalidPeriodLength)?;
                let increment = periods_in_bounds
                    .checked_mul(period_length)
                    .ok_or(PeriodError::Arithmetic)?;
                let last_in_bounds_start = current_period_start_ts
                    .checked_add(increment)
                    .ok_or(PeriodError::Arithmetic)?;
                if last_in_bounds_start > current_period_start_ts {
                    current_period_start_ts = last_in_bounds_start;
                    amount_pulled_in_period = 0;
                }
            }
        }
    }

    Ok(RecurringPeriod {
        current_period_start: current_period_start_ts,
        pulled_in_period: amount_pulled_in_period,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(start: i64, pulled: u64, expiry: i64, length: u64) -> RecurringState {
        RecurringState {
            current_period_start: start,
            period_length_s: length,
            expiry_ts: expiry,
            amount_per_period: 100,
            pulled_in_period: pulled,
        }
    }

    fn roll(start: i64, pulled: u64, expiry: i64, now: i64) -> RecurringPeriod {
        roll_recurring_period(&state(start, pulled, expiry, 30), now).unwrap()
    }

    // Upstream's own unit tests, same inputs and expectations (period 30, 100 per period).

    #[test]
    fn catch_up_at_exact_expiry_boundary() {
        // Upstream then pulls 100 more in the period starting at 60.
        assert_eq!(
            roll(0, 100, 90, 90),
            RecurringPeriod {
                current_period_start: 60,
                pulled_in_period: 0
            }
        );
    }

    #[test]
    fn boundary_before_expiry_advances_normally() {
        assert_eq!(
            roll(0, 100, 90, 35),
            RecurringPeriod {
                current_period_start: 30,
                pulled_in_period: 0
            }
        );
    }

    #[test]
    fn fully_used_final_period_does_not_open_a_period_past_expiry() {
        assert_eq!(
            roll(60, 100, 90, 90),
            RecurringPeriod {
                current_period_start: 60,
                pulled_in_period: 100
            }
        );
    }

    #[test]
    fn no_expiry_advances_to_the_floored_boundary() {
        assert_eq!(
            roll(0, 100, 0, 90),
            RecurringPeriod {
                current_period_start: 90,
                pulled_in_period: 0
            }
        );
    }

    #[test]
    fn expiry_is_inclusive() {
        assert!(!is_expired(100, 100));
        assert!(is_expired(100, 101));
        assert!(!is_expired(0, i64::MAX));
    }

    // Branches upstream's tests do not name.

    #[test]
    fn inside_the_period_nothing_changes() {
        assert_eq!(
            roll(0, 40, 0, 29),
            RecurringPeriod {
                current_period_start: 0,
                pulled_in_period: 40
            }
        );
    }

    #[test]
    fn before_the_start_the_period_has_not_started() {
        assert_eq!(
            roll_recurring_period(&state(100, 0, 0, 30), 99),
            Err(PeriodError::NotStarted)
        );
    }

    #[test]
    fn period_lengths_upstream_rejects() {
        for length in [0, i64::MAX as u64 + 1, u64::MAX] {
            assert_eq!(
                roll_recurring_period(&state(0, 0, 0, length), 10),
                Err(PeriodError::InvalidPeriodLength)
            );
        }
    }

    #[test]
    fn an_expiry_at_or_before_the_start_keeps_the_period() {
        assert_eq!(
            roll(100, 7, 100, 200),
            RecurringPeriod {
                current_period_start: 100,
                pulled_in_period: 7
            }
        );
        assert_eq!(
            roll(100, 7, 50, 200),
            RecurringPeriod {
                current_period_start: 100,
                pulled_in_period: 7
            }
        );
    }

    #[test]
    fn elapsed_time_saturates_for_extreme_starts() {
        // now - start overflows i64: upstream saturates, and the start moves by whole periods.
        let period = roll_recurring_period(&state(-i64::MAX, 5, 0, 86_400), i64::MAX).unwrap();
        let steps = i64::MAX / 86_400;
        assert_eq!(period.current_period_start, -i64::MAX + steps * 86_400);
        assert_eq!(period.pulled_in_period, 0);
    }
}
