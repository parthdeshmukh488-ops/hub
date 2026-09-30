//! `add_payee`: puts a wallet on an agent's allowlist, with optional limits (01 §6.1).

use anchor_lang::prelude::*;

use crate::{
    constants::{ACCOUNT_VERSION, AGENT_SEED, LABEL_LEN, PAYEE_SEED, PRINCIPAL_SEED},
    errors::LeashError,
    events::PayeeAdded,
    state::{Agent, Payee, PayeeLimits, Principal},
};

#[event_cpi]
#[derive(Accounts)]
#[instruction(payee: Pubkey)]
pub struct AddPayee<'info> {
    /// Pays the rent.
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
        init,
        payer = owner,
        space = 8 + Payee::INIT_SPACE,
        seeds = [PAYEE_SEED, agent.key().as_ref(), payee.as_ref()],
        bump,
    )]
    pub payee_entry: Box<Account<'info, Payee>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_add_payee(
    mut ctx: Context<AddPayee>,
    payee: Pubkey,
    label: [u8; LABEL_LEN],
    limits: PayeeLimits,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = &mut ctx.accounts;
    let agent = accounts.agent.key();
    // An agent must never be able to pay itself.
    require!(
        payee != accounts.agent.agent_key && payee != agent,
        LeashError::InvalidPayee
    );
    limits.validate()?;

    accounts.agent.payee_count = accounts
        .agent
        .payee_count
        .checked_add(1)
        .ok_or(LeashError::MathOverflow)?;
    accounts.agent.updated_at = now;
    accounts.payee_entry.set_inner(Payee {
        version: ACCOUNT_VERSION,
        bump: ctx.bumps.payee_entry,
        agent,
        payee,
        label,
        max_per_payment: limits.max_per_payment,
        period_limit: limits.period_limit,
        period_secs: limits.period_secs,
        period_start: 0,
        spent_in_period: 0,
        total_paid: 0,
        payments_count: 0,
        created_at: now,
        reserved: [0; 32],
    });
    emit_cpi!(PayeeAdded {
        agent,
        payee,
        label,
        limits,
        timestamp: now,
    });
    Ok(())
}
