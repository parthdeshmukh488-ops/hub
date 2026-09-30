//! Events (01-onchain-program §9), emitted with `emit_cpi!` so they survive log truncation.
//! Every event carries `timestamp`. `@leash/sdk` decodes them into the JSON events of
//! 02-contracts §6.

use anchor_lang::prelude::*;

use crate::{
    constants::{LABEL_LEN, MEMO_LEN, REFERENCE_LEN},
    state::{DenialReason, FreezeReason, PayeeLimits, Policy},
};

#[event]
pub struct PrincipalInitialized {
    pub principal: Pubkey,
    pub owner: Pubkey,
    pub guardian: Option<Pubkey>,
    pub timestamp: i64,
}

#[event]
pub struct GuardianChanged {
    pub principal: Pubkey,
    pub guardian: Option<Pubkey>,
    pub timestamp: i64,
}

#[event]
pub struct PrincipalFrozen {
    pub principal: Pubkey,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PrincipalUnfrozen {
    pub principal: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AgentCreated {
    pub principal: Pubkey,
    pub agent: Pubkey,
    pub agent_key: Pubkey,
    pub mint: Pubkey,
    pub label: [u8; LABEL_LEN],
    pub policy: Policy,
    pub timestamp: i64,
}

#[event]
pub struct PolicyUpdated {
    pub agent: Pubkey,
    pub policy: Policy,
    pub timestamp: i64,
}

#[event]
pub struct AgentFrozen {
    pub agent: Pubkey,
    pub reason: FreezeReason,
    /// For `Tripwire`, the agent key.
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AgentUnfrozen {
    pub agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AgentClosed {
    pub principal: Pubkey,
    pub agent: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PayeeAdded {
    pub agent: Pubkey,
    pub payee: Pubkey,
    pub label: [u8; LABEL_LEN],
    pub limits: PayeeLimits,
    pub timestamp: i64,
}

#[event]
pub struct PayeeUpdated {
    pub agent: Pubkey,
    pub payee: Pubkey,
    pub label: [u8; LABEL_LEN],
    pub limits: PayeeLimits,
    pub timestamp: i64,
}

#[event]
pub struct PayeeRemoved {
    pub agent: Pubkey,
    pub payee: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PaymentExecuted {
    pub principal: Pubkey,
    pub agent: Pubkey,
    /// The wallet that owns the destination token account.
    pub payee: Pubkey,
    /// The destination token account.
    pub destination: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub reference: [u8; REFERENCE_LEN],
    pub memo: [u8; MEMO_LEN],
    pub delegation: Pubkey,
    /// Set when the payment consumed an approved request.
    pub request_nonce: Option<u64>,
    /// The agent's payment count after this payment.
    pub payments_count: u64,
    pub timestamp: i64,
}

#[event]
pub struct PaymentDenied {
    pub principal: Pubkey,
    pub agent: Pubkey,
    /// The wallet that owns the destination token account.
    pub payee: Pubkey,
    /// The destination token account.
    pub destination: Pubkey,
    pub amount: u64,
    pub reason: DenialReason,
    /// Strikes in the current window after this attempt.
    pub strikes: u8,
    /// True if this attempt froze the agent.
    pub tripped: bool,
    pub reference: [u8; REFERENCE_LEN],
    pub memo: [u8; MEMO_LEN],
    pub timestamp: i64,
}

#[event]
pub struct PaymentRequested {
    pub agent: Pubkey,
    pub request: Pubkey,
    pub nonce: u64,
    pub payee: Pubkey,
    pub amount: u64,
    pub reference: [u8; REFERENCE_LEN],
    pub memo: [u8; MEMO_LEN],
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct RequestApproved {
    pub agent: Pubkey,
    pub request: Pubkey,
    pub nonce: u64,
    pub timestamp: i64,
}

#[event]
pub struct RequestRejected {
    pub agent: Pubkey,
    pub request: Pubkey,
    pub nonce: u64,
    pub by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct RequestExpired {
    pub agent: Pubkey,
    pub request: Pubkey,
    pub nonce: u64,
    pub timestamp: i64,
}
