//! `freeze_principal`: the global off switch, for the owner or the guardian (01 §6.1, I3).

use anchor_lang::prelude::*;

use crate::{
    constants::PRINCIPAL_SEED, errors::LeashError, events::PrincipalFrozen, state::Principal,
};

#[event_cpi]
#[derive(Accounts)]
pub struct FreezePrincipal<'info> {
    /// The owner or the guardian.
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [PRINCIPAL_SEED, principal.owner.as_ref()],
        bump = principal.bump,
        constraint = principal.is_owner_or_guardian(&authority.key()) @ LeashError::Unauthorized,
    )]
    pub principal: Box<Account<'info, Principal>>,
}

/// Idempotent: freezing a frozen principal changes nothing and emits nothing.
pub fn handle_freeze_principal(ctx: Context<FreezePrincipal>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let by = ctx.accounts.authority.key();
    if ctx.accounts.principal.freeze(by, now) {
        emit_cpi!(PrincipalFrozen {
            principal: ctx.accounts.principal.key(),
            by,
            timestamp: now,
        });
    }
    Ok(())
}
