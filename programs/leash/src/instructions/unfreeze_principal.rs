//! `unfreeze_principal`: only the owner turns the switch back on (01 §6.1, I3).

use anchor_lang::prelude::*;

use crate::{
    constants::PRINCIPAL_SEED, errors::LeashError, events::PrincipalUnfrozen, state::Principal,
};

#[event_cpi]
#[derive(Accounts)]
pub struct UnfreezePrincipal<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [PRINCIPAL_SEED, owner.key().as_ref()],
        bump = principal.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub principal: Box<Account<'info, Principal>>,
}

/// Idempotent: unfreezing an active principal changes nothing and emits nothing.
pub fn handle_unfreeze_principal(ctx: Context<UnfreezePrincipal>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    if ctx.accounts.principal.unfreeze() {
        emit_cpi!(PrincipalUnfrozen {
            principal: ctx.accounts.principal.key(),
            timestamp: now,
        });
    }
    Ok(())
}
