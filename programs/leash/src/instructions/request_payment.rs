//! `request_payment`: asks the owner to approve one payment above the instant limit (01 §6.2).

use anchor_lang::prelude::*;

use crate::{
    constants::{
        ACCOUNT_VERSION, AGENT_SEED, MAX_OPEN_REQUESTS, MEMO_LEN, PRINCIPAL_SEED, REFERENCE_LEN,
        REQUEST_SEED,
    },
    errors::LeashError,
    events::PaymentRequested,
    state::{Agent, AgentStatus, Payee, PayeeMode, PaymentRequest, Principal, RequestStatus},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct RequestArgs {
    /// The payee wallet (the owner of the destination token account).
    pub payee: Pubkey,
    pub amount: u64,
    /// Must match the later `pay`.
    pub reference: [u8; REFERENCE_LEN],
    /// Purpose shown to the owner, UTF-8, zero-padded.
    pub memo: [u8; MEMO_LEN],
}

#[event_cpi]
#[derive(Accounts)]
pub struct RequestPayment<'info> {
    pub agent_key: Signer<'info>,
    /// Pays the request's rent and gets it back when the request closes. Usually the agent key.
    #[account(mut)]
    pub rent_payer: Signer<'info>,
    #[account(seeds = [PRINCIPAL_SEED, principal.owner.as_ref()], bump = principal.bump)]
    pub principal: Box<Account<'info, Principal>>,
    #[account(
        mut,
        seeds = [AGENT_SEED, principal.key().as_ref(), agent_key.key().as_ref()],
        bump = agent.bump,
        has_one = principal @ LeashError::Unauthorized,
        has_one = agent_key @ LeashError::Unauthorized,
    )]
    pub agent: Box<Account<'info, Agent>>,
    /// The allowlist entry for `payee`; required in `AllowListOnly` mode.
    pub payee_entry: Option<Box<Account<'info, Payee>>>,
    #[account(
        init,
        payer = rent_payer,
        space = 8 + PaymentRequest::INIT_SPACE,
        seeds = [REQUEST_SEED, agent.key().as_ref(), &agent.stats.request_nonce.to_le_bytes()],
        bump,
    )]
    pub request: Box<Account<'info, PaymentRequest>>,
    pub system_program: Program<'info, System>,
}

/// Checks of §6.2 `request_payment`, in order. Each failure is an error.
fn check_request(
    principal: &Principal,
    agent: &Agent,
    agent_address: &Pubkey,
    payee_entry: Option<&Payee>,
    args: &RequestArgs,
    now: i64,
) -> Result<()> {
    let policy = &agent.policy;
    // 1. Freezes and expiry.
    require!(!principal.frozen, LeashError::DeniedPrincipalFrozen);
    require!(
        agent.status == AgentStatus::Active,
        LeashError::DeniedAgentFrozen
    );
    require!(
        policy.valid_until == 0 || now < policy.valid_until,
        LeashError::DeniedAgentExpired
    );
    // 2–4. Approvals on, needed, and within their bound.
    require!(policy.approvals_enabled(), LeashError::ApprovalsDisabled);
    require!(
        args.amount > policy.max_per_payment,
        LeashError::ApprovalNotNeeded
    );
    require!(
        args.amount <= policy.max_per_request,
        LeashError::DeniedExceedsPaymentLimit
    );
    // 5. The allowlist.
    let allowlisted =
        payee_entry.is_some_and(|entry| entry.agent == *agent_address && entry.payee == args.payee);
    require!(
        policy.payee_mode == PayeeMode::AnyPayee || allowlisted,
        LeashError::DeniedPayeeNotAllowed
    );
    // 6. The spam guard.
    require!(
        agent.open_requests < MAX_OPEN_REQUESTS,
        LeashError::TooManyOpenRequests
    );
    Ok(())
}

pub fn handle_request_payment(mut ctx: Context<RequestPayment>, args: RequestArgs) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let accounts = &mut ctx.accounts;
    let agent_address = accounts.agent.key();
    check_request(
        &accounts.principal,
        &accounts.agent,
        &agent_address,
        accounts.payee_entry.as_deref().map(|entry| &**entry),
        &args,
        now,
    )?;

    let agent = &mut accounts.agent;
    let nonce = agent.stats.request_nonce;
    let expires_at = now
        .checked_add(i64::from(agent.policy.request_ttl_secs))
        .ok_or(LeashError::MathOverflow)?;
    agent.stats.request_nonce = nonce.checked_add(1).ok_or(LeashError::MathOverflow)?;
    agent.open_requests = agent
        .open_requests
        .checked_add(1)
        .ok_or(LeashError::MathOverflow)?;
    agent.updated_at = now;

    let request_address = accounts.request.key();
    accounts.request.set_inner(PaymentRequest {
        version: ACCOUNT_VERSION,
        bump: ctx.bumps.request,
        agent: agent_address,
        nonce,
        payee: args.payee,
        amount: args.amount,
        reference: args.reference,
        memo: args.memo,
        status: RequestStatus::Pending,
        created_at: now,
        expires_at,
        approved_at: 0,
        rent_payer: accounts.rent_payer.key(),
        reserved: [0; 32],
    });

    emit_cpi!(PaymentRequested {
        agent: agent_address,
        request: request_address,
        nonce,
        payee: args.payee,
        amount: args.amount,
        reference: args.reference,
        memo: args.memo,
        expires_at,
        timestamp: now,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{AgentStats, FreezeReason, Policy};

    const NOW: i64 = 1_790_935_200;

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn principal() -> Principal {
        Principal {
            version: 1,
            bump: 255,
            owner: key(1),
            guardian: Pubkey::default(),
            frozen: false,
            frozen_at: 0,
            frozen_by: Pubkey::default(),
            agent_count: 1,
            created_at: 0,
            reserved: [0; 64],
        }
    }

    fn agent() -> Agent {
        Agent {
            version: 1,
            bump: 254,
            principal: key(2),
            owner: key(1),
            agent_key: key(3),
            mint: key(4),
            label: [0; 32],
            status: AgentStatus::Active,
            freeze_reason: FreezeReason::None,
            frozen_at: 0,
            payee_count: 1,
            open_requests: 0,
            policy: Policy {
                max_per_payment: 1_000_000,
                max_per_request: 5_000_000,
                payee_mode: PayeeMode::AllowListOnly,
                velocity_max_payments: 30,
                velocity_window_secs: 60,
                tripwire_max_strikes: 3,
                tripwire_window_secs: 600,
                request_ttl_secs: 3_600,
                valid_until: 0,
            },
            stats: AgentStats::default(),
            created_at: 0,
            updated_at: 0,
            reserved: [0; 64],
        }
    }

    const AGENT: Pubkey = Pubkey::new_from_array([9; 32]);

    fn entry(agent: Pubkey, payee: Pubkey) -> Payee {
        Payee {
            version: 1,
            bump: 253,
            agent,
            payee,
            label: [0; 32],
            max_per_payment: 0,
            period_limit: 0,
            period_secs: 0,
            period_start: 0,
            spent_in_period: 0,
            total_paid: 0,
            payments_count: 0,
            created_at: 0,
            reserved: [0; 32],
        }
    }

    fn args(amount: u64) -> RequestArgs {
        RequestArgs {
            payee: key(5),
            amount,
            reference: [7; 32],
            memo: [0; 64],
        }
    }

    fn check(
        principal: &Principal,
        agent: &Agent,
        entry: Option<&Payee>,
        amount: u64,
    ) -> Result<()> {
        check_request(principal, agent, &AGENT, entry, &args(amount), NOW)
    }

    #[test]
    fn checks_run_in_the_documented_order() {
        let listed = entry(AGENT, key(5));
        let ok = Some(&listed);
        assert!(check(&principal(), &agent(), ok, 2_000_000).is_ok());

        let mut frozen = principal();
        frozen.frozen = true;
        let mut off = agent();
        off.policy.max_per_request = 0;
        // A frozen owner wins over every later check.
        assert_eq!(
            check(&frozen, &off, None, 1),
            Err(LeashError::DeniedPrincipalFrozen.into())
        );
        let mut paused = agent();
        paused.status = AgentStatus::Frozen;
        assert_eq!(
            check(&principal(), &paused, ok, 2_000_000),
            Err(LeashError::DeniedAgentFrozen.into())
        );
        let mut expired = agent();
        expired.policy.valid_until = NOW;
        assert_eq!(
            check(&principal(), &expired, ok, 2_000_000),
            Err(LeashError::DeniedAgentExpired.into())
        );
        assert_eq!(
            check(&principal(), &off, ok, 2_000_000),
            Err(LeashError::ApprovalsDisabled.into())
        );
        assert_eq!(
            check(&principal(), &agent(), ok, 1_000_000),
            Err(LeashError::ApprovalNotNeeded.into())
        );
        assert_eq!(
            check(&principal(), &agent(), ok, 5_000_001),
            Err(LeashError::DeniedExceedsPaymentLimit.into())
        );
        assert!(check(&principal(), &agent(), ok, 5_000_000).is_ok());
    }

    #[test]
    fn the_allowlist_needs_this_agents_entry_for_this_payee() {
        let other_agent = entry(key(8), key(5));
        let other_payee = entry(AGENT, key(6));
        for candidate in [None, Some(&other_agent), Some(&other_payee)] {
            assert_eq!(
                check(&principal(), &agent(), candidate, 2_000_000),
                Err(LeashError::DeniedPayeeNotAllowed.into())
            );
        }
        let mut any = agent();
        any.policy.payee_mode = PayeeMode::AnyPayee;
        assert!(check(&principal(), &any, None, 2_000_000).is_ok());
    }

    #[test]
    fn at_most_eight_requests_are_open() {
        let listed = entry(AGENT, key(5));
        let mut busy = agent();
        busy.open_requests = MAX_OPEN_REQUESTS - 1;
        assert!(check(&principal(), &busy, Some(&listed), 2_000_000).is_ok());
        busy.open_requests = MAX_OPEN_REQUESTS;
        assert_eq!(
            check(&principal(), &busy, Some(&listed), 2_000_000),
            Err(LeashError::TooManyOpenRequests.into())
        );
    }
}
