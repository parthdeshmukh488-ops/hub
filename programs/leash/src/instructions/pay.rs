//! `pay`: the only path to the owner's funds (01-onchain-program §6.2).
//!
//! Either it moves exactly `amount` to an allowed payee through the Subscriptions program, or it
//! fails and nothing changes: a denial is an error, never a quiet success (ADR-0002).

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use super::payment::{check_payment_accounts, eval_input, PaymentAccounts};
use crate::{
    constants::{
        AGENT_SEED, MEMO_LEN, PRINCIPAL_SEED, REFERENCE_LEN, SUBSCRIPTIONS_EVENT_AUTHORITY,
        SUBSCRIPTIONS_PROGRAM_ID,
    },
    errors::LeashError,
    events::PaymentExecuted,
    policy::evaluate,
    state::{Agent, AgentPaymentEffects, Payee, PaymentRequest, Principal},
    subscriptions::{invoke_transfer, transfer_data, TransferAccounts},
};

/// Arguments of `pay` and `report_denied_attempt`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PayArgs {
    pub amount: u64,
    /// Binds the payment to its context (x402 memo hash, request reference).
    pub reference: [u8; REFERENCE_LEN],
    /// The human-readable purpose, UTF-8, zero-padded.
    pub memo: [u8; MEMO_LEN],
}

/// Account order is fixed by 01 §6.2. The facilitator's fee payer is never one of them.
#[event_cpi]
#[derive(Accounts)]
pub struct Pay<'info> {
    /// Must be `agent.agent_key`. Not the fee payer in x402 flows.
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
    /// The allowlist entry for the destination's owner. Required in `AllowListOnly` mode;
    /// `evaluate` checks that it belongs to this agent and names the payee.
    #[account(mut)]
    pub payee_entry: Option<Box<Account<'info, Payee>>>,
    /// An approved request to consume; `evaluate` checks it.
    #[account(mut)]
    pub request: Option<Box<Account<'info, PaymentRequest>>>,
    /// CHECK: receives the consumed request's rent. Required iff `request` is present, and must
    /// be `request.rent_payer` (checked in the handler).
    #[account(mut)]
    pub request_rent_receiver: Option<UncheckedAccount<'info>>,
    /// CHECK: a Subscriptions delegation, parsed read-only by `check_payment_accounts` (owner
    /// program, v1 layout, delegator, delegatee, mint). Subscriptions writes it during the CPI.
    #[account(mut)]
    pub delegation: UncheckedAccount<'info>,
    /// CHECK: the owner's Subscription Authority for this mint: owned by Subscriptions and named
    /// by the delegation (checked in the handler). Subscriptions verifies its contents.
    #[account(owner = SUBSCRIPTIONS_PROGRAM_ID @ LeashError::DelegationMismatch)]
    pub subscription_authority: UncheckedAccount<'info>,
    /// The owner's associated token account for `mint`; the delegation debits it.
    #[account(mut)]
    pub source_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Its owner is the payee wallet the allowlist is checked against.
    #[account(mut)]
    pub destination_token_account: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    /// CHECK: the Subscriptions program (address checked).
    #[account(address = SUBSCRIPTIONS_PROGRAM_ID)]
    pub subscriptions_program: UncheckedAccount<'info>,
    /// CHECK: Subscriptions' event authority PDA (address checked).
    #[account(address = SUBSCRIPTIONS_EVENT_AUTHORITY)]
    pub subscriptions_event_authority: UncheckedAccount<'info>,
}

pub fn handle_pay<'info>(mut ctx: Context<'info, Pay<'info>>, args: PayArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = &ctx.accounts;

    // 1. Account checks: errors, never denials.
    let payment = PaymentAccounts {
        principal: &accounts.principal,
        agent: &accounts.agent,
        agent_address: accounts.agent.key(),
        delegation: &accounts.delegation,
        source: &accounts.source_token_account,
        destination: &accounts.destination_token_account,
        mint: accounts.mint.key(),
        token_program: accounts.token_program.key(),
    };
    let delegation = check_payment_accounts(&payment)?;
    require_keys_eq!(
        delegation.subscription_authority,
        accounts.subscription_authority.key(),
        LeashError::DelegationMismatch
    );
    match (&accounts.request, &accounts.request_rent_receiver) {
        (Some(request), Some(receiver)) => require_keys_eq!(
            receiver.key(),
            request.rent_payer,
            LeashError::RequestMismatch
        ),
        (None, None) => {}
        _ => return err!(LeashError::RequestMismatch),
    }

    // 2. The policy. A denial fails the transaction; nothing is written.
    let input = eval_input(
        &payment,
        &delegation,
        accounts.payee_entry.as_deref().map(|entry| &**entry),
        accounts.request.as_deref().map(|request| &**request),
        args.amount,
        args.reference,
        now,
    );
    let effects = evaluate(&input).map_err(|rejection| Error::from(rejection.error()))?;
    let destination = accounts.destination_token_account.key();
    let payee = accounts.destination_token_account.owner;
    let request_nonce = accounts.request.as_ref().map(|request| request.nonce);

    // 3. Counters. A consumed request is closed after the transfer, where Anchor would close it.
    let accounts = &mut ctx.accounts;
    accounts.agent.record_payment(
        &AgentPaymentEffects {
            velocity: effects.velocity,
            amount: args.amount,
            consumes_request: effects.consumes_request,
        },
        now,
    )?;
    if let (Some(entry), Some(period)) = (accounts.payee_entry.as_mut(), effects.payee) {
        entry.record_payment(period, args.amount)?;
    }

    // 4. The transfer, with the Agent PDA signing as the delegatee.
    let principal_key = accounts.principal.key();
    let agent_key = accounts.agent_key.key();
    let bump = [accounts.agent.bump];
    let seeds: [&[u8]; 4] = [
        AGENT_SEED,
        principal_key.as_ref(),
        agent_key.as_ref(),
        &bump,
    ];
    let agent_info = accounts.agent.to_account_info();
    let transfer = TransferAccounts {
        delegation: &accounts.delegation.to_account_info(),
        subscription_authority: &accounts.subscription_authority.to_account_info(),
        source: &accounts.source_token_account.to_account_info(),
        destination: &accounts.destination_token_account.to_account_info(),
        mint: &accounts.mint.to_account_info(),
        token_program: &accounts.token_program.to_account_info(),
        delegatee: &agent_info,
        event_authority: &accounts.subscriptions_event_authority.to_account_info(),
        program: &accounts.subscriptions_program.to_account_info(),
    };
    invoke_transfer(
        &transfer,
        ctx.remaining_accounts,
        transfer_data(
            delegation.state.transfer_discriminator(),
            args.amount,
            &delegation.delegator,
            &delegation.mint,
        ),
        &seeds,
    )?;

    let accounts = &ctx.accounts;
    if let (Some(request), Some(receiver)) = (&accounts.request, &accounts.request_rent_receiver) {
        request.close(receiver.to_account_info())?;
    }

    // 5. The audit trail (I5).
    let payments_count = ctx.accounts.agent.stats.payments_count;
    emit_cpi!(PaymentExecuted {
        principal: principal_key,
        agent: ctx.accounts.agent.key(),
        payee,
        destination,
        mint: ctx.accounts.mint.key(),
        amount: args.amount,
        reference: args.reference,
        memo: args.memo,
        delegation: ctx.accounts.delegation.key(),
        request_nonce,
        payments_count,
        timestamp: now,
    });
    Ok(())
}
