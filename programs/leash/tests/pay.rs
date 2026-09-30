//! `pay` on the real program (01-onchain-program §6.2, §11): the happy path, every denial it can
//! reach from a live state, counters and windows, both delegation kinds, and events.
//!
//! Every denial is checked twice: the transaction fails with the matching `Denied*` error, and
//! nothing changed (token balances, the delegation, the agent). `pay` never returns `Ok` without
//! moving money (ADR-0002).

mod common;

use anchor_lang::prelude::Pubkey;
use common::*;
use leash::{
    errors::LeashError,
    events::PaymentExecuted,
    state::{Agent, Payee, PayeeLimits, PayeeMode, Policy},
};
use solana_signer::Signer;

/// Everything a payment could change.
fn snapshot(env: &Env) -> (u64, u64, u64, Vec<u8>, Vec<u8>) {
    (
        env.token_balance(&env.owner_ata),
        env.token_balance(&env.merchant_ata),
        env.token_balance(&env.attacker_ata),
        env.data(&env.delegation),
        env.data(&env.agent),
    )
}

/// Where a payment goes.
#[derive(Clone, Copy)]
enum To {
    /// The allowlisted merchant.
    Merchant,
    /// A wallet that is not on the allowlist.
    Attacker,
}

/// Asserts that paying `amount` fails with `error` and changes nothing.
#[track_caller]
fn denied(env: &mut Env, to: To, amount: u64, error: LeashError) {
    let destination: Pubkey = match to {
        To::Merchant => env.merchant_ata,
        To::Attacker => env.attacker_ata,
    };
    let before = snapshot(env);
    expect_error(env.pay_to(destination, amount), code(error));
    assert!(snapshot(env) == before, "a failed payment changed state");
}

fn owner(env: &Env) -> solana_keypair::Keypair {
    env.owner.insecure_clone()
}

fn no_payee_limits() -> PayeeLimits {
    PayeeLimits {
        max_per_payment: 0,
        period_limit: 0,
        period_secs: 0,
    }
}

#[test]
fn pays_an_allowlisted_merchant_through_the_subscriptions_delegation() {
    let mut env = Env::new();
    let owner_before = env.token_balance(&env.owner_ata);

    let sent = env.pay(250_000).expect("the payment goes through");

    // The money moved from the owner's own account to the merchant, nowhere else.
    assert_eq!(env.token_balance(&env.merchant_ata), 250_000);
    assert_eq!(env.token_balance(&env.owner_ata), owner_before - 250_000);
    // Subscriptions counted it against the allowance (I1).
    assert_eq!(env.recurring_state(&env.delegation), (NOW, 250_000));
    // Exactly one token transfer, and exactly one PaymentExecuted that says so (I5).
    assert_eq!(sent.transfers_checked(), 1);
    let events = sent.events::<PaymentExecuted>();
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(
        (event.principal, event.agent, event.payee, event.destination),
        (
            env.principal,
            env.agent,
            env.merchant.pubkey(),
            env.merchant_ata
        )
    );
    assert_eq!(
        (event.mint, event.amount, event.delegation),
        (env.mint, 250_000, env.delegation)
    );
    assert_eq!(
        (event.reference, event.memo),
        (reference(1), padded("Premium research report"))
    );
    assert_eq!(
        (event.request_nonce, event.payments_count, event.timestamp),
        (None, 1, NOW)
    );
    // The agent's and the payee's counters.
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.stats.payments_count, agent.stats.total_paid),
        (1, 250_000)
    );
    assert_eq!(agent.stats.last_payment_at, NOW);
    assert_eq!(
        (
            agent.stats.velocity_window_start,
            agent.stats.velocity_count
        ),
        (NOW, 1)
    );
    let entry: Payee = env.read(&env.merchant_entry);
    assert_eq!((entry.period_start, entry.spent_in_period), (NOW, 250_000));
    assert_eq!((entry.total_paid, entry.payments_count), (250_000, 1));
}

#[test]
fn a_zero_amount_is_an_error_not_a_denial() {
    let mut env = Env::new();
    denied(&mut env, To::Merchant, 0, LeashError::InvalidAmount);
}

#[test]
fn the_global_off_switch_blocks_payments() {
    let mut env = Env::new();
    let owner = owner(&env);
    env.freeze_principal_as(&owner).unwrap();
    denied(
        &mut env,
        To::Merchant,
        USDC,
        LeashError::DeniedPrincipalFrozen,
    );
}

#[test]
fn a_frozen_agent_cannot_pay() {
    let mut env = Env::new();
    let guardian = env.guardian.insecure_clone();
    env.freeze_agent_as(&guardian).unwrap();
    denied(&mut env, To::Merchant, USDC, LeashError::DeniedAgentFrozen);
}

#[test]
fn an_expired_agent_cannot_pay() {
    let mut env = Env::new();
    let owner = owner(&env);
    let policy = Policy {
        valid_until: NOW + 60,
        ..demo_policy()
    };
    env.update_policy_as(&owner, policy).unwrap();
    env.pay(10_000).expect("still valid");
    env.warp(60);
    denied(
        &mut env,
        To::Merchant,
        10_000,
        LeashError::DeniedAgentExpired,
    );
}

#[test]
fn a_payee_off_the_allowlist_is_blocked() {
    let mut env = Env::new();
    denied(
        &mut env,
        To::Attacker,
        250_000,
        LeashError::DeniedPayeeNotAllowed,
    );
}

#[test]
fn above_the_instant_limit_needs_approval_and_above_the_request_bound_is_blocked() {
    let mut env = Env::new();
    // Instant limit 1 USDC, approvals up to 5 USDC.
    env.pay(USDC).expect("exactly the instant limit");
    denied(
        &mut env,
        To::Merchant,
        USDC + 1,
        LeashError::DeniedApprovalRequired,
    );
    denied(
        &mut env,
        To::Merchant,
        5 * USDC,
        LeashError::DeniedApprovalRequired,
    );
    denied(
        &mut env,
        To::Merchant,
        5 * USDC + 1,
        LeashError::DeniedExceedsPaymentLimit,
    );
    // With approvals off, anything above the instant limit is simply too much.
    let owner = owner(&env);
    let policy = Policy {
        max_per_request: 0,
        ..demo_policy()
    };
    env.update_policy_as(&owner, policy).unwrap();
    denied(
        &mut env,
        To::Merchant,
        USDC + 1,
        LeashError::DeniedExceedsPaymentLimit,
    );
}

#[test]
fn the_payees_own_limits_apply() {
    let mut env = Env::new();
    let owner = owner(&env);
    let limits = PayeeLimits {
        max_per_payment: 500_000,
        ..merchant_limits()
    };
    env.update_payee_as(&owner, env.merchant_entry, limits)
        .unwrap();
    env.pay(500_000).expect("exactly the payee's cap");
    denied(
        &mut env,
        To::Merchant,
        500_001,
        LeashError::DeniedExceedsPayeePaymentLimit,
    );
}

#[test]
fn the_payees_period_budget_is_used_up_then_renews() {
    let mut env = Env::new();
    // 3 USDC a day for the merchant.
    for _ in 0..3 {
        env.pay(USDC).unwrap();
    }
    denied(
        &mut env,
        To::Merchant,
        1,
        LeashError::DeniedExceedsPayeePeriodLimit,
    );
    let entry: Payee = env.read(&env.merchant_entry);
    assert_eq!((entry.period_start, entry.spent_in_period), (NOW, 3 * USDC));
    // The payee window restarts at the first payment after it ended. The recurring allowance
    // (5 USDC a day) renews at the same time.
    env.warp(DAY);
    env.pay(USDC).expect("a new period");
    let entry: Payee = env.read(&env.merchant_entry);
    assert_eq!(
        (entry.period_start, entry.spent_in_period),
        (NOW + DAY, USDC)
    );
    assert_eq!((entry.total_paid, entry.payments_count), (4 * USDC, 4));
}

#[test]
fn the_rate_limit_blocks_bursts_and_its_window_rolls() {
    let mut env = Env::new();
    let owner = owner(&env);
    let policy = Policy {
        velocity_max_payments: 2,
        velocity_window_secs: 60,
        ..demo_policy()
    };
    env.update_policy_as(&owner, policy).unwrap();
    env.pay(10_000).unwrap();
    env.warp(30);
    env.pay(10_000).unwrap();
    denied(
        &mut env,
        To::Merchant,
        10_000,
        LeashError::DeniedVelocityExceeded,
    );
    env.warp(30); // 60 s after the window started
    env.pay(10_000).expect("a new window");
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (
            agent.stats.velocity_window_start,
            agent.stats.velocity_count
        ),
        (NOW + 60, 1)
    );
}

#[test]
fn a_switched_off_rate_limit_is_not_tracked() {
    let mut env = Env::new();
    let owner = owner(&env);
    let policy = Policy {
        velocity_max_payments: 0,
        velocity_window_secs: 0,
        ..demo_policy()
    };
    env.update_policy_as(&owner, policy).unwrap();
    env.pay(10_000).unwrap();
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (
            agent.stats.velocity_window_start,
            agent.stats.velocity_count
        ),
        (0, 0)
    );
}

#[test]
fn the_recurring_allowance_is_the_ceiling_and_renews_each_period() {
    let mut env = Env::new();
    let owner = owner(&env);
    env.update_payee_as(&owner, env.merchant_entry, no_payee_limits())
        .unwrap();
    // 5 USDC a day.
    for _ in 0..5 {
        env.pay(USDC).unwrap();
    }
    assert_eq!(env.recurring_state(&env.delegation), (NOW, 5 * USDC));
    denied(
        &mut env,
        To::Merchant,
        1,
        LeashError::DeniedAllowanceExceeded,
    );
    env.warp(DAY);
    env.pay(USDC).expect("the next period");
    assert_eq!(env.recurring_state(&env.delegation), (NOW + DAY, USDC));
    assert_eq!(env.token_balance(&env.merchant_ata), 6 * USDC);
}

#[test]
fn a_recurring_allowance_that_has_not_started_blocks_payments() {
    let mut env = Env::setup(Setup {
        allowance: Allowance::Recurring {
            amount_per_period: 5 * USDC,
            period_length_s: 86_400,
            start_ts: NOW + 3_600,
            expiry_ts: 0,
        },
        ..Setup::default()
    });
    denied(
        &mut env,
        To::Merchant,
        10_000,
        LeashError::DeniedAllowanceExceeded,
    );
    env.warp(3_600);
    env.pay(10_000).expect("started");
}

#[test]
fn a_fixed_allowance_is_spent_down_and_expires() {
    let mut env = Env::setup(Setup {
        allowance: Allowance::Fixed {
            amount: 2 * USDC,
            expiry_ts: NOW + 100,
        },
        merchant: Some(PayeeLimits {
            max_per_payment: 0,
            period_limit: 0,
            period_secs: 0,
        }),
        ..Setup::default()
    });
    env.pay(USDC).unwrap();
    assert_eq!(env.fixed_remaining(&env.delegation), USDC);
    denied(
        &mut env,
        To::Merchant,
        USDC + 1,
        LeashError::DeniedApprovalRequired,
    );
    env.pay(USDC).unwrap();
    assert_eq!(env.fixed_remaining(&env.delegation), 0);
    denied(
        &mut env,
        To::Merchant,
        1,
        LeashError::DeniedAllowanceExceeded,
    );
    env.warp(101); // expiry is inclusive: expired only after `expiry_ts`
    denied(
        &mut env,
        To::Merchant,
        1,
        LeashError::DeniedAllowanceExpired,
    );
}

#[test]
fn the_owners_balance_must_cover_the_payment() {
    let mut env = Env::setup(Setup {
        owner_usdc: 400_000,
        ..Setup::default()
    });
    denied(
        &mut env,
        To::Merchant,
        400_001,
        LeashError::DeniedInsufficientFunds,
    );
    env.pay(400_000).expect("exactly the balance");
    assert_eq!(env.token_balance(&env.owner_ata), 0);
}

#[test]
fn any_payee_mode_still_enforces_the_limits() {
    let mut env = Env::new();
    let owner = owner(&env);
    let policy = Policy {
        payee_mode: PayeeMode::AnyPayee,
        ..demo_policy()
    };
    env.update_policy_as(&owner, policy).unwrap();
    env.pay_to(env.attacker_ata, 10_000)
        .expect("any payee may be paid");
    assert_eq!(env.token_balance(&env.attacker_ata), 10_000);
    denied(
        &mut env,
        To::Attacker,
        USDC + 1,
        LeashError::DeniedApprovalRequired,
    );
    // A matching entry's own limits still apply.
    let limits = PayeeLimits {
        max_per_payment: 100_000,
        ..merchant_limits()
    };
    env.update_payee_as(&owner, env.merchant_entry, limits)
        .unwrap();
    denied(
        &mut env,
        To::Merchant,
        100_001,
        LeashError::DeniedExceedsPayeePaymentLimit,
    );
}
