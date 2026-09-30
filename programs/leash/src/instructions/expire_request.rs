//! `expire_request`: anyone may close a request after it expired (01 §6.3).

use anchor_lang::prelude::*;

use crate::{
    constants::{AGENT_SEED, REQUEST_SEED},
    errors::LeashError,
    events::RequestExpired,
    state::{Agent, PaymentRequest},
};

/// Permissionless: no signer besides the fee payer, which is not an instruction account.
#[event_cpi]
#[derive(Accounts)]
pub struct ExpireRequest<'info> {
    #[account(
        mut,
        seeds = [AGENT_SEED, agent.principal.as_ref(), agent.agent_key.as_ref()],
        bump = agent.bump,
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

pub fn handle_expire_request(ctx: Context<ExpireRequest>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(
        ctx.accounts.request.is_expired(now),
        LeashError::RequestNotExpired
    );
    let agent = &mut ctx.accounts.agent;
    agent.open_requests = agent
        .open_requests
        .checked_sub(1)
        .ok_or(LeashError::MathOverflow)?;
    agent.updated_at = now;
    emit_cpi!(RequestExpired {
        agent: ctx.accounts.agent.key(),
        request: ctx.accounts.request.key(),
        nonce: ctx.accounts.request.nonce,
        timestamp: now,
    });
    Ok(())
}
