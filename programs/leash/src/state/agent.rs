//! `Agent`: one per agent key, and the Subscriptions delegatee (01 §4.2, §4.6).

use anchor_lang::prelude::*;

use crate::{
    constants::LABEL_LEN,
    errors::LeashError,
    policy::{rolled, Window},
    state::{AgentStatus, DenialReason, FreezeReason, Policy},
};

/// Counters kept by the program. Windows follow §7.2; a start of 0 means "never started".
#[derive(
    AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq, Default,
)]
pub struct AgentStats {
    pub payments_count: u64,
    pub total_paid: u64,
    /// Reported denials.
    pub denied_count: u64,
    pub last_payment_at: i64,
    pub velocity_window_start: i64,
    pub velocity_count: u16,
    pub strike_window_start: i64,
    pub strikes: u8,
    /// The next `PaymentRequest` nonce.
    pub request_nonce: u64,
}

/// Seeds: `[AGENT_SEED, principal, agent_key]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Agent {
    pub version: u8,
    pub bump: u8,
    pub principal: Pubkey,
    /// Denormalized from the principal, for `memcmp` queries.
    pub owner: Pubkey,
    /// Signs `pay`, `request_payment` and `report_denied_attempt`.
    pub agent_key: Pubkey,
    /// The only mint this agent can pay with.
    pub mint: Pubkey,
    pub label: [u8; LABEL_LEN],
    pub status: AgentStatus,
    /// `None` while active.
    pub freeze_reason: FreezeReason,
    pub frozen_at: i64,
    /// Live `Payee` accounts.
    pub payee_count: u16,
    /// Live `PaymentRequest` accounts.
    pub open_requests: u16,
    pub policy: Policy,
    pub stats: AgentStats,
    pub created_at: i64,
    pub updated_at: i64,
    pub reserved: [u8; 64],
}

/// What an allowed payment changes on the agent, as computed by `evaluate` (§7.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AgentPaymentEffects {
    pub velocity: Window<u16>,
    pub amount: u64,
    pub consumes_request: bool,
}

/// The outcome of recording a denied attempt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DenialRecord {
    /// Strikes in the current window after this attempt.
    pub strikes: u8,
    /// Whether this attempt froze the agent.
    pub tripped: bool,
}

impl Agent {
    /// Freezes the agent. Returns false if it was already frozen (idempotent: the first reason
    /// is kept).
    pub fn freeze(&mut self, reason: FreezeReason, now: i64) -> bool {
        if self.status == AgentStatus::Frozen {
            return false;
        }
        self.status = AgentStatus::Frozen;
        self.freeze_reason = reason;
        self.frozen_at = now;
        self.updated_at = now;
        true
    }

    /// Reactivates the agent and clears its strikes. Returns false if it was active.
    pub fn unfreeze(&mut self, now: i64) -> bool {
        if self.status == AgentStatus::Active {
            return false;
        }
        self.status = AgentStatus::Active;
        self.freeze_reason = FreezeReason::None;
        self.frozen_at = 0;
        self.stats.strikes = 0;
        self.stats.strike_window_start = 0;
        self.updated_at = now;
        true
    }

    /// Applies an allowed payment (`pay` step 3): the velocity window from `evaluate`, the agent
    /// totals, and the consumed request.
    /// Everything is computed before anything is written.
    pub fn record_payment(&mut self, effects: &AgentPaymentEffects, now: i64) -> Result<()> {
        let payments_count = self
            .stats
            .payments_count
            .checked_add(1)
            .ok_or(LeashError::MathOverflow)?;
        let total_paid = self
            .stats
            .total_paid
            .checked_add(effects.amount)
            .ok_or(LeashError::MathOverflow)?;
        let open_requests = if effects.consumes_request {
            self.open_requests
                .checked_sub(1)
                .ok_or(LeashError::MathOverflow)?
        } else {
            self.open_requests
        };

        let stats = &mut self.stats;
        stats.velocity_window_start = effects.velocity.start;
        stats.velocity_count = effects.velocity.counter;
        stats.payments_count = payments_count;
        stats.total_paid = total_paid;
        stats.last_payment_at = now;
        self.open_requests = open_requests;
        self.updated_at = now;
        Ok(())
    }

    /// Records a denied attempt (`report_denied_attempt` steps 3 and 4): counts it, and for a
    /// strike reason with the tripwire on, rolls the strike window, adds the strike and freezes
    /// the agent when the limit is reached. Everything is computed before anything is written.
    pub fn record_denial(&mut self, reason: DenialReason, now: i64) -> Result<DenialRecord> {
        let denied_count = self
            .stats
            .denied_count
            .checked_add(1)
            .ok_or(LeashError::MathOverflow)?;
        let max_strikes = self.policy.tripwire_max_strikes;
        let counts = reason.is_strike() && max_strikes > 0 && self.status == AgentStatus::Active;
        let strike_window = if counts {
            Some(rolled(
                self.stats.strike_window_start,
                self.policy.tripwire_window_secs,
                self.stats.strikes,
                now,
            )?)
        } else {
            None
        };

        self.stats.denied_count = denied_count;
        self.updated_at = now;
        let Some(window) = strike_window else {
            return Ok(DenialRecord {
                strikes: self.current_strikes(now),
                tripped: false,
            });
        };
        let strikes = window.counter.saturating_add(1);
        self.stats.strike_window_start = window.start;
        self.stats.strikes = strikes;
        let tripped = strikes >= max_strikes && self.freeze(FreezeReason::Tripwire, now);
        Ok(DenialRecord { strikes, tripped })
    }

    /// Strikes that still count at `now`: 0 once the strike window has ended. Read-only, for
    /// reports that add no strike.
    fn current_strikes(&self, now: i64) -> u8 {
        let start = self.stats.strike_window_start;
        let end = start.saturating_add(i64::from(self.policy.tripwire_window_secs));
        if self.policy.tripwire_max_strikes == 0 || (start != 0 && now < end) {
            self.stats.strikes
        } else {
            0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::PayeeMode;

    const NOW: i64 = 1_790_935_200;

    fn agent() -> Agent {
        Agent {
            version: 1,
            bump: 254,
            principal: Pubkey::new_from_array([1; 32]),
            owner: Pubkey::new_from_array([2; 32]),
            agent_key: Pubkey::new_from_array([3; 32]),
            mint: Pubkey::new_from_array([4; 32]),
            label: [0; LABEL_LEN],
            status: AgentStatus::Active,
            freeze_reason: FreezeReason::None,
            frozen_at: 0,
            payee_count: 0,
            open_requests: 1,
            policy: Policy {
                max_per_payment: 1_000_000,
                max_per_request: 5_000_000,
                payee_mode: PayeeMode::AllowListOnly,
                velocity_max_payments: 30,
                velocity_window_secs: 60,
                tripwire_max_strikes: 3,
                tripwire_window_secs: 600,
                request_ttl_secs: 3_600,
                valid_until: 0,
            },
            stats: AgentStats::default(),
            created_at: NOW - 1_000,
            updated_at: NOW - 1_000,
            reserved: [0; 64],
        }
    }

    #[test]
    fn three_strikes_in_the_window_trip_the_wire() {
        let mut a = agent();
        let first = a.record_denial(DenialReason::PayeeNotAllowed, NOW).unwrap();
        assert_eq!(
            first,
            DenialRecord {
                strikes: 1,
                tripped: false
            }
        );
        assert_eq!(a.stats.strike_window_start, NOW);
        a.record_denial(DenialReason::ExceedsPaymentLimit, NOW + 10)
            .unwrap();
        let third = a
            .record_denial(DenialReason::ExceedsPayeePaymentLimit, NOW + 20)
            .unwrap();
        assert_eq!(
            third,
            DenialRecord {
                strikes: 3,
                tripped: true
            }
        );
        assert_eq!(a.status, AgentStatus::Frozen);
        assert_eq!(a.freeze_reason, FreezeReason::Tripwire);
        assert_eq!(a.frozen_at, NOW + 20);
        assert_eq!(a.stats.denied_count, 3);
    }

    #[test]
    fn strikes_restart_after_the_window() {
        let mut a = agent();
        a.record_denial(DenialReason::PayeeNotAllowed, NOW).unwrap();
        a.record_denial(DenialReason::PayeeNotAllowed, NOW + 1)
            .unwrap();
        let later = a
            .record_denial(DenialReason::PayeeNotAllowed, NOW + 600)
            .unwrap();
        assert_eq!(
            later,
            DenialRecord {
                strikes: 1,
                tripped: false
            }
        );
        assert_eq!(a.stats.strike_window_start, NOW + 600);
        assert_eq!(a.status, AgentStatus::Active);
    }

    #[test]
    fn non_strike_denials_never_trip_the_wire() {
        let mut a = agent();
        for offset in 0..10 {
            let record = a
                .record_denial(DenialReason::AllowanceExceeded, NOW + offset)
                .unwrap();
            assert_eq!(
                record,
                DenialRecord {
                    strikes: 0,
                    tripped: false
                }
            );
        }
        assert_eq!(a.stats.denied_count, 10);
        assert_eq!(a.stats.strike_window_start, 0);
        assert_eq!(a.status, AgentStatus::Active);
    }

    #[test]
    fn non_strike_reports_show_the_strikes_still_in_the_window() {
        let mut a = agent();
        a.record_denial(DenialReason::PayeeNotAllowed, NOW).unwrap();
        let inside = a
            .record_denial(DenialReason::VelocityExceeded, NOW + 599)
            .unwrap();
        assert_eq!(inside.strikes, 1);
        let after = a
            .record_denial(DenialReason::VelocityExceeded, NOW + 600)
            .unwrap();
        assert_eq!(after.strikes, 0);
        // Reading the window never writes it.
        assert_eq!((a.stats.strikes, a.stats.strike_window_start), (1, NOW));
    }

    #[test]
    fn a_switched_off_tripwire_counts_denials_but_not_strikes() {
        let mut a = agent();
        a.policy.tripwire_max_strikes = 0;
        a.policy.tripwire_window_secs = 0;
        for _ in 0..5 {
            a.record_denial(DenialReason::PayeeNotAllowed, NOW).unwrap();
        }
        assert_eq!((a.stats.strikes, a.stats.strike_window_start), (0, 0));
        assert_eq!(a.stats.denied_count, 5);
        assert_eq!(a.status, AgentStatus::Active);
    }

    #[test]
    fn a_frozen_agent_gets_no_new_strikes() {
        let mut a = agent();
        assert!(a.freeze(FreezeReason::Owner, NOW));
        let record = a.record_denial(DenialReason::PayeeNotAllowed, NOW).unwrap();
        assert_eq!(
            record,
            DenialRecord {
                strikes: 0,
                tripped: false
            }
        );
        assert_eq!(a.freeze_reason, FreezeReason::Owner);
    }

    #[test]
    fn freeze_keeps_the_first_reason_and_unfreeze_clears_strikes() {
        let mut a = agent();
        a.record_denial(DenialReason::PayeeNotAllowed, NOW).unwrap();
        assert!(a.freeze(FreezeReason::Guardian, NOW + 1));
        assert!(!a.freeze(FreezeReason::Owner, NOW + 2));
        assert_eq!(
            (a.freeze_reason, a.frozen_at),
            (FreezeReason::Guardian, NOW + 1)
        );
        assert!(a.unfreeze(NOW + 3));
        assert!(!a.unfreeze(NOW + 4));
        assert_eq!(a.status, AgentStatus::Active);
        assert_eq!(a.freeze_reason, FreezeReason::None);
        assert_eq!(
            (a.frozen_at, a.stats.strikes, a.stats.strike_window_start),
            (0, 0, 0)
        );
    }

    #[test]
    fn payments_update_totals_and_consume_the_request() {
        let mut a = agent();
        let effects = AgentPaymentEffects {
            velocity: Window {
                start: NOW,
                counter: 1,
            },
            amount: 250_000,
            consumes_request: true,
        };
        a.record_payment(&effects, NOW).unwrap();
        assert_eq!(a.stats.payments_count, 1);
        assert_eq!(a.stats.total_paid, 250_000);
        assert_eq!(a.stats.last_payment_at, NOW);
        assert_eq!(
            (a.stats.velocity_window_start, a.stats.velocity_count),
            (NOW, 1)
        );
        assert_eq!(a.open_requests, 0);
        assert_eq!(a.updated_at, NOW);
        // No request left to consume: the counter cannot go below zero, and nothing is written.
        assert_eq!(
            a.record_payment(&effects, NOW + 1),
            Err(LeashError::MathOverflow.into())
        );
        assert_eq!((a.stats.payments_count, a.updated_at), (1, NOW));
    }

    #[test]
    fn totals_never_wrap() {
        let mut a = agent();
        a.stats.total_paid = u64::MAX;
        let effects = AgentPaymentEffects {
            velocity: Window {
                start: NOW,
                counter: 1,
            },
            amount: 1,
            consumes_request: false,
        };
        assert_eq!(
            a.record_payment(&effects, NOW),
            Err(LeashError::MathOverflow.into())
        );
    }
}
