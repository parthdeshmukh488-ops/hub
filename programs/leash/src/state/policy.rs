//! `Policy` and `PayeeLimits`: the owner's rules, embedded in accounts and passed as
//! instruction arguments (01-onchain-program §4.5, §6.1).

use anchor_lang::prelude::*;

use crate::{constants::MAX_REQUEST_TTL_SECS, errors::LeashError, state::PayeeMode};

/// The rules an agent's payments must follow. Stored in `Agent`.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Policy {
    /// Instant limit per payment. Must be > 0.
    pub max_per_payment: u64,
    /// Upper bound for approved requests. 0 disables approvals; otherwise > `max_per_payment`.
    pub max_per_request: u64,
    pub payee_mode: PayeeMode,
    /// Executed payments per window. 0 = off.
    pub velocity_max_payments: u16,
    /// Must be > 0 when the rate limit is on.
    pub velocity_window_secs: u32,
    /// Strikes that freeze the agent. 0 = off.
    pub tripwire_max_strikes: u8,
    /// Must be > 0 when the tripwire is on.
    pub tripwire_window_secs: u32,
    /// Payment request lifetime; in `1..=MAX_REQUEST_TTL_SECS` when approvals are on.
    pub request_ttl_secs: u32,
    /// 0 = no expiry; otherwise in the future when set.
    pub valid_until: i64,
}

impl Policy {
    /// Whether approval requests are switched on.
    pub fn approvals_enabled(&self) -> bool {
        self.max_per_request != 0
    }

    /// Checks every rule of §4.5 at time `now`; any broken rule is `InvalidPolicy`.
    /// `@leash/contracts` `policyProblems` lists the same rules for the UI.
    pub fn validate(&self, now: i64) -> Result<()> {
        let approvals_ok = !self.approvals_enabled()
            || (self.max_per_request > self.max_per_payment
                && (1..=MAX_REQUEST_TTL_SECS).contains(&self.request_ttl_secs));
        let valid = self.max_per_payment > 0
            && approvals_ok
            && (self.velocity_max_payments == 0 || self.velocity_window_secs > 0)
            && (self.tripwire_max_strikes == 0 || self.tripwire_window_secs > 0)
            && (self.valid_until == 0 || self.valid_until > now);
        require!(valid, LeashError::InvalidPolicy);
        Ok(())
    }
}

/// A payee's own limits, on top of the agent's policy. Stored flat in `Payee`.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PayeeLimits {
    /// 0 = no payee-specific cap.
    pub max_per_payment: u64,
    /// 0 = no payee-specific period budget.
    pub period_limit: u64,
    /// Must be > 0 when `period_limit` > 0.
    pub period_secs: u32,
}

impl PayeeLimits {
    /// `period_secs` must be > 0 when a period limit is set; otherwise `InvalidPolicy`.
    pub fn validate(&self) -> Result<()> {
        require!(
            self.period_limit == 0 || self.period_secs > 0,
            LeashError::InvalidPolicy
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_790_935_200;

    fn policy() -> Policy {
        Policy {
            max_per_payment: 1_000_000,
            max_per_request: 5_000_000,
            payee_mode: PayeeMode::AllowListOnly,
            velocity_max_payments: 30,
            velocity_window_secs: 60,
            tripwire_max_strikes: 3,
            tripwire_window_secs: 600,
            request_ttl_secs: 3_600,
            valid_until: 0,
        }
    }

    fn invalid(change: impl FnOnce(&mut Policy)) -> bool {
        let mut candidate = policy();
        change(&mut candidate);
        candidate.validate(NOW) == Err(LeashError::InvalidPolicy.into())
    }

    #[test]
    fn rejects_every_broken_rule() {
        assert!(invalid(|p| p.max_per_payment = 0));
        assert!(invalid(|p| p.max_per_request = p.max_per_payment));
        assert!(invalid(|p| p.max_per_request = p.max_per_payment - 1));
        assert!(invalid(|p| p.velocity_window_secs = 0));
        assert!(invalid(|p| p.tripwire_window_secs = 0));
        assert!(invalid(|p| p.request_ttl_secs = 0));
        assert!(invalid(|p| p.request_ttl_secs = MAX_REQUEST_TTL_SECS + 1));
        assert!(invalid(|p| p.valid_until = NOW));
        assert!(invalid(|p| p.valid_until = NOW - 1));
    }

    #[test]
    fn accepts_the_boundaries_and_switched_off_limits() {
        assert!(policy().validate(NOW).is_ok());
        let mut edge = policy();
        edge.max_per_request = edge.max_per_payment + 1;
        edge.request_ttl_secs = MAX_REQUEST_TTL_SECS;
        edge.valid_until = NOW + 1;
        assert!(edge.validate(NOW).is_ok());
        let off = Policy {
            max_per_request: 0,
            request_ttl_secs: 0,
            velocity_max_payments: 0,
            velocity_window_secs: 0,
            tripwire_max_strikes: 0,
            tripwire_window_secs: 0,
            ..policy()
        };
        assert!(off.validate(NOW).is_ok());
        edge.request_ttl_secs = 1;
        assert!(edge.validate(NOW).is_ok());
    }

    #[test]
    fn payee_limits_need_a_period_with_a_period_limit() {
        let limits = |period_limit, period_secs| PayeeLimits {
            max_per_payment: 0,
            period_limit,
            period_secs,
        };
        assert!(limits(0, 0).validate().is_ok());
        assert!(limits(1, 60).validate().is_ok());
        assert_eq!(
            limits(1, 0).validate(),
            Err(LeashError::InvalidPolicy.into())
        );
    }
}
