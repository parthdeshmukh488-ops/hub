//! `freeze_agent`: stops one agent, for the owner or the guardian (01 §6.1, I3).

use anchor_lang::prelude::*;

use crate::{
    constants::{AGENT_SEED, PRINCIPAL_SEED},
    errors::LeashError,
    events::AgentFrozen,
    state::{Agent, FreezeReason, Principal},
};

#[event_cpi]
#[derive(Accounts)]
pub struct FreezeAgent<'info> {
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
}

/// Idempotent: freezing a frozen agent keeps its first reason and emits nothing.
pub fn handle_freeze_agent(ctx: Context<FreezeAgent>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let by = ctx.accounts.authority.key();
    let reason = if by == ctx.accounts.principal.owner {
        FreezeReason::Owner
    } else {
        FreezeReason::Guardian
    };
    if ctx.accounts.agent.freeze(reason, now) {
        emit_cpi!(AgentFrozen {
            agent: ctx.accounts.agent.key(),
            reason,
            by,
            timestamp: now,
        });
    }
    Ok(())
}
