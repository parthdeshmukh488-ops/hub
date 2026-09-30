//! `set_guardian`: sets or clears the key that may only stop things (01 §6.1, T14).

use anchor_lang::prelude::*;

use crate::{
    constants::PRINCIPAL_SEED,
    errors::LeashError,
    events::GuardianChanged,
    state::{guardian_arg, Principal},
};

#[event_cpi]
#[derive(Accounts)]
pub struct SetGuardian<'info> {
    pub owner: Signer<'info>,
    #[account(
        mut,
        seeds = [PRINCIPAL_SEED, owner.key().as_ref()],
        bump = principal.bump,
        has_one = owner @ LeashError::Unauthorized,
    )]
    pub principal: Box<Account<'info, Principal>>,
}

pub fn handle_set_guardian(ctx: Context<SetGuardian>, guardian: Option<Pubkey>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let guardian = guardian_arg(guardian);
    ctx.accounts.principal.guardian = guardian.unwrap_or_default();
    emit_cpi!(GuardianChanged {
        principal: ctx.accounts.principal.key(),
        guardian,
        timestamp: now,
    });
    Ok(())
}
