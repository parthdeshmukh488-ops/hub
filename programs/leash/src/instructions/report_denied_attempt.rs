//! `report_denied_attempt`: leaves an on-chain trace of a blocked payment (01 §6.2, ADR-0002).
//!
//! It re-evaluates the payment and only records it if the policy really denies it, so it can
//! never move money and cannot frame an agent with strikes for an allowed payment (T7).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use super::{
    pay::PayArgs,
    payment::{check_payment_accounts, eval_input, PaymentAccounts},
};
use crate::{
    constants::{AGENT_SEED, PRINCIPAL_SEED},
    errors::LeashError,
    events::{AgentFrozen, PaymentDenied},
    policy::{evaluate, Rejection},
    state::{Agent, FreezeReason, Payee, Principal},
};

/// All read-only except `agent`. Payment requests are not accepted here.
#[event_cpi]
#[derive(Accounts)]
pub struct ReportDeniedAttempt<'info> {
    pub agent_key: Signer<'info>,
    #[account(seeds = [PRINCIPAL_SEED, principal.owner.as_ref()], bump = principal.bump)]
    pub principal: Box<Account<'info, Principal>>,
    #[account(
        mut,
        seeds = [AGENT_SEED, principal.key().as_ref(), agent_key.key().as_ref()],
        bump = agent.bump,
        has_one = principal @ LeashError::Unauthorized,
        has_one = agent_key @ LeashError::Unauthorized,
        has_one = mint @ LeashError::MintMismatch,
    )]
    pub agent: Box<Account<'info, Agent>>,
    pub payee_entry: Option<Box<Account<'info, Payee>>>,
    /// CHECK: a Subscriptions delegation, parsed read-only by `check_payment_accounts`.
    pub delegation: UncheckedAccount<'info>,
    pub source_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub destination_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handle_report_denied_attempt(
    ctx: Context<ReportDeniedAttempt>,
    args: PayArgs,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = &ctx.accounts;

    // 1. The same account checks as `pay`. Without a token program account, the mint's owner
    //    tells which token program the owner's associated token account belongs to.
    let payment = PaymentAccounts {
        principal: &accounts.principal,
        agent: &accounts.agent,
        agent_address: accounts.agent.key(),
        delegation: &accounts.delegation,
        source: &accounts.source_token_account,
        destination: &accounts.destination_token_account,
        mint: accounts.mint.key(),
        token_program: *accounts.mint.to_account_info().owner,
    };
    let delegation = check_payment_accounts(&payment)?;

    // 2. Only a real denial can be reported.
    let input = eval_input(
        &payment,
        &delegation,
        accounts.payee_entry.as_deref().map(|entry| &**entry),
        None,
        args.amount,
        args.reference,
        now,
    );
    let reason = match evaluate(&input) {
        Ok(_) => return err!(LeashError::AttemptWouldSucceed),
        Err(Rejection::Error(error)) => return Err(error.into()),
        Err(Rejection::Denied(reason)) => reason,
    };
    let destination = accounts.destination_token_account.key();
    let payee = accounts.destination_token_account.owner;

    // 3–4. Count it; strikes may trip the wire.
    let record = ctx.accounts.agent.record_denial(reason, now)?;

    // 5. The audit trail (I5), and the freeze if the wire tripped.
    let agent = ctx.accounts.agent.key();
    emit_cpi!(PaymentDenied {
        principal: ctx.accounts.principal.key(),
        agent,
        payee,
        destination,
        amount: args.amount,
        reason,
        strikes: record.strikes,
        tripped: record.tripped,
        reference: args.reference,
        memo: args.memo,
        timestamp: now,
    });
    if record.tripped {
        emit_cpi!(AgentFrozen {
            agent,
            reason: FreezeReason::Tripwire,
            by: ctx.accounts.agent_key.key(),
            timestamp: now,
        });
    }
    Ok(())
}
