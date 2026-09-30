//! Leash: an on-chain spending firewall for AI agents.
//!
//! The owner gives an agent a budget through the Solana Foundation's Subscriptions program, with
//! the agent's `Agent` PDA as the delegatee. The agent can only spend through [`leash::pay`],
//! which checks the owner's policy (allowlist, limits, rate, expiry, freezes) before it asks
//! Subscriptions to move the money. The owner's funds never leave the owner's wallet.
//!
//! Specification: `docs/architecture/01-onchain-program.md`. This file only routes
//! instructions; each one lives in `instructions/` with its accounts.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod policy;
pub mod state;
pub mod subscriptions;

use constants::LABEL_LEN;
pub use instructions::*;
use state::{PayeeLimits, Policy};

declare_id!("5ZDkdhcRtUrWLpK4vMx3C3r1w8iZyVaXvXzC5kvtQpM5");

#[program]
pub mod leash {
    use super::*;

    // Owner and guardian (01 §6.1).

    /// Creates the owner's principal, optionally with a guardian.
    pub fn initialize_principal(
        ctx: Context<InitializePrincipal>,
        guardian: Option<Pubkey>,
    ) -> Result<()> {
        instructions::initialize_principal::handle_initialize_principal(ctx, guardian)
    }

    /// Sets or clears the guardian.
    pub fn set_guardian(ctx: Context<SetGuardian>, guardian: Option<Pubkey>) -> Result<()> {
        instructions::set_guardian::handle_set_guardian(ctx, guardian)
    }

    /// Freezes every agent of the owner. Owner or guardian.
    pub fn freeze_principal(ctx: Context<FreezePrincipal>) -> Result<()> {
        instructions::freeze_principal::handle_freeze_principal(ctx)
    }

    /// Lifts the global freeze. Owner only.
    pub fn unfreeze_principal(ctx: Context<UnfreezePrincipal>) -> Result<()> {
        instructions::unfreeze_principal::handle_unfreeze_principal(ctx)
    }

    /// Creates an agent for `agent_key` with a validated policy.
    pub fn create_agent(
        ctx: Context<CreateAgent>,
        agent_key: Pubkey,
        label: [u8; LABEL_LEN],
        policy: Policy,
    ) -> Result<()> {
        instructions::create_agent::handle_create_agent(ctx, agent_key, label, policy)
    }

    /// Replaces an agent's policy; its counters are kept.
    pub fn update_policy(ctx: Context<UpdatePolicy>, policy: Policy) -> Result<()> {
        instructions::update_policy::handle_update_policy(ctx, policy)
    }

    /// Freezes one agent. Owner or guardian.
    pub fn freeze_agent(ctx: Context<FreezeAgent>) -> Result<()> {
        instructions::freeze_agent::handle_freeze_agent(ctx)
    }

    /// Reactivates one agent and clears its strikes. Owner only.
    pub fn unfreeze_agent(ctx: Context<UnfreezeAgent>) -> Result<()> {
        instructions::unfreeze_agent::handle_unfreeze_agent(ctx)
    }

    /// Closes an agent that has no payees and no open requests.
    pub fn close_agent(ctx: Context<CloseAgent>) -> Result<()> {
        instructions::close_agent::handle_close_agent(ctx)
    }

    /// Adds a wallet to an agent's allowlist.
    pub fn add_payee(
        ctx: Context<AddPayee>,
        payee: Pubkey,
        label: [u8; LABEL_LEN],
        limits: PayeeLimits,
    ) -> Result<()> {
        instructions::add_payee::handle_add_payee(ctx, payee, label, limits)
    }

    /// Replaces an allowlist entry's label and limits.
    pub fn update_payee(
        ctx: Context<UpdatePayee>,
        label: [u8; LABEL_LEN],
        limits: PayeeLimits,
    ) -> Result<()> {
        instructions::update_payee::handle_update_payee(ctx, label, limits)
    }

    /// Removes an allowlist entry.
    pub fn remove_payee(ctx: Context<RemovePayee>) -> Result<()> {
        instructions::remove_payee::handle_remove_payee(ctx)
    }

    /// Approves a pending payment request.
    pub fn approve_request(ctx: Context<ApproveRequest>) -> Result<()> {
        instructions::approve_request::handle_approve_request(ctx)
    }

    /// Rejects a payment request. Owner or guardian.
    pub fn reject_request(ctx: Context<RejectRequest>) -> Result<()> {
        instructions::reject_request::handle_reject_request(ctx)
    }

    // Agent (01 §6.2).

    /// Pays an allowed payee through the Subscriptions delegation, or fails.
    pub fn pay<'info>(ctx: Context<'info, Pay<'info>>, args: PayArgs) -> Result<()> {
        instructions::pay::handle_pay(ctx, args)
    }

    /// Records a payment the policy denies; fails if the policy would allow it.
    pub fn report_denied_attempt(ctx: Context<ReportDeniedAttempt>, args: PayArgs) -> Result<()> {
        instructions::report_denied_attempt::handle_report_denied_attempt(ctx, args)
    }

    /// Asks the owner to approve a payment above the instant limit.
    pub fn request_payment(ctx: Context<RequestPayment>, args: RequestArgs) -> Result<()> {
        instructions::request_payment::handle_request_payment(ctx, args)
    }

    // Permissionless (01 §6.3).

    /// Closes an expired payment request.
    pub fn expire_request(ctx: Context<ExpireRequest>) -> Result<()> {
        instructions::expire_request::handle_expire_request(ctx)
    }
}
