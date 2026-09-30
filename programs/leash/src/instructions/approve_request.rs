//! `approve_request`: the owner allows one exact payment above the instant limit (01 §6.1).

use anchor_lang::prelude::*;

use crate::{
    constants::{AGENT_SEED, PRINCIPAL_SEED, REQUEST_SEED},
    errors::LeashError,
    events::RequestApproved,
    state::{Agent, PaymentRequest, Principal, RequestStatus},
};

#[event_cpi]
#[derive(Accounts)]
pub struct ApproveRequest<'info> {
    pub owner: Signer<'info>,
    #[account(
        seeds = [PRINCIPAL_SEED, owner.key().as_ref()],
        bump = principal.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub principal: Box<Account<'info, Principal>>,
    #[account(
        seeds = [AGENT_SEED, principal.key().as_ref(), agent.agent_key.as_ref()],
        bump = agent.bump,
        has_one = principal @ LeashError::Unauthorized,
    )]
    pub agent: Box<Account<'info, Agent>>,
    #[account(
        mut,
        seeds = [REQUEST_SEED, agent.key().as_ref(), &request.nonce.to_le_bytes()],
        bump = request.bump,
        has_one = agent @ LeashError::RequestMismatch,
    )]
    pub request: Box<Account<'info, PaymentRequest>>,
}

pub fn handle_approve_request(ctx: Context<ApproveRequest>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let request = &mut ctx.accounts.request;
    require!(
        request.status == RequestStatus::Pending,
        LeashError::RequestNotPending
    );
    require!(!request.is_expired(now), LeashError::RequestExpired);
    request.status = RequestStatus::Approved;
    request.approved_at = now;
    let nonce = request.nonce;
    emit_cpi!(RequestApproved {
        agent: ctx.accounts.agent.key(),
        request: ctx.accounts.request.key(),
        nonce,
        timestamp: now,
    });
    Ok(())
}
