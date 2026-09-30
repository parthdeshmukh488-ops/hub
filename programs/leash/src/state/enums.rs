//! The program's enums (01-onchain-program §5).
//!
//! Borsh stores an enum as its variant index (one byte), and the IDL lists variants in that
//! order, so the order below is part of the contract: never reorder, only append. For every enum
//! except `DenialReason` the stored byte equals the value in the spec. `DenialReason` codes
//! start at 1 (they line up with the error codes), so its stored byte is `code - 1`; decoders go
//! through the IDL and get the variant name (ADR 20260930-ws1-program-interface).

use anchor_lang::prelude::*;

use crate::errors::LeashError;

/// Whether an agent may pay.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentStatus {
    Active,
    Frozen,
}

/// Why an agent is frozen; `None` while it is active.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub enum FreezeReason {
    None,
    Owner,
    Guardian,
    Tripwire,
}

/// Which destinations an agent may pay.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayeeMode {
    /// Only wallets with a `Payee` entry (the default, recommended).
    AllowListOnly,
    /// Any wallet; payee entries still add their own limits.
    AnyPayee,
}

/// Lifecycle of a payment request. Terminal outcomes close the account.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub enum RequestStatus {
    Pending,
    Approved,
}

/// Why the policy blocked a payment (01 §5). The first failing check of §7.1 wins.
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, Debug, PartialEq, Eq)]
pub enum DenialReason {
    PrincipalFrozen,
    AgentFrozen,
    AgentExpired,
    PayeeNotAllowed,
    ExceedsPaymentLimit,
    ApprovalRequired,
    ExceedsPayeePaymentLimit,
    ExceedsPayeePeriodLimit,
    VelocityExceeded,
    AllowanceExpired,
    AllowanceExceeded,
    InsufficientFunds,
}

impl DenialReason {
    /// Every reason, in code order.
    pub const ALL: [DenialReason; 12] = [
        DenialReason::PrincipalFrozen,
        DenialReason::AgentFrozen,
        DenialReason::AgentExpired,
        DenialReason::PayeeNotAllowed,
        DenialReason::ExceedsPaymentLimit,
        DenialReason::ApprovalRequired,
        DenialReason::ExceedsPayeePaymentLimit,
        DenialReason::ExceedsPayeePeriodLimit,
        DenialReason::VelocityExceeded,
        DenialReason::AllowanceExpired,
        DenialReason::AllowanceExceeded,
        DenialReason::InsufficientFunds,
    ];

    /// The denial code (1–12) of the spec and of `@leash/contracts`.
    pub fn code(self) -> u8 {
        self as u8 + 1
    }

    /// Whether the reason counts towards the tripwire: only the ones that signal manipulation or
    /// a bug. Running out of budget or hitting the rate limit never does.
    pub fn is_strike(self) -> bool {
        matches!(
            self,
            DenialReason::PayeeNotAllowed
                | DenialReason::ExceedsPaymentLimit
                | DenialReason::ExceedsPayeePaymentLimit
        )
    }

    /// The `Denied*` error `pay` fails with. Its code is `6000 + code - 1`.
    pub fn error(self) -> LeashError {
        match self {
            DenialReason::PrincipalFrozen => LeashError::DeniedPrincipalFrozen,
            DenialReason::AgentFrozen => LeashError::DeniedAgentFrozen,
            DenialReason::AgentExpired => LeashError::DeniedAgentExpired,
            DenialReason::PayeeNotAllowed => LeashError::DeniedPayeeNotAllowed,
            DenialReason::ExceedsPaymentLimit => LeashError::DeniedExceedsPaymentLimit,
            DenialReason::ApprovalRequired => LeashError::DeniedApprovalRequired,
            DenialReason::ExceedsPayeePaymentLimit => LeashError::DeniedExceedsPayeePaymentLimit,
            DenialReason::ExceedsPayeePeriodLimit => LeashError::DeniedExceedsPayeePeriodLimit,
            DenialReason::VelocityExceeded => LeashError::DeniedVelocityExceeded,
            DenialReason::AllowanceExpired => LeashError::DeniedAllowanceExpired,
            DenialReason::AllowanceExceeded => LeashError::DeniedAllowanceExceeded,
            DenialReason::InsufficientFunds => LeashError::DeniedInsufficientFunds,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_follow_the_spec_and_line_up_with_the_errors() {
        for (index, reason) in DenialReason::ALL.iter().enumerate() {
            assert_eq!(usize::from(reason.code()), index + 1);
            assert_eq!(reason.error() as u32, index as u32);
        }
    }

    #[test]
    fn only_manipulation_signals_are_strikes() {
        let strikes: Vec<u8> = DenialReason::ALL
            .iter()
            .filter(|reason| reason.is_strike())
            .map(|reason| reason.code())
            .collect();
        assert_eq!(strikes, vec![4, 5, 7]);
    }

    #[test]
    fn enums_are_stored_as_their_variant_index() {
        assert_eq!(borsh::to_vec(&AgentStatus::Frozen).unwrap(), [1]);
        assert_eq!(borsh::to_vec(&FreezeReason::Tripwire).unwrap(), [3]);
        assert_eq!(borsh::to_vec(&PayeeMode::AnyPayee).unwrap(), [1]);
        assert_eq!(borsh::to_vec(&RequestStatus::Approved).unwrap(), [1]);
        // Code 12, stored as its index.
        assert_eq!(
            borsh::to_vec(&DenialReason::InsufficientFunds).unwrap(),
            [11]
        );
    }
}
