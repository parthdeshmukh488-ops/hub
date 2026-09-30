//! The product invariants on the real program (03-security §3, 01-onchain-program §11.2):
//!
//! - I1: no sequence of payments moves more than the Subscriptions allowance (random sequences,
//!   recurring and fixed).
//! - I2: a payee off the allowlist never receives funds, whatever optional accounts are passed;
//!   reports never move money.
//! - I3: after a freeze every payment fails, and only the owner unfreezes.
//! - I4: strikes within the window freeze the agent; other denials never do.
//! - I5: every payment and every report is exactly one event.
//!
//! The random sequences use a seeded generator, so a failure reproduces from its seed.

mod common;

use std::collections::BTreeMap;

use anchor_lang::error::ErrorCode as AnchorError;
use common::*;
use leash::{
    errors::LeashError,
    events::{PaymentDenied, PaymentExecuted},
    state::{Agent, AgentStatus, FreezeReason, PayeeLimits, Policy},
};
use solana_signer::Signer;

/// xorshift64*: small, deterministic, good enough to explore sequences.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// No payee-specific limits: only the agent's policy and the allowance apply.
fn open_limits() -> PayeeLimits {
    PayeeLimits {
        max_per_payment: 0,
        period_limit: 0,
        period_secs: 0,
    }
}

/// Up to 2 USDC per payment, no rate limit, no approvals: the allowance is the only brake.
fn loose_policy() -> Policy {
    Policy {
        max_per_payment: 2 * USDC,
        max_per_request: 0,
        request_ttl_secs: 0,
        velocity_max_payments: 0,
        velocity_window_secs: 0,
        ..demo_policy()
    }
}

#[test]
fn i1_random_payments_never_exceed_a_recurring_allowance() {
    const PER_PERIOD: u64 = 5 * USDC;
    for seed in [1_u64, 7, 42, 2_026] {
        let mut env = Env::setup(Setup {
            policy: loose_policy(),
            merchant: Some(open_limits()),
            owner_usdc: 1_000 * USDC,
            ..Setup::default()
        });
        let mut rng = Rng(seed);
        let owner_start = env.token_balance(&env.owner_ata);
        let mut per_period: BTreeMap<i64, u64> = BTreeMap::new();
        let mut paid = 0_u64;
        for _ in 0..200 {
            match rng.below(8) {
                0 => env.warp(rng.below(2 * 86_400) as i64),
                1 | 2 => env.warp(rng.below(3_600) as i64),
                _ => {}
            }
            let amount = 1 + rng.below(2 * USDC);
            if env.pay(amount).is_ok() {
                paid += amount;
                let (period_start, _) = env.recurring_state(&env.delegation);
                *per_period.entry(period_start).or_default() += amount;
            }
            let (_, pulled) = env.recurring_state(&env.delegation);
            assert!(
                pulled <= PER_PERIOD,
                "seed {seed}: {pulled} pulled in one period"
            );
            assert_eq!(
                owner_start - env.token_balance(&env.owner_ata),
                paid,
                "seed {seed}"
            );
            assert_eq!(env.token_balance(&env.merchant_ata), paid, "seed {seed}");
        }
        assert!(
            per_period.values().all(|&sum| sum <= PER_PERIOD),
            "seed {seed}: {per_period:?}"
        );
        assert!(
            per_period.len() > 1,
            "seed {seed}: the sequence should cross periods"
        );
    }
}

#[test]
fn i1_random_payments_never_exceed_a_fixed_allowance() {
    const TOTAL: u64 = 7 * USDC;
    for seed in [3_u64, 99] {
        let mut env = Env::setup(Setup {
            policy: loose_policy(),
            merchant: Some(open_limits()),
            allowance: Allowance::Fixed {
                amount: TOTAL,
                expiry_ts: 0,
            },
            ..Setup::default()
        });
        let mut rng = Rng(seed);
        let mut paid = 0_u64;
        for _ in 0..60 {
            env.warp(rng.below(600) as i64);
            let amount = 1 + rng.below(2 * USDC);
            if env.pay(amount).is_ok() {
                paid += amount;
            }
            assert!(
                paid <= TOTAL,
                "seed {seed}: {paid} paid from a {TOTAL} allowance"
            );
            assert_eq!(
                env.fixed_remaining(&env.delegation),
                TOTAL - paid,
                "seed {seed}"
            );
        }
        assert!(
            TOTAL - paid < 2 * USDC,
            "seed {seed}: the allowance was mostly used"
        );
    }
}

#[test]
fn i2_a_payee_off_the_allowlist_never_receives_funds_whatever_accounts_are_passed() {
    let mut env = Env::new();
    // Another agent of the same owner has the attacker on its allowlist.
    let second_key = test_key("secondAgent");
    env.create_agent(second_key.pubkey(), demo_policy())
        .unwrap();
    let second = agent_pda(&env.principal, &second_key.pubkey());
    let attacker = env.attacker.pubkey();
    env.add_payee_for(second, attacker, merchant_limits())
        .unwrap();
    let foreign_entry = payee_pda(&second, &attacker);
    // And our agent holds an approved request for the merchant.
    let merchant = env.merchant.pubkey();
    env.request_payment(merchant, 2 * USDC, 1).unwrap();
    let request = request_pda(&env.agent, 0);
    let owner = env.owner.insecure_clone();
    env.approve_request_as(&owner, request).unwrap();

    let agent_key = env.agent_key.pubkey();
    for entry in [None, Some(env.merchant_entry), Some(foreign_entry)] {
        for attached in [None, Some(request)] {
            for amount in [1, USDC, 2 * USDC, 90 * USDC] {
                let accounts = leash::accounts::Pay {
                    payee_entry: entry,
                    request: attached,
                    request_rent_receiver: attached.map(|_| agent_key),
                    ..env.pay_accounts(env.attacker_ata)
                };
                let args = leash::PayArgs {
                    amount,
                    reference: reference(1),
                    memo: padded("A detailed market report"),
                };
                assert!(env.pay_with(accounts, args).is_err());
            }
        }
    }
    assert_eq!(env.token_balance(&env.attacker_ata), 0);
    assert!(
        env.exists(&request),
        "no failed attempt consumed the request"
    );
}

#[test]
fn i2_reports_never_move_money() {
    let mut env = Env::setup(Setup {
        policy: Policy {
            tripwire_max_strikes: 0,
            tripwire_window_secs: 0,
            ..demo_policy()
        },
        ..Setup::default()
    });
    let mut rng = Rng(5);
    let before = (
        env.token_balance(&env.owner_ata),
        env.token_balance(&env.merchant_ata),
        env.token_balance(&env.attacker_ata),
        env.data(&env.delegation),
    );
    let (merchant, attacker) = (env.merchant_ata, env.attacker_ata);
    let mut reported = 0;
    for _ in 0..40 {
        let destination = if rng.below(2) == 0 {
            merchant
        } else {
            attacker
        };
        if env.report_to(destination, 1 + rng.below(20 * USDC)).is_ok() {
            reported += 1;
        }
    }
    assert!(reported > 10);
    let after = (
        env.token_balance(&env.owner_ata),
        env.token_balance(&env.merchant_ata),
        env.token_balance(&env.attacker_ata),
        env.data(&env.delegation),
    );
    assert!(after == before);
}

#[test]
fn i3_after_a_freeze_every_payment_fails_and_only_the_owner_unfreezes() {
    for freeze_everything in [false, true] {
        let mut env = Env::new();
        let merchant = env.merchant.pubkey();
        env.request_payment(merchant, 2 * USDC, 1).unwrap();
        let request = request_pda(&env.agent, 0);
        let owner = env.owner.insecure_clone();
        env.approve_request_as(&owner, request).unwrap();

        let guardian = env.guardian.insecure_clone();
        let expected = if freeze_everything {
            env.freeze_principal_as(&guardian).unwrap();
            LeashError::DeniedPrincipalFrozen
        } else {
            env.freeze_agent_as(&guardian).unwrap();
            LeashError::DeniedAgentFrozen
        };
        for amount in [1, 10_000, USDC] {
            expect_error(env.pay(amount), code(expected));
        }
        expect_error(env.pay_with_request(request, 2 * USDC, 1), code(expected));

        for key in [
            env.guardian.insecure_clone(),
            env.agent_key.insecure_clone(),
        ] {
            let result = if freeze_everything {
                env.unfreeze_principal_as(&key)
            } else {
                env.unfreeze_agent_as(&key)
            };
            expect_error(result, anchor_code(AnchorError::ConstraintSeeds));
        }
        assert_eq!(env.token_balance(&env.merchant_ata), 0);

        if freeze_everything {
            env.unfreeze_principal_as(&owner).unwrap();
        } else {
            env.unfreeze_agent_as(&owner).unwrap();
        }
        env.pay(10_000).expect("the owner switched it back on");
    }
}

#[test]
fn i4_strikes_within_the_window_freeze_and_other_denials_never_do() {
    let mut env = Env::setup(Setup {
        policy: Policy {
            tripwire_max_strikes: 5,
            tripwire_window_secs: 3_600,
            ..demo_policy()
        },
        ..Setup::default()
    });
    let (merchant, attacker) = (env.merchant_ata, env.attacker_ata);
    // Ten non-strike denials in a row: never a freeze.
    for _ in 0..10 {
        env.report_to(merchant, 2 * USDC).unwrap();
    }
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.status, agent.stats.strikes),
        (AgentStatus::Active, 0)
    );
    // Four strikes: still active. The fifth freezes.
    for strikes in 1..=4_u8 {
        let sent = env.report_to(attacker, USDC).unwrap();
        assert_eq!(sent.events::<PaymentDenied>()[0].strikes, strikes);
    }
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.status, AgentStatus::Active);
    let sent = env.report_to(attacker, USDC).unwrap();
    assert!(sent.events::<PaymentDenied>()[0].tripped);
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.status, agent.freeze_reason),
        (AgentStatus::Frozen, FreezeReason::Tripwire)
    );
}

#[test]
fn i5_one_event_per_payment_and_per_report() {
    let mut env = Env::new();
    let attacker = env.attacker_ata;
    for _ in 0..4 {
        let sent = env.pay(10_000).unwrap();
        assert_eq!(sent.events::<PaymentExecuted>().len(), 1);
        assert!(sent.events::<PaymentDenied>().is_empty());
        assert_eq!(sent.transfers_checked(), 1);
    }
    for _ in 0..2 {
        let sent = env.report_to(attacker, USDC).unwrap();
        assert_eq!(sent.events::<PaymentDenied>().len(), 1);
        assert!(sent.events::<PaymentExecuted>().is_empty());
        assert_eq!(sent.transfers_checked(), 0);
    }
    let agent: Agent = env.read(&env.agent);
    assert_eq!(
        (agent.stats.payments_count, agent.stats.denied_count),
        (4, 2)
    );
}
