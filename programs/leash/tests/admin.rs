//! Owner and guardian instructions on the real program (01-onchain-program §6.1): the
//! authorization matrix (owner ✓; guardian only for freezes and rejections; anyone else ✗),
//! idempotent switches that emit only on change, and every validation rule.

mod common;

use anchor_lang::{error::ErrorCode as AnchorError, prelude::Pubkey};
use common::*;
use leash::{
    errors::LeashError,
    events::{
        AgentClosed, AgentCreated, AgentFrozen, AgentUnfrozen, GuardianChanged, PayeeAdded,
        PayeeRemoved, PayeeUpdated, PolicyUpdated, PrincipalFrozen, PrincipalUnfrozen,
    },
    state::{Agent, AgentStatus, FreezeReason, Payee, PayeeLimits, Policy, Principal},
};
use solana_keypair::Keypair;
use solana_signer::Signer;

/// Owner-only instructions derive the principal from the signer, so anyone else fails the seeds.
fn not_the_owner() -> u32 {
    anchor_code(AnchorError::ConstraintSeeds)
}

fn clone(key: &Keypair) -> Keypair {
    key.insecure_clone()
}

#[test]
fn setup_writes_the_principal_the_agent_and_the_allowlist_entry() {
    let env = Env::new();
    let principal: Principal = env.read(&env.principal);
    assert_eq!(principal.version, 1);
    assert_eq!(
        (principal.owner, principal.guardian),
        (env.owner.pubkey(), env.guardian.pubkey())
    );
    assert_eq!(
        (
            principal.frozen,
            principal.agent_count,
            principal.created_at
        ),
        (false, 1, NOW)
    );

    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.principal, agent.owner),
        (env.principal, env.owner.pubkey())
    );
    assert_eq!(
        (agent.agent_key, agent.mint),
        (env.agent_key.pubkey(), env.mint)
    );
    assert_eq!(
        (agent.status, agent.freeze_reason),
        (AgentStatus::Active, FreezeReason::None)
    );
    assert_eq!((agent.payee_count, agent.open_requests), (1, 0));
    assert_eq!(agent.label, padded("Research agent"));
    assert_eq!(agent.policy, demo_policy());

    let entry: Payee = env.read(&env.merchant_entry);
    assert_eq!(
        (entry.agent, entry.payee),
        (env.agent, env.merchant.pubkey())
    );
    assert_eq!(entry.limits(), merchant_limits());
    assert_eq!(
        (
            entry.spent_in_period,
            entry.total_paid,
            entry.payments_count
        ),
        (0, 0, 0)
    );
}

#[test]
fn a_principal_is_created_once() {
    let mut env = Env::new();
    assert!(env.initialize_principal(None).is_err());
}

#[test]
fn the_owner_and_the_guardian_freeze_an_agent_and_nobody_else_can() {
    let mut env = Env::new();
    for key in [clone(&env.stranger), clone(&env.agent_key)] {
        expect_error(env.freeze_agent_as(&key), code(LeashError::Unauthorized));
    }
    let guardian = clone(&env.guardian);
    let sent = env.freeze_agent_as(&guardian).unwrap();
    let frozen = sent.events::<AgentFrozen>();
    assert_eq!(frozen.len(), 1);
    assert_eq!(
        (
            frozen[0].agent,
            frozen[0].reason,
            frozen[0].by,
            frozen[0].timestamp
        ),
        (env.agent, FreezeReason::Guardian, guardian.pubkey(), NOW)
    );
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.status, agent.freeze_reason, agent.frozen_at),
        (AgentStatus::Frozen, FreezeReason::Guardian, NOW)
    );

    // Idempotent: a second freeze changes nothing and says nothing; the first reason stays.
    let owner = clone(&env.owner);
    let again = env.freeze_agent_as(&owner).unwrap();
    assert!(again.events::<AgentFrozen>().is_empty());
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.freeze_reason, FreezeReason::Guardian);
}

#[test]
fn only_the_owner_unfreezes_an_agent_which_clears_its_strikes() {
    let mut env = Env::new();
    let attacker = env.attacker_ata;
    env.report_to(attacker, USDC).unwrap();
    env.report_to(attacker, USDC).unwrap();
    let guardian = clone(&env.guardian);
    env.freeze_agent_as(&guardian).unwrap();

    for key in [
        clone(&env.guardian),
        clone(&env.stranger),
        clone(&env.agent_key),
    ] {
        expect_error(env.unfreeze_agent_as(&key), not_the_owner());
    }
    let owner = clone(&env.owner);
    let sent = env.unfreeze_agent_as(&owner).unwrap();
    assert_eq!(sent.events::<AgentUnfrozen>().len(), 1);
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.status, agent.freeze_reason, agent.frozen_at),
        (AgentStatus::Active, FreezeReason::None, 0)
    );
    assert_eq!(
        (agent.stats.strikes, agent.stats.strike_window_start),
        (0, 0)
    );
    assert_eq!(agent.stats.denied_count, 2, "the audit trail is kept");

    // Unfreezing an active agent is a no-op.
    assert!(env
        .unfreeze_agent_as(&owner)
        .unwrap()
        .events::<AgentUnfrozen>()
        .is_empty());
}

#[test]
fn the_global_switch_is_owner_or_guardian_to_pull_and_owner_to_release() {
    let mut env = Env::new();
    let stranger = clone(&env.stranger);
    expect_error(
        env.freeze_principal_as(&stranger),
        code(LeashError::Unauthorized),
    );

    let guardian = clone(&env.guardian);
    let sent = env.freeze_principal_as(&guardian).unwrap();
    let frozen = sent.events::<PrincipalFrozen>();
    assert_eq!(frozen.len(), 1);
    assert_eq!(
        (frozen[0].principal, frozen[0].by),
        (env.principal, guardian.pubkey())
    );
    let principal: Principal = env.read(&env.principal);
    assert_eq!(
        (principal.frozen, principal.frozen_at, principal.frozen_by),
        (true, NOW, guardian.pubkey())
    );
    let owner = clone(&env.owner);
    assert!(env
        .freeze_principal_as(&owner)
        .unwrap()
        .events::<PrincipalFrozen>()
        .is_empty());

    expect_error(env.unfreeze_principal_as(&guardian), not_the_owner());
    let sent = env.unfreeze_principal_as(&owner).unwrap();
    assert_eq!(sent.events::<PrincipalUnfrozen>().len(), 1);
    let principal: Principal = env.read(&env.principal);
    assert_eq!(
        (principal.frozen, principal.frozen_at, principal.frozen_by),
        (false, 0, Pubkey::default())
    );
    assert!(env
        .unfreeze_principal_as(&owner)
        .unwrap()
        .events::<PrincipalUnfrozen>()
        .is_empty());
}

#[test]
fn owner_only_instructions_refuse_everyone_else() {
    let mut env = Env::new();
    let entry = env.merchant_entry;
    for key in [
        clone(&env.guardian),
        clone(&env.stranger),
        clone(&env.agent_key),
    ] {
        expect_error(env.set_guardian_as(&key, None), not_the_owner());
        expect_error(env.update_policy_as(&key, demo_policy()), not_the_owner());
        expect_error(
            env.update_payee_as(&key, entry, merchant_limits()),
            not_the_owner(),
        );
        expect_error(env.remove_payee_as(&key, entry), not_the_owner());
        expect_error(env.close_agent_as(&key), not_the_owner());
        expect_error(env.unfreeze_principal_as(&key), not_the_owner());
        let ix = leash_ix(
            leash::accounts::AddPayee {
                owner: key.pubkey(),
                principal: env.principal,
                agent: env.agent,
                payee_entry: payee_pda(&env.agent, &key.pubkey()),
                system_program: anchor_lang::solana_program::system_program::ID,
                event_authority: event_authority(),
                program: leash::ID,
            },
            leash::instruction::AddPayee {
                payee: key.pubkey(),
                label: padded("mine"),
                limits: merchant_limits(),
            },
        );
        expect_error(env.send(ix, &[&key]), not_the_owner());
    }
    // Nothing changed.
    let agent: Agent = env.read(&env.agent);
    assert_eq!((agent.payee_count, agent.policy), (1, demo_policy()));
}

#[test]
fn create_agent_checks_the_key_and_the_policy() {
    let mut env = Env::new();
    let owner_key = env.owner.pubkey();
    expect_error(
        env.create_agent(owner_key, demo_policy()),
        code(LeashError::InvalidAgentKey),
    );

    let second = test_key("secondAgent").pubkey();
    let invalid = [
        Policy {
            max_per_payment: 0,
            ..demo_policy()
        },
        Policy {
            max_per_request: USDC,
            ..demo_policy()
        },
        Policy {
            velocity_window_secs: 0,
            ..demo_policy()
        },
        Policy {
            tripwire_window_secs: 0,
            ..demo_policy()
        },
        Policy {
            request_ttl_secs: 604_801,
            ..demo_policy()
        },
        Policy {
            valid_until: NOW,
            ..demo_policy()
        },
    ];
    for policy in invalid {
        expect_error(
            env.create_agent(second, policy),
            code(LeashError::InvalidPolicy),
        );
    }

    let sent = env.create_agent(second, demo_policy()).unwrap();
    let created = sent.events::<AgentCreated>();
    assert_eq!(created.len(), 1);
    assert_eq!(
        (created[0].principal, created[0].agent_key, created[0].mint),
        (env.principal, second, env.mint)
    );
    assert_eq!(created[0].policy, demo_policy());
    let principal: Principal = env.read(&env.principal);
    assert_eq!(principal.agent_count, 2);
}

#[test]
fn add_payee_refuses_the_agent_itself_and_broken_limits() {
    let mut env = Env::new();
    let (agent_key, agent_pda) = (env.agent_key.pubkey(), env.agent);
    expect_error(
        env.add_payee(agent_key, merchant_limits()),
        code(LeashError::InvalidPayee),
    );
    expect_error(
        env.add_payee(agent_pda, merchant_limits()),
        code(LeashError::InvalidPayee),
    );
    let attacker = env.attacker.pubkey();
    let broken = PayeeLimits {
        max_per_payment: 0,
        period_limit: 1,
        period_secs: 0,
    };
    expect_error(
        env.add_payee(attacker, broken),
        code(LeashError::InvalidPolicy),
    );

    let sent = env.add_payee(attacker, merchant_limits()).unwrap();
    let added = sent.events::<PayeeAdded>();
    assert_eq!(added.len(), 1);
    assert_eq!((added[0].agent, added[0].payee), (env.agent, attacker));
    assert_eq!(added[0].limits, merchant_limits());
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.payee_count, 2);
    // The same payee twice is impossible: the entry's address is taken.
    assert!(env.add_payee(attacker, merchant_limits()).is_err());
}

#[test]
fn update_payee_replaces_label_and_limits_but_keeps_the_counters() {
    let mut env = Env::new();
    env.pay(USDC).unwrap();
    let owner = clone(&env.owner);
    let limits = PayeeLimits {
        max_per_payment: 700_000,
        period_limit: 10 * USDC,
        period_secs: 3_600,
    };
    let sent = env
        .update_payee_as(&owner, env.merchant_entry, limits)
        .unwrap();
    assert_eq!(sent.events::<PayeeUpdated>().len(), 1);
    let entry: Payee = env.read(&env.merchant_entry);
    assert_eq!(entry.limits(), limits);
    assert_eq!(entry.label, padded("Research API, updated"));
    assert_eq!(
        (
            entry.period_start,
            entry.spent_in_period,
            entry.total_paid,
            entry.payments_count
        ),
        (NOW, USDC, USDC, 1)
    );
    let broken = PayeeLimits {
        period_secs: 0,
        ..limits
    };
    expect_error(
        env.update_payee_as(&owner, env.merchant_entry, broken),
        code(LeashError::InvalidPolicy),
    );
}

#[test]
fn removing_the_last_payee_refunds_the_rent_and_then_the_agent_can_close() {
    let mut env = Env::new();
    let owner = clone(&env.owner);
    expect_error(env.close_agent_as(&owner), code(LeashError::AgentNotEmpty));

    let rent = env.lamports(&env.merchant_entry);
    let before = env.lamports(&owner.pubkey());
    let sent = env.remove_payee_as(&owner, env.merchant_entry).unwrap();
    assert_eq!(sent.events::<PayeeRemoved>().len(), 1);
    assert!(!env.exists(&env.merchant_entry));
    assert_eq!(env.lamports(&owner.pubkey()), before + rent - sent.meta.fee);
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.payee_count, 0);

    let rent = env.lamports(&env.agent);
    let before = env.lamports(&owner.pubkey());
    let sent = env.close_agent_as(&owner).unwrap();
    let closed = sent.events::<AgentClosed>();
    assert_eq!(closed.len(), 1);
    assert_eq!(
        (closed[0].principal, closed[0].agent),
        (env.principal, env.agent)
    );
    assert!(!env.exists(&env.agent));
    assert_eq!(env.lamports(&owner.pubkey()), before + rent - sent.meta.fee);
    let principal: Principal = env.read(&env.principal);
    assert_eq!(principal.agent_count, 0);
}

#[test]
fn an_open_request_keeps_the_agent_open() {
    let mut env = Env::new();
    let merchant = env.merchant.pubkey();
    env.request_payment(merchant, 2 * USDC, 1).unwrap();
    let owner = clone(&env.owner);
    env.remove_payee_as(&owner, env.merchant_entry).unwrap();
    expect_error(env.close_agent_as(&owner), code(LeashError::AgentNotEmpty));
}

#[test]
fn the_guardian_can_be_replaced_and_removed() {
    let mut env = Env::new();
    let owner = clone(&env.owner);
    let (old, new) = (clone(&env.guardian), clone(&env.stranger));

    let sent = env.set_guardian_as(&owner, Some(new.pubkey())).unwrap();
    let changed = sent.events::<GuardianChanged>();
    assert_eq!(changed.len(), 1);
    assert_eq!(
        (changed[0].principal, changed[0].guardian),
        (env.principal, Some(new.pubkey()))
    );
    env.freeze_agent_as(&new)
        .expect("the new guardian can freeze");
    expect_error(
        env.freeze_principal_as(&old),
        code(LeashError::Unauthorized),
    );

    env.set_guardian_as(&owner, None).unwrap();
    let principal: Principal = env.read(&env.principal);
    assert_eq!(principal.guardian, Pubkey::default());
    expect_error(
        env.freeze_principal_as(&new),
        code(LeashError::Unauthorized),
    );

    // Passing the default key means "no guardian" too.
    let sent = env
        .set_guardian_as(&owner, Some(Pubkey::default()))
        .unwrap();
    assert_eq!(sent.events::<GuardianChanged>()[0].guardian, None);
}

#[test]
fn update_policy_validates_the_rules_and_keeps_the_counters() {
    let mut env = Env::new();
    env.pay(USDC).unwrap();
    let owner = clone(&env.owner);
    let expired = Policy {
        valid_until: NOW,
        ..demo_policy()
    };
    expect_error(
        env.update_policy_as(&owner, expired),
        code(LeashError::InvalidPolicy),
    );

    let policy = Policy {
        max_per_payment: 2 * USDC,
        ..demo_policy()
    };
    let sent = env.update_policy_as(&owner, policy).unwrap();
    let updated = sent.events::<PolicyUpdated>();
    assert_eq!(updated.len(), 1);
    assert_eq!((updated[0].agent, updated[0].policy), (env.agent, policy));
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.policy, policy);
    assert_eq!(
        (agent.stats.payments_count, agent.stats.velocity_count),
        (1, 1)
    );
}
