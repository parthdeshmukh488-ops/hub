//! `reject_request`: the owner or the guardian refuses a request; the rent goes back to whoever
//! paid it (01 §6.1).

use anchor_lang::prelude::*;

use crate::{
    constants::{AGENT_SEED, PRINCIPAL_SEED, REQUEST_SEED},
    errors::LeashError,
    events::RequestRejected,
    state::{Agent, PaymentRequest, Principal},
};

#[event_cpi]
#[derive(Accounts)]
pub struct RejectRequest<'info> {
    /// The owner or the guardian.
    pub authority: Signer<'info>,
    #[account(
        seeds = [PRINCIPAL_SEED, principal.owner.as_ref()],
        bump = principal.bump,
        constraint = principal.is_owner_or_guardian(&authority.key()) @ LeashError::Unauthorized,
    )]
    pub principal: Box<Account<'info, Principal>>,
    #[account(
        mut,
        seeds = [AGENT_SEED, principal.key().as_ref(), agent.agent_key.as_ref()],
        bump = agent.bump,
        has_one = principal @ LeashError::Unauthorized,
    )]
    pub agent: Box<Account<'info, Agent>>,
    #[account(
        mut,
        close = rent_receiver,
        seeds = [REQUEST_SEED, agent.key().as_ref(), &request.nonce.to_le_bytes()],
        bump = request.bump,
        has_one = agent @ LeashError::RequestMismatch,
    )]
    pub request: Box<Account<'info, PaymentRequest>>,
    /// CHECK: only receives lamports; must be `request.rent_payer`.
    #[account(mut, address = request.rent_payer @ LeashError::RequestMismatch)]
    pub rent_receiver: UncheckedAccount<'info>,
}

pub fn handle_reject_request(ctx: Context<RejectRequest>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let agent = &mut ctx.accounts.agent;
    agent.open_requests = agent
        .open_requests
        .checked_sub(1)
        .ok_or(LeashError::MathOverflow)?;
    agent.updated_at = now;
    emit_cpi!(RequestRejected {
        agent: ctx.accounts.agent.key(),
        request: ctx.accounts.request.key(),
        nonce: ctx.accounts.request.nonce,
        by: ctx.accounts.authority.key(),
        timestamp: now,
    });
    Ok(())
}
