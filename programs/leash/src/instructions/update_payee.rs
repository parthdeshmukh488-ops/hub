//! `update_payee`: replaces an entry's label and limits; its period counters are kept (01 §6.1).

use anchor_lang::prelude::*;

use crate::{
    constants::{AGENT_SEED, LABEL_LEN, PAYEE_SEED, PRINCIPAL_SEED},
    errors::LeashError,
    events::PayeeUpdated,
    state::{Agent, Payee, PayeeLimits, Principal},
};

#[event_cpi]
#[derive(Accounts)]
pub struct UpdatePayee<'info> {
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
        seeds = [PAYEE_SEED, agent.key().as_ref(), payee_entry.payee.as_ref()],
        bump = payee_entry.bump,
        has_one = agent @ LeashError::Unauthorized,
    )]
    pub payee_entry: Box<Account<'info, Payee>>,
}

pub fn handle_update_payee(
    ctx: Context<UpdatePayee>,
    label: [u8; LABEL_LEN],
    limits: PayeeLimits,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    limits.validate()?;
    ctx.accounts.payee_entry.set_limits(label, &limits);
    emit_cpi!(PayeeUpdated {
        agent: ctx.accounts.agent.key(),
        payee: ctx.accounts.payee_entry.payee,
        label,
        limits,
        timestamp: now,
    });
    Ok(())
}
