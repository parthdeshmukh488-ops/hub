//! `create_agent`: one Agent PDA per agent key, the Subscriptions delegatee (01 §6.1).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::{ACCOUNT_VERSION, AGENT_SEED, LABEL_LEN, PRINCIPAL_SEED},
    errors::LeashError,
    events::AgentCreated,
    state::{Agent, AgentStats, AgentStatus, FreezeReason, Policy, Principal},
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(agent_key: Pubkey)]
pub struct CreateAgent<'info> {
    /// Pays the rent.
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
        init,
        payer = owner,
        space = 8 + Agent::INIT_SPACE,
        seeds = [AGENT_SEED, principal.key().as_ref(), agent_key.as_ref()],
        bump,
    )]
    pub agent: Box<Account<'info, Agent>>,
    /// The only mint this agent can pay with (SPL Token or Token-2022).
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_agent(
    mut ctx: Context<CreateAgent>,
    agent_key: Pubkey,
    label: [u8; LABEL_LEN],
    policy: Policy,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = &mut ctx.accounts;
    require_keys_neq!(agent_key, accounts.owner.key(), LeashError::InvalidAgentKey);
    policy.validate(now)?;

    let principal = accounts.principal.key();
    accounts.principal.agent_count = accounts
        .principal
        .agent_count
        .checked_add(1)
        .ok_or(LeashError::MathOverflow)?;
    let agent = accounts.agent.key();
    let mint = accounts.mint.key();
    accounts.agent.set_inner(Agent {
        version: ACCOUNT_VERSION,
        bump: ctx.bumps.agent,
        principal,
        owner: accounts.owner.key(),
        agent_key,
        mint,
        label,
        status: AgentStatus::Active,
        freeze_reason: FreezeReason::None,
        frozen_at: 0,
        payee_count: 0,
        open_requests: 0,
        policy,
        stats: AgentStats::default(),
        created_at: now,
        updated_at: now,
        reserved: [0; 64],
    });
    emit_cpi!(AgentCreated {
        principal,
        agent,
        agent_key,
        mint,
        label,
        policy,
        timestamp: now,
    });
    Ok(())
}
