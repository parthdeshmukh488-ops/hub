//! `close_agent`: removes an agent without payees or open requests (01 §6.1).

use anchor_lang::prelude::*;

use crate::{
    constants::{AGENT_SEED, PRINCIPAL_SEED},
    errors::LeashError,
    events::AgentClosed,
    state::{Agent, Principal},
};

#[event_cpi]
#[derive(Accounts)]
pub struct CloseAgent<'info> {
    /// Receives the rent.
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [PRINCIPAL_SEED, owner.key().as_ref()],
        bump = principal.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub principal: Box<Account<'info, Principal>>,
    #[account(
        mut,
        close = owner,
        seeds = [AGENT_SEED, principal.key().as_ref(), agent.agent_key.as_ref()],
        bump = agent.bump,
        has_one = principal @ LeashError::Unauthorized,
    )]
    pub agent: Box<Account<'info, Agent>>,
}

pub fn handle_close_agent(mut ctx: Context<CloseAgent>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = &mut ctx.accounts;
    require!(
        accounts.agent.payee_count == 0 && accounts.agent.open_requests == 0,
        LeashError::AgentNotEmpty
    );
    accounts.principal.agent_count = accounts
        .principal
        .agent_count
        .checked_sub(1)
        .ok_or(LeashError::MathOverflow)?;
    emit_cpi!(AgentClosed {
        principal: ctx.accounts.principal.key(),
        agent: ctx.accounts.agent.key(),
        timestamp: now,
    });
    Ok(())
}
