//! `initialize_principal`: one per owner (01 §6.1).

use anchor_lang::prelude::*;

use crate::{
    constants::{ACCOUNT_VERSION, PRINCIPAL_SEED},
    events::PrincipalInitialized,
    state::{guardian_arg, Principal},
};

#[event_cpi]
#[derive(Accounts)]
pub struct InitializePrincipal<'info> {
    /// The owner wallet; pays the rent.
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + Principal::INIT_SPACE,
        seeds = [PRINCIPAL_SEED, owner.key().as_ref()],
        bump,
    )]
    pub principal: Box<Account<'info, Principal>>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize_principal(
    ctx: Context<InitializePrincipal>,
    guardian: Option<Pubkey>,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let guardian = guardian_arg(guardian);
    let owner = ctx.accounts.owner.key();
    let principal = ctx.accounts.principal.key();
    ctx.accounts.principal.set_inner(Principal {
        version: ACCOUNT_VERSION,
        bump: ctx.bumps.principal,
        owner,
        guardian: guardian.unwrap_or_default(),
        frozen: false,
        frozen_at: 0,
        frozen_by: Pubkey::default(),
        agent_count: 0,
        created_at: now,
        reserved: [0; 64],
    });
    emit_cpi!(PrincipalInitialized {
        principal,
        owner,
        guardian,
        timestamp: now,
    });
    Ok(())
}
