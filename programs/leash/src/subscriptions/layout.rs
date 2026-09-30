//! Read-only parsing of Subscriptions delegation accounts (01-onchain-program §8.3).
//!
//! Layout v1, `repr(C, packed)`, from `program/src/state/{header,fixed_delegation,
//! recurring_delegation}.rs` of github.com/solana-foundation/subscriptions at tag
//! `program-v0.5.0` (commit 364a41976c33347d092902443bbec2def9227e75). Subscriptions promises
//! that later versions only append bytes; Leash still accepts nothing but version 1 of the exact
//! v1 size, so a future change can never be misread silently.

use anchor_lang::prelude::Pubkey;

use crate::errors::LeashError;

/// Account discriminator of a fixed delegation (byte 0).
pub const FIXED_DISCRIMINATOR: u8 = 2;
/// Account discriminator of a recurring delegation (byte 0).
pub const RECURRING_DISCRIMINATOR: u8 = 3;
/// Size of a version-1 fixed delegation.
pub const FIXED_V1_LEN: usize = 187;
/// Size of a version-1 recurring delegation.
pub const RECURRING_V1_LEN: usize = 211;
/// The only supported layout version.
pub const SUPPORTED_VERSION: u8 = 1;

const VERSION_OFFSET: usize = 1;
const DELEGATOR_OFFSET: usize = 3;
const DELEGATEE_OFFSET: usize = 35;
const SUBSCRIPTION_AUTHORITY_OFFSET: usize = 107;
const MINT_OFFSET: usize = 139;
const FIXED_AMOUNT_OFFSET: usize = 171;
const FIXED_EXPIRY_OFFSET: usize = 179;
const RECURRING_PERIOD_START_OFFSET: usize = 171;
const RECURRING_PERIOD_LENGTH_OFFSET: usize = 179;
const RECURRING_EXPIRY_OFFSET: usize = 187;
const RECURRING_AMOUNT_PER_PERIOD_OFFSET: usize = 195;
const RECURRING_PULLED_OFFSET: usize = 203;

/// The allowance state of a recurring delegation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RecurringState {
    pub current_period_start: i64,
    pub period_length_s: u64,
    /// 0 = no expiry.
    pub expiry_ts: i64,
    pub amount_per_period: u64,
    pub pulled_in_period: u64,
}

/// The allowance state of a delegation: what the pre-check (§7.3) reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DelegationState {
    Fixed {
        amount_remaining: u64,
        /// 0 = no expiry.
        expiry_ts: i64,
    },
    Recurring(RecurringState),
}

impl DelegationState {
    /// 0 = no expiry.
    pub fn expiry_ts(&self) -> i64 {
        match self {
            DelegationState::Fixed { expiry_ts, .. } => *expiry_ts,
            DelegationState::Recurring(state) => state.expiry_ts,
        }
    }

    /// The Subscriptions instruction that pulls from this kind of delegation (§8.1):
    /// `TransferFixed` (4) or `TransferRecurring` (5).
    pub fn transfer_discriminator(&self) -> u8 {
        match self {
            DelegationState::Fixed { .. } => 4,
            DelegationState::Recurring(_) => 5,
        }
    }
}

/// A decoded Fixed or Recurring delegation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Delegation {
    /// The owner whose token account is debited.
    pub delegator: Pubkey,
    /// Who may pull: for Leash, the Agent PDA.
    pub delegatee: Pubkey,
    pub subscription_authority: Pubkey,
    pub mint: Pubkey,
    pub state: DelegationState,
}

fn pubkey_at(data: &[u8], offset: usize) -> Pubkey {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&data[offset..offset + 32]);
    Pubkey::new_from_array(bytes)
}

fn u64_at(data: &[u8], offset: usize) -> u64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[offset..offset + 8]);
    u64::from_le_bytes(bytes)
}

fn i64_at(data: &[u8], offset: usize) -> i64 {
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&data[offset..offset + 8]);
    i64::from_le_bytes(bytes)
}

/// Decodes a delegation account's data. Anything but a version-1 Fixed or Recurring delegation
/// of the exact v1 size is `UnsupportedDelegation`. The caller checks the account's owner.
pub fn parse_delegation(data: &[u8]) -> Result<Delegation, LeashError> {
    let expected_len = match data.first() {
        Some(&FIXED_DISCRIMINATOR) => FIXED_V1_LEN,
        Some(&RECURRING_DISCRIMINATOR) => RECURRING_V1_LEN,
        _ => return Err(LeashError::UnsupportedDelegation),
    };
    if data.len() != expected_len || data[VERSION_OFFSET] != SUPPORTED_VERSION {
        return Err(LeashError::UnsupportedDelegation);
    }
    let state = if data[0] == FIXED_DISCRIMINATOR {
        DelegationState::Fixed {
            amount_remaining: u64_at(data, FIXED_AMOUNT_OFFSET),
            expiry_ts: i64_at(data, FIXED_EXPIRY_OFFSET),
        }
    } else {
        DelegationState::Recurring(RecurringState {
            current_period_start: i64_at(data, RECURRING_PERIOD_START_OFFSET),
            period_length_s: u64_at(data, RECURRING_PERIOD_LENGTH_OFFSET),
            expiry_ts: i64_at(data, RECURRING_EXPIRY_OFFSET),
            amount_per_period: u64_at(data, RECURRING_AMOUNT_PER_PERIOD_OFFSET),
            pulled_in_period: u64_at(data, RECURRING_PULLED_OFFSET),
        })
    };
    Ok(Delegation {
        delegator: pubkey_at(data, DELEGATOR_OFFSET),
        delegatee: pubkey_at(data, DELEGATEE_OFFSET),
        subscription_authority: pubkey_at(data, SUBSCRIPTION_AUTHORITY_OFFSET),
        mint: pubkey_at(data, MINT_OFFSET),
        state,
    })
}

/// Test helper that writes delegation accounts in the v1 layout.
#[cfg(test)]
pub mod encode {
    use super::*;

    fn header(discriminator: u8, len: usize, delegation: &Delegation) -> Vec<u8> {
        let mut data = vec![0u8; len];
        data[0] = discriminator;
        data[VERSION_OFFSET] = SUPPORTED_VERSION;
        data[2] = 255;
        data[DELEGATOR_OFFSET..DELEGATOR_OFFSET + 32]
            .copy_from_slice(delegation.delegator.as_ref());
        data[DELEGATEE_OFFSET..DELEGATEE_OFFSET + 32]
            .copy_from_slice(delegation.delegatee.as_ref());
        data[SUBSCRIPTION_AUTHORITY_OFFSET..SUBSCRIPTION_AUTHORITY_OFFSET + 32]
            .copy_from_slice(delegation.subscription_authority.as_ref());
        data[MINT_OFFSET..MINT_OFFSET + 32].copy_from_slice(delegation.mint.as_ref());
        data
    }

    /// The account data of `delegation` in the v1 layout.
    pub fn delegation_data(delegation: &Delegation) -> Vec<u8> {
        match delegation.state {
            DelegationState::Fixed {
                amount_remaining,
                expiry_ts,
            } => {
                let mut data = header(FIXED_DISCRIMINATOR, FIXED_V1_LEN, delegation);
                data[FIXED_AMOUNT_OFFSET..FIXED_AMOUNT_OFFSET + 8]
                    .copy_from_slice(&amount_remaining.to_le_bytes());
                data[FIXED_EXPIRY_OFFSET..FIXED_EXPIRY_OFFSET + 8]
                    .copy_from_slice(&expiry_ts.to_le_bytes());
                data
            }
            DelegationState::Recurring(state) => {
                let mut data = header(RECURRING_DISCRIMINATOR, RECURRING_V1_LEN, delegation);
                let fields: [(usize, [u8; 8]); 5] = [
                    (
                        RECURRING_PERIOD_START_OFFSET,
                        state.current_period_start.to_le_bytes(),
                    ),
                    (
                        RECURRING_PERIOD_LENGTH_OFFSET,
                        state.period_length_s.to_le_bytes(),
                    ),
                    (RECURRING_EXPIRY_OFFSET, state.expiry_ts.to_le_bytes()),
                    (
                        RECURRING_AMOUNT_PER_PERIOD_OFFSET,
                        state.amount_per_period.to_le_bytes(),
                    ),
                    (
                        RECURRING_PULLED_OFFSET,
                        state.pulled_in_period.to_le_bytes(),
                    ),
                ];
                for (offset, bytes) in fields {
                    data[offset..offset + 8].copy_from_slice(&bytes);
                }
                data
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{encode::delegation_data, *};

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn recurring() -> Delegation {
        Delegation {
            delegator: key(1),
            delegatee: key(2),
            subscription_authority: key(3),
            mint: key(4),
            state: DelegationState::Recurring(RecurringState {
                current_period_start: 1_790_931_600,
                period_length_s: 86_400,
                expiry_ts: 1_800_000_000,
                amount_per_period: 5_000_000,
                pulled_in_period: 100_000,
            }),
        }
    }

    fn fixed() -> Delegation {
        Delegation {
            state: DelegationState::Fixed {
                amount_remaining: 42,
                expiry_ts: -7,
            },
            ..recurring()
        }
    }

    #[test]
    fn decodes_both_kinds_at_the_documented_offsets() {
        for delegation in [recurring(), fixed()] {
            let data = delegation_data(&delegation);
            assert_eq!(parse_delegation(&data), Ok(delegation));
        }
        // A spot check against the spec table, independent of the encoder.
        let data = delegation_data(&recurring());
        assert_eq!(data.len(), 211);
        assert_eq!(&data[195..203], &5_000_000u64.to_le_bytes());
        assert_eq!(&data[139..171], key(4).as_ref());
        let data = delegation_data(&fixed());
        assert_eq!(data.len(), 187);
        assert_eq!(&data[171..179], &42u64.to_le_bytes());
    }

    #[test]
    fn rejects_other_versions_sizes_and_kinds() {
        let good = delegation_data(&recurring());
        let mut other_version = good.clone();
        other_version[1] = 2;
        let mut appended = good.clone();
        appended.push(0);
        let mut plan = good.clone();
        plan[0] = 4;
        let fixed_len_recurring = good[..FIXED_V1_LEN].to_vec();
        for data in [
            other_version,
            appended,
            plan,
            fixed_len_recurring,
            vec![],
            vec![3],
        ] {
            assert_eq!(
                parse_delegation(&data),
                Err(LeashError::UnsupportedDelegation)
            );
        }
    }

    #[test]
    fn kinds_map_to_their_transfer_instructions() {
        assert_eq!(recurring().state.transfer_discriminator(), 5);
        assert_eq!(fixed().state.transfer_discriminator(), 4);
        assert_eq!(fixed().state.expiry_ts(), -7);
    }
}
