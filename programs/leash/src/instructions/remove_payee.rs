//! `remove_payee`: takes a wallet off an agent's allowlist (01 §6.1).

use anchor_lang::prelude::*;

use crate::{
    constants::{AGENT_SEED, PAYEE_SEED, PRINCIPAL_SEED},
    errors::LeashError,
    events::PayeeRemoved,
    state::{Agent, Payee, Principal},
};

#[event_cpi]
#[derive(Accounts)]
pub struct RemovePayee<'info> {
    /// Receives the rent.
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        seeds = [PRINCIPAL_SEED, owner.key().as_ref()],
        bump = principal.bump,
        has_one = owner @ LeashError::Unauthorized,
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
        close = owner,
        seeds = [PAYEE_SEED, agent.key().as_ref(), payee_entry.payee.as_ref()],
        bump = payee_entry.bump,
        has_one = agent @ LeashError::Unauthorized,
    )]
    pub payee_entry: Box<Account<'info, Payee>>,
}

pub fn handle_remove_payee(ctx: Context<RemovePayee>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let agent = &mut ctx.accounts.agent;
    agent.payee_count = agent
        .payee_count
        .checked_sub(1)
        .ok_or(LeashError::MathOverflow)?;
    agent.updated_at = now;
    emit_cpi!(PayeeRemoved {
        agent: ctx.accounts.agent.key(),
        payee: ctx.accounts.payee_entry.payee,
        timestamp: now,
    });
    Ok(())
}
