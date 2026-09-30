//! `PaymentRequest`: the owner's approval for one payment above the instant limit (01 §4.4).

use anchor_lang::prelude::*;

use crate::{
    constants::{MEMO_LEN, REFERENCE_LEN},
    state::RequestStatus,
};

/// Seeds: `[REQUEST_SEED, agent, nonce.to_le_bytes()]`.
#[account]
#[derive(InitSpace, Debug)]
pub struct PaymentRequest {
    pub version: u8,
    pub bump: u8,
    pub agent: Pubkey,
    /// Taken from `agent.stats.request_nonce` at creation.
    pub nonce: u64,
    /// The payee wallet.
    pub payee: Pubkey,
    /// The exact amount that may be paid.
    pub amount: u64,
    /// Must match the later `pay`.
    pub reference: [u8; REFERENCE_LEN],
    /// Purpose shown to the owner.
    pub memo: [u8; MEMO_LEN],
    /// `Pending` or `Approved`; terminal outcomes close the account.
    pub status: RequestStatus,
    pub created_at: i64,
    pub expires_at: i64,
    pub approved_at: i64,
    /// Receives the rent back when the account closes.
    pub rent_payer: Pubkey,
    pub reserved: [u8; 32],
}

impl PaymentRequest {
    /// Requests expire at `expires_at` (exclusive: at that second it is already expired).
    pub fn is_expired(&self, now: i64) -> bool {
        now >= self.expires_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_is_expired_from_its_expiry_second_on() {
        let request = PaymentRequest {
            version: 1,
            bump: 252,
            agent: Pubkey::new_from_array([1; 32]),
            nonce: 0,
            payee: Pubkey::new_from_array([2; 32]),
            amount: 1,
            reference: [0; REFERENCE_LEN],
            memo: [0; MEMO_LEN],
            status: RequestStatus::Pending,
            created_at: 100,
            expires_at: 200,
            approved_at: 0,
            rent_payer: Pubkey::new_from_array([3; 32]),
            reserved: [0; 32],
        };
        assert!(!request.is_expired(199));
        assert!(request.is_expired(200));
    }
}
