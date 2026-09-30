//! `report_denied_attempt` and the tripwire on the real program (01-onchain-program §6.2,
//! ADR-0002): strike and non-strike reasons, window roll-over, the on-chain freeze, and why an
//! allowed payment can never be reported (T7).

mod common;

use anchor_lang::error::ErrorCode as AnchorError;
use common::*;
use leash::{
    errors::LeashError,
    events::{AgentFrozen, PaymentDenied},
    state::{Agent, AgentStatus, DenialReason, FreezeReason, Policy},
};
use solana_signer::Signer;

fn balances(env: &Env) -> (u64, u64, u64) {
    (
        env.token_balance(&env.owner_ata),
        env.token_balance(&env.merchant_ata),
        env.token_balance(&env.attacker_ata),
    )
}

#[test]
fn a_blocked_payment_to_a_stranger_becomes_an_on_chain_strike() {
    let mut env = Env::new();
    let attacker = env.attacker_ata;
    let sent = env.report_to(attacker, 25 * USDC).unwrap();

    let denied = sent.events::<PaymentDenied>();
    assert_eq!(denied.len(), 1);
    let event = &denied[0];
    assert_eq!(
        (event.principal, event.agent, event.payee, event.destination),
        (env.principal, env.agent, env.attacker.pubkey(), attacker)
    );
    assert_eq!(
        (event.amount, event.reason),
        (25 * USDC, DenialReason::PayeeNotAllowed)
    );
    assert_eq!(
        (event.strikes, event.tripped, event.timestamp),
        (1, false, NOW)
    );
    assert_eq!(
        (event.reference, event.memo),
        (reference(2), padded("Premium research report"))
    );
    assert!(sent.events::<AgentFrozen>().is_empty());

    let agent: Agent = env.read(&env.agent);
    assert_eq!((agent.stats.denied_count, agent.stats.strikes), (1, 1));
    assert_eq!(
        (agent.stats.strike_window_start, agent.status),
        (NOW, AgentStatus::Active)
    );
    assert_eq!(env.token_balance(&attacker), 0);
}

#[test]
fn three_strikes_freeze_the_agent_on_chain() {
    let mut env = Env::new();
    let attacker = env.attacker_ata;
    env.report_to(attacker, USDC).unwrap();
    env.warp(10);
    env.report_to(attacker, USDC).unwrap();
    env.warp(10);
    let sent = env.report_to(attacker, USDC).unwrap();

    let denied = sent.events::<PaymentDenied>();
    assert_eq!((denied[0].strikes, denied[0].tripped), (3, true));
    let frozen = sent.events::<AgentFrozen>();
    assert_eq!(frozen.len(), 1);
    assert_eq!(
        (
            frozen[0].agent,
            frozen[0].reason,
            frozen[0].by,
            frozen[0].timestamp
        ),
        (
            env.agent,
            FreezeReason::Tripwire,
            env.agent_key.pubkey(),
            NOW + 20
        )
    );
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.status, agent.freeze_reason, agent.frozen_at),
        (AgentStatus::Frozen, FreezeReason::Tripwire, NOW + 20)
    );

    // The agent stopped itself: even the allowlisted merchant can't be paid now.
    expect_error(env.pay(10_000), code(LeashError::DeniedAgentFrozen));
    // Later attempts are recorded as "agent frozen", which is not a strike.
    let sent = env.report_to(attacker, USDC).unwrap();
    assert_eq!(
        sent.events::<PaymentDenied>()[0].reason,
        DenialReason::AgentFrozen
    );
    assert!(sent.events::<AgentFrozen>().is_empty());
    let agent: Agent = env.read(&env.agent);
    assert_eq!((agent.stats.denied_count, agent.stats.strikes), (4, 3));
}

#[test]
fn every_strike_reason_counts() {
    let mut env = Env::new();
    let (attacker, merchant) = (env.attacker_ata, env.merchant_ata);
    // Not allowlisted, above the approval bound, above the payee's own cap.
    let owner = env.owner.insecure_clone();
    let limits = leash::state::PayeeLimits {
        max_per_payment: 500_000,
        ..merchant_limits()
    };
    env.update_payee_as(&owner, env.merchant_entry, limits)
        .unwrap();
    let reasons = [
        (attacker, USDC, DenialReason::PayeeNotAllowed),
        (merchant, 6 * USDC, DenialReason::ExceedsPaymentLimit),
        (merchant, 600_000, DenialReason::ExceedsPayeePaymentLimit),
    ];
    for (i, (destination, amount, reason)) in reasons.into_iter().enumerate() {
        let sent = env.report_to(destination, amount).unwrap();
        let event = &sent.events::<PaymentDenied>()[0];
        assert_eq!((event.reason, usize::from(event.strikes)), (reason, i + 1));
    }
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.status, agent.freeze_reason),
        (AgentStatus::Frozen, FreezeReason::Tripwire)
    );
}

#[test]
fn other_denials_are_recorded_but_never_trip_the_wire() {
    let mut env = Env::new();
    let merchant = env.merchant_ata;
    // Approval required, and (after three payments) the payee's budget used up.
    for _ in 0..4 {
        let sent = env.report_to(merchant, 2 * USDC).unwrap();
        assert_eq!(
            sent.events::<PaymentDenied>()[0].reason,
            DenialReason::ApprovalRequired
        );
    }
    for _ in 0..3 {
        env.pay(USDC).unwrap();
    }
    let sent = env.report_to(merchant, USDC).unwrap();
    assert_eq!(
        sent.events::<PaymentDenied>()[0].reason,
        DenialReason::ExceedsPayeePeriodLimit
    );
    let agent: Agent = env.read(&env.agent);
    assert_eq!((agent.stats.denied_count, agent.stats.strikes), (5, 0));
    assert_eq!(agent.status, AgentStatus::Active);
}

#[test]
fn strikes_expire_with_their_window() {
    let mut env = Env::new();
    let attacker = env.attacker_ata;
    env.report_to(attacker, USDC).unwrap();
    env.report_to(attacker, USDC).unwrap();
    env.warp(600); // the 10-minute window ended
    let sent = env.report_to(attacker, USDC).unwrap();
    let event = &sent.events::<PaymentDenied>()[0];
    assert_eq!((event.strikes, event.tripped), (1, false));
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.stats.strikes, agent.stats.strike_window_start),
        (1, NOW + 600)
    );
    assert_eq!(agent.status, AgentStatus::Active);
}

#[test]
fn an_allowed_payment_cannot_be_reported() {
    let mut env = Env::new();
    let merchant = env.merchant_ata;
    let before = (balances(&env), env.data(&env.agent));
    expect_error(
        env.report_to(merchant, 10_000),
        code(LeashError::AttemptWouldSucceed),
    );
    assert!((balances(&env), env.data(&env.agent)) == before);
}

#[test]
fn only_the_agent_key_can_report() {
    let mut env = Env::new();
    let stranger = env.stranger.insecure_clone();
    let accounts = leash::accounts::ReportDeniedAttempt {
        agent_key: stranger.pubkey(),
        ..env.report_accounts(env.attacker_ata)
    };
    let ix = leash_ix(
        accounts,
        leash::instruction::ReportDeniedAttempt {
            args: Env::pay_args(USDC, 3),
        },
    );
    expect_error(
        env.send(ix, &[&stranger]),
        anchor_code(AnchorError::ConstraintSeeds),
    );
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.stats.denied_count, 0);
}

#[test]
fn account_errors_are_not_denials_and_are_not_recorded() {
    let mut env = Env::new();
    let accounts = leash::accounts::ReportDeniedAttempt {
        source_token_account: env.merchant_ata,
        ..env.report_accounts(env.attacker_ata)
    };
    expect_error(
        env.report_with(accounts, Env::pay_args(USDC, 3)),
        code(LeashError::DelegationMismatch),
    );
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.stats.denied_count, 0);
}

#[test]
fn the_tripwire_can_be_switched_off() {
    let mut env = Env::new();
    let owner = env.owner.insecure_clone();
    let policy = Policy {
        tripwire_max_strikes: 0,
        tripwire_window_secs: 0,
        ..demo_policy()
    };
    env.update_policy_as(&owner, policy).unwrap();
    let attacker = env.attacker_ata;
    for _ in 0..5 {
        let sent = env.report_to(attacker, USDC).unwrap();
        let event = &sent.events::<PaymentDenied>()[0];
        assert_eq!((event.strikes, event.tripped), (0, false));
    }
    let agent: Agent = env.read(&env.agent);
    assert_eq!((agent.stats.denied_count, agent.stats.strikes), (5, 0));
    assert_eq!(agent.status, AgentStatus::Active);
}

#[test]
fn reports_never_move_money() {
    let mut env = Env::new();
    let before = balances(&env);
    let delegation = env.data(&env.delegation);
    let (attacker, merchant) = (env.attacker_ata, env.merchant_ata);
    for (destination, amount) in [
        (attacker, USDC),
        (merchant, 2 * USDC),
        (attacker, 99 * USDC),
    ] {
        env.report_to(destination, amount).unwrap();
    }
    assert_eq!(balances(&env), before);
    assert!(env.data(&env.delegation) == delegation);
}
