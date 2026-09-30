//! `Payee`: one allowlist entry of an agent (01 §4.3).

use anchor_lang::prelude::*;

use crate::{constants::LABEL_LEN, errors::LeashError, policy::Window, state::PayeeLimits};

/// Seeds: `[PAYEE_SEED, agent, payee]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct Payee {
    pub version: u8,
    pub bump: u8,
    pub agent: Pubkey,
    /// The wallet that must **own** the destination token account.
    pub payee: Pubkey,
    pub label: [u8; LABEL_LEN],
    /// 0 = no payee-specific cap.
    pub max_per_payment: u64,
    /// 0 = no payee-specific period budget.
    pub period_limit: u64,
    /// > 0 when `period_limit` > 0.
    pub period_secs: u32,
    /// Window start (§7.2).
    pub period_start: i64,
    pub spent_in_period: u64,
    pub total_paid: u64,
    pub payments_count: u64,
    pub created_at: i64,
    pub reserved: [u8; 32],
}

impl Payee {
    /// The entry's limits, as passed to `add_payee` and `update_payee`.
    pub fn limits(&self) -> PayeeLimits {
        PayeeLimits {
            max_per_payment: self.max_per_payment,
            period_limit: self.period_limit,
            period_secs: self.period_secs,
        }
    }

    /// Replaces the label and limits; the period counters are kept.
    pub fn set_limits(&mut self, label: [u8; LABEL_LEN], limits: &PayeeLimits) {
        self.label = label;
        self.max_per_payment = limits.max_per_payment;
        self.period_limit = limits.period_limit;
        self.period_secs = limits.period_secs;
    }

    /// Applies an allowed payment to this entry: the period window computed by `evaluate`
    /// (unchanged when the period limit is off) and the totals. Nothing is written on error.
    pub fn record_payment(&mut self, period: Window<u64>, amount: u64) -> Result<()> {
        let total_paid = self
            .total_paid
            .checked_add(amount)
            .ok_or(LeashError::MathOverflow)?;
        let payments_count = self
            .payments_count
            .checked_add(1)
            .ok_or(LeashError::MathOverflow)?;
        self.period_start = period.start;
        self.spent_in_period = period.counter;
        self.total_paid = total_paid;
        self.payments_count = payments_count;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> Payee {
        Payee {
            version: 1,
            bump: 253,
            agent: Pubkey::new_from_array([1; 32]),
            payee: Pubkey::new_from_array([2; 32]),
            label: [0; LABEL_LEN],
            max_per_payment: 2_000_000,
            period_limit: 3_000_000,
            period_secs: 86_400,
            period_start: 100,
            spent_in_period: 50,
            total_paid: 500,
            payments_count: 4,
            created_at: 0,
            reserved: [0; 32],
        }
    }

    #[test]
    fn updating_limits_keeps_the_counters() {
        let mut e = entry();
        let limits = PayeeLimits {
            max_per_payment: 1,
            period_limit: 2,
            period_secs: 3,
        };
        e.set_limits([7; LABEL_LEN], &limits);
        assert_eq!(e.limits(), limits);
        assert_eq!(e.label, [7; LABEL_LEN]);
        assert_eq!(
            (e.period_start, e.spent_in_period, e.total_paid),
            (100, 50, 500)
        );
    }

    #[test]
    fn payments_add_to_the_totals() {
        let mut e = entry();
        e.record_payment(
            Window {
                start: 200,
                counter: 10,
            },
            10,
        )
        .unwrap();
        assert_eq!((e.period_start, e.spent_in_period), (200, 10));
        assert_eq!((e.total_paid, e.payments_count), (510, 5));
        e.total_paid = u64::MAX;
        assert_eq!(
            e.record_payment(
                Window {
                    start: 300,
                    counter: 20
                },
                1
            ),
            Err(LeashError::MathOverflow.into())
        );
        assert_eq!(e.period_start, 200);
    }
}
