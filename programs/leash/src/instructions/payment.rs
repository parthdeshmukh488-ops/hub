//! Account checks and evaluation input shared by `pay` and `report_denied_attempt`
//! (01-onchain-program §6.2, step 1: errors, never denials).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::{ASSOCIATED_TOKEN_PROGRAM_ID, SUBSCRIPTIONS_PROGRAM_ID},
    errors::LeashError,
    policy::{EvalInput, PayeeEntryState, RequestState},
    state::{Agent, Payee, PaymentRequest, Principal},
    subscriptions::{parse_delegation, Delegation},
};

/// The accounts every payment check reads.
pub struct PaymentAccounts<'a, 'info> {
    pub principal: &'a Principal,
    pub agent: &'a Agent,
    /// The Agent PDA.
    pub agent_address: Pubkey,
    pub delegation: &'a AccountInfo<'info>,
    pub source: &'a InterfaceAccount<'info, TokenAccount>,
    pub destination: &'a InterfaceAccount<'info, TokenAccount>,
    /// The agent's mint (the caller checked `mint == agent.mint`).
    pub mint: Pubkey,
    /// The program that owns the mint: SPL Token or Token-2022.
    pub token_program: Pubkey,
}

/// Step 1 of `pay` and `report_denied_attempt`, after Anchor's own constraints (signer, seeds,
/// `has_one`, account owners). Returns the decoded delegation.
///
/// - The delegation is a Subscriptions account (`DelegationMismatch`) in the version-1 layout
///   (`UnsupportedDelegation`) from this owner to this Agent PDA for this mint
///   (`DelegationMismatch`).
/// - Both token accounts hold the agent's mint (`MintMismatch`).
/// - The source is the owner's associated token account, the only one Subscriptions debits
///   (`DelegationMismatch`).
/// - The destination is not the source, and is owned neither by the agent key nor by the Agent
///   PDA (`InvalidDestination`), mirroring `add_payee`'s `InvalidPayee`.
pub fn check_payment_accounts(accounts: &PaymentAccounts) -> Result<Delegation> {
    require_keys_eq!(
        *accounts.delegation.owner,
        SUBSCRIPTIONS_PROGRAM_ID,
        LeashError::DelegationMismatch
    );
    let delegation = parse_delegation(&accounts.delegation.try_borrow_data()?)?;
    require!(
        delegation.delegator == accounts.principal.owner
            && delegation.delegatee == accounts.agent_address
            && delegation.mint == accounts.agent.mint,
        LeashError::DelegationMismatch
    );

    let source = accounts.source;
    let destination = accounts.destination;
    require!(
        source.mint == accounts.mint && destination.mint == accounts.mint,
        LeashError::MintMismatch
    );
    let (owner_ata, _) = Pubkey::find_program_address(
        &[
            accounts.principal.owner.as_ref(),
            accounts.token_program.as_ref(),
            accounts.mint.as_ref(),
        ],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    require!(
        source.owner == accounts.principal.owner && source.key() == owner_ata,
        LeashError::DelegationMismatch
    );
    require!(
        destination.key() != source.key()
            && destination.owner != accounts.agent.agent_key
            && destination.owner != accounts.agent_address,
        LeashError::InvalidDestination
    );
    Ok(delegation)
}

/// The evaluation input for a payment (§7.1). `payee_entry` and `request` are passed as found:
/// `evaluate` decides whether the entry matches and whether the request fits.
pub fn eval_input(
    accounts: &PaymentAccounts,
    delegation: &Delegation,
    payee_entry: Option<&Payee>,
    request: Option<&PaymentRequest>,
    amount: u64,
    reference: [u8; 32],
    now: i64,
) -> EvalInput {
    let agent = accounts.agent;
    EvalInput {
        now,
        principal_frozen: accounts.principal.frozen,
        agent: accounts.agent_address,
        status: agent.status,
        policy: agent.policy,
        velocity_window_start: agent.stats.velocity_window_start,
        velocity_count: agent.stats.velocity_count,
        payee_entry: payee_entry.map(|entry| PayeeEntryState {
            agent: entry.agent,
            payee: entry.payee,
            max_per_payment: entry.max_per_payment,
            period_limit: entry.period_limit,
            period_secs: entry.period_secs,
            period_start: entry.period_start,
            spent_in_period: entry.spent_in_period,
        }),
        request: request.map(|request| RequestState {
            agent: request.agent,
            status: request.status,
            payee: request.payee,
            amount: request.amount,
            reference: request.reference,
            expires_at: request.expires_at,
        }),
        delegation: delegation.state,
        source_amount: accounts.source.amount,
        amount,
        destination_owner: accounts.destination.owner,
        reference,
    }
}
