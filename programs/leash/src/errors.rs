//! `LeashError` (01-onchain-program §10).
//!
//! The first twelve variants are the denials, in `DenialReason` order, so that
//! `code - 6000 + 1` is the denial code for every denial. New errors are appended at the end;
//! existing codes never move. `@leash/contracts` holds the same list as `LEASH_ERRORS`, and a
//! contracts test compares it with the IDL.

use anchor_lang::prelude::*;

#[error_code]
#[derive(PartialEq, Eq)]
pub enum LeashError {
    #[msg("All agents of this owner are frozen")]
    DeniedPrincipalFrozen,
    #[msg("This agent is frozen")]
    DeniedAgentFrozen,
    #[msg("This agent's policy has expired")]
    DeniedAgentExpired,
    #[msg("The payee is not on this agent's allowlist")]
    DeniedPayeeNotAllowed,
    #[msg("The amount is above this agent's limit per payment")]
    DeniedExceedsPaymentLimit,
    #[msg("The amount needs the owner's approval")]
    DeniedApprovalRequired,
    #[msg("The amount is above this payee's limit per payment")]
    DeniedExceedsPayeePaymentLimit,
    #[msg("This payee's budget for the period is used up")]
    DeniedExceedsPayeePeriodLimit,
    #[msg("Too many payments in the current window")]
    DeniedVelocityExceeded,
    #[msg("The allowance has expired")]
    DeniedAllowanceExpired,
    #[msg("Not enough allowance left")]
    DeniedAllowanceExceeded,
    #[msg("The owner's token account holds less than the amount")]
    DeniedInsufficientFunds,
    #[msg("The signer is not allowed to do this")]
    Unauthorized,
    #[msg("The policy breaks a rule")]
    InvalidPolicy,
    #[msg("The amount must be greater than zero")]
    InvalidAmount,
    #[msg("The agent key must not be the owner")]
    InvalidAgentKey,
    #[msg("The payee must not be the agent key or the agent account")]
    InvalidPayee,
    #[msg("The mint does not match the agent's mint")]
    MintMismatch,
    #[msg("The destination token account is not a valid destination")]
    InvalidDestination,
    #[msg("The delegation does not belong to this owner, agent and mint")]
    DelegationMismatch,
    #[msg("Unsupported delegation account")]
    UnsupportedDelegation,
    #[msg("The payment does not match the request")]
    RequestMismatch,
    #[msg("The request is not approved")]
    RequestNotApproved,
    #[msg("The request has expired")]
    RequestExpired,
    #[msg("The request is not pending")]
    RequestNotPending,
    #[msg("The request has not expired yet")]
    RequestNotExpired,
    #[msg("Approvals are switched off for this agent")]
    ApprovalsDisabled,
    #[msg("The amount is within the instant limit")]
    ApprovalNotNeeded,
    #[msg("Too many open payment requests")]
    TooManyOpenRequests,
    #[msg("The policy allows this payment")]
    AttemptWouldSucceed,
    #[msg("The agent still has payees or open requests")]
    AgentNotEmpty,
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
