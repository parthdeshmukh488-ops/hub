//! `update_policy`: replaces an agent's rules; its counters are kept (01 §6.1).

use anchor_lang::prelude::*;

use crate::{
    constants::{AGENT_SEED, PRINCIPAL_SEED},
    errors::LeashError,
    events::PolicyUpdated,
    state::{Agent, Policy, Principal},
};

#[event_cpi]
#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
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

pub fn handle_update_policy(ctx: Context<UpdatePolicy>, policy: Policy) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    policy.validate(now)?;
    let agent = &mut ctx.accounts.agent;
    agent.policy = policy;
    agent.updated_at = now;
    emit_cpi!(PolicyUpdated {
        agent: ctx.accounts.agent.key(),
        policy,
        timestamp: now,
    });
    Ok(())
}
