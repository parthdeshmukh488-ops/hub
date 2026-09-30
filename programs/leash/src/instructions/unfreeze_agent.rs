//! `unfreeze_agent`: only the owner reactivates an agent; its strikes are cleared (01 §6.1, I3).

use anchor_lang::prelude::*;

use crate::{
    constants::{AGENT_SEED, PRINCIPAL_SEED},
    errors::LeashError,
    events::AgentUnfrozen,
    state::{Agent, Principal},
};

#[event_cpi]
#[derive(Accounts)]
pub struct UnfreezeAgent<'info> {
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
}

/// Idempotent: unfreezing an active agent changes nothing and emits nothing.
pub fn handle_unfreeze_agent(ctx: Context<UnfreezeAgent>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    if ctx.accounts.agent.unfreeze(now) {
        emit_cpi!(AgentUnfrozen {
            agent: ctx.accounts.agent.key(),
            timestamp: now,
        });
    }
    Ok(())
}
