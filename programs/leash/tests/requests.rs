//! Payment requests on the real program (01-onchain-program §6.1–§6.3, overview §5.5): create,
//! approve, reject, expire, and pay with an approved request; every check and mismatch.

mod common;

use anchor_lang::error::ErrorCode as AnchorError;
use common::*;
use leash::{
    errors::LeashError,
    events::{PaymentExecuted, PaymentRequested, RequestApproved, RequestExpired, RequestRejected},
    state::{Agent, Payee, PaymentRequest, Policy, RequestStatus},
};
use solana_signer::Signer;

const AMOUNT: u64 = 2_500_000;
const TTL: i64 = 3_600;

/// Creates request `n` (to the merchant, `AMOUNT`) and returns its address.
fn request(env: &mut Env, n: u8) -> anchor_lang::prelude::Pubkey {
    let agent: Agent = env.read(&env.agent);
    let address = request_pda(&env.agent, agent.stats.request_nonce);
    let merchant = env.merchant.pubkey();
    env.request_payment(merchant, AMOUNT, n).unwrap();
    address
}

fn approve(env: &mut Env, request: anchor_lang::prelude::Pubkey) {
    let owner = env.owner.insecure_clone();
    env.approve_request_as(&owner, request).unwrap();
}

#[test]
fn the_owner_approves_a_larger_payment_and_the_agent_pays_it_once() {
    let mut env = Env::new();
    let merchant = env.merchant.pubkey();
    let sent = env.request_payment(merchant, AMOUNT, 7).unwrap();
    let address = request_pda(&env.agent, 0);

    let requested = sent.events::<PaymentRequested>();
    assert_eq!(requested.len(), 1);
    let event = &requested[0];
    assert_eq!(
        (event.agent, event.request, event.nonce),
        (env.agent, address, 0)
    );
    assert_eq!(
        (event.payee, event.amount, event.reference),
        (merchant, AMOUNT, reference(7))
    );
    assert_eq!(
        (event.expires_at, event.memo),
        (NOW + TTL, padded("A detailed market report"))
    );
    let stored: PaymentRequest = env.read(&address);
    assert_eq!(
        (stored.status, stored.rent_payer),
        (RequestStatus::Pending, env.agent_key.pubkey())
    );
    assert_eq!(
        (stored.created_at, stored.expires_at, stored.approved_at),
        (NOW, NOW + TTL, 0)
    );
    let agent: Agent = env.read(&env.agent);
    assert_eq!((agent.open_requests, agent.stats.request_nonce), (1, 1));

    // Not approved yet.
    expect_error(
        env.pay_with_request(address, AMOUNT, 7),
        code(LeashError::RequestNotApproved),
    );

    let owner = env.owner.insecure_clone();
    env.warp(60);
    let sent = env.approve_request_as(&owner, address).unwrap();
    let approved = sent.events::<RequestApproved>();
    assert_eq!((approved.len(), approved[0].nonce), (1, 0));
    let stored: PaymentRequest = env.read(&address);
    assert_eq!(
        (stored.status, stored.approved_at),
        (RequestStatus::Approved, NOW + 60)
    );

    let rent = env.lamports(&address);
    let agent_key = env.agent_key.pubkey();
    let before = env.lamports(&agent_key);
    let sent = env.pay_with_request(address, AMOUNT, 7).unwrap();
    assert_eq!(env.token_balance(&env.merchant_ata), AMOUNT);
    assert_eq!(sent.events::<PaymentExecuted>()[0].request_nonce, Some(0));
    // The request is consumed: closed, and its rent is back with the agent key (which paid the fee).
    assert!(!env.exists(&address));
    assert_eq!(env.lamports(&agent_key), before + rent - sent.meta.fee);
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.open_requests, 0);
    // The payee's caps were waived, but the spend still counts (ADR 20260929-ws0-disabled-limits).
    let entry: Payee = env.read(&env.merchant_entry);
    assert_eq!(entry.spent_in_period, AMOUNT);

    // It cannot be used twice.
    assert!(env.pay_with_request(address, AMOUNT, 7).is_err());
    assert_eq!(env.token_balance(&env.merchant_ata), AMOUNT);
}

#[test]
fn a_request_passes_its_checks_in_order() {
    let mut env = Env::new();
    let (merchant, attacker) = (env.merchant.pubkey(), env.attacker.pubkey());
    let owner = env.owner.insecure_clone();

    // 3–5: needed, within the approval bound, allowlisted.
    expect_error(
        env.request_payment(merchant, USDC, 1),
        code(LeashError::ApprovalNotNeeded),
    );
    expect_error(
        env.request_payment(merchant, 5 * USDC + 1, 1),
        code(LeashError::DeniedExceedsPaymentLimit),
    );
    expect_error(
        env.request_payment(attacker, AMOUNT, 1),
        code(LeashError::DeniedPayeeNotAllowed),
    );

    // 2: approvals switched off.
    let off = Policy {
        max_per_request: 0,
        ..demo_policy()
    };
    env.update_policy_as(&owner, off).unwrap();
    expect_error(
        env.request_payment(merchant, AMOUNT, 1),
        code(LeashError::ApprovalsDisabled),
    );

    // 1: freezes and expiry come first.
    let expiring = Policy {
        valid_until: NOW + 10,
        ..demo_policy()
    };
    env.update_policy_as(&owner, expiring).unwrap();
    let guardian = env.guardian.insecure_clone();
    env.freeze_agent_as(&guardian).unwrap();
    expect_error(
        env.request_payment(merchant, AMOUNT, 1),
        code(LeashError::DeniedAgentFrozen),
    );
    env.freeze_principal_as(&guardian).unwrap();
    expect_error(
        env.request_payment(merchant, AMOUNT, 1),
        code(LeashError::DeniedPrincipalFrozen),
    );
    env.unfreeze_principal_as(&owner).unwrap();
    env.unfreeze_agent_as(&owner).unwrap();
    env.warp(10);
    expect_error(
        env.request_payment(merchant, AMOUNT, 1),
        code(LeashError::DeniedAgentExpired),
    );

    let agent: Agent = env.read(&env.agent);
    assert_eq!((agent.open_requests, agent.stats.request_nonce), (0, 0));
}

#[test]
fn at_most_eight_requests_are_open_at_once() {
    let mut env = Env::new();
    let addresses: Vec<_> = (0..8).map(|n| request(&mut env, n)).collect();
    let merchant = env.merchant.pubkey();
    expect_error(
        env.request_payment(merchant, AMOUNT, 8),
        code(LeashError::TooManyOpenRequests),
    );

    // Rejecting one frees a slot.
    let owner = env.owner.insecure_clone();
    let agent_key = env.agent_key.pubkey();
    env.reject_request_as(&owner, addresses[0], agent_key)
        .unwrap();
    env.request_payment(merchant, AMOUNT, 8)
        .expect("a free slot");
    let agent: Agent = env.read(&env.agent);
    assert_eq!((agent.open_requests, agent.stats.request_nonce), (8, 9));
}

#[test]
fn only_the_owner_approves_and_only_a_pending_live_request() {
    let mut env = Env::new();
    let address = request(&mut env, 1);
    for key in [
        env.guardian.insecure_clone(),
        env.stranger.insecure_clone(),
        env.agent_key.insecure_clone(),
    ] {
        expect_error(
            env.approve_request_as(&key, address),
            anchor_code(AnchorError::ConstraintSeeds),
        );
    }
    approve(&mut env, address);
    let owner = env.owner.insecure_clone();
    expect_error(
        env.approve_request_as(&owner, address),
        code(LeashError::RequestNotPending),
    );

    let late = request(&mut env, 2);
    env.warp(TTL); // requests expire at `expires_at` (exclusive)
    expect_error(
        env.approve_request_as(&owner, late),
        code(LeashError::RequestExpired),
    );
}

#[test]
fn the_owner_or_the_guardian_rejects_and_the_rent_goes_back() {
    let mut env = Env::new();
    let address = request(&mut env, 1);
    let stranger = env.stranger.insecure_clone();
    let agent_key = env.agent_key.pubkey();
    expect_error(
        env.reject_request_as(&stranger, address, agent_key),
        code(LeashError::Unauthorized),
    );
    let guardian = env.guardian.insecure_clone();
    let owner_key = env.owner.pubkey();
    expect_error(
        env.reject_request_as(&guardian, address, owner_key),
        code(LeashError::RequestMismatch),
    );

    let rent = env.lamports(&address);
    let before = env.lamports(&agent_key);
    let sent = env
        .reject_request_as(&guardian, address, agent_key)
        .unwrap();
    let rejected = sent.events::<RequestRejected>();
    assert_eq!(rejected.len(), 1);
    assert_eq!(
        (rejected[0].request, rejected[0].nonce, rejected[0].by),
        (address, 0, guardian.pubkey())
    );
    assert!(!env.exists(&address));
    assert_eq!(env.lamports(&agent_key), before + rent);
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.open_requests, 0);

    // An approved request can still be rejected, by the owner too.
    let approved = request(&mut env, 2);
    approve(&mut env, approved);
    let owner = env.owner.insecure_clone();
    env.reject_request_as(&owner, approved, agent_key).unwrap();
    assert!(!env.exists(&approved));
}

#[test]
fn anyone_closes_a_request_after_it_expired() {
    let mut env = Env::new();
    let address = request(&mut env, 1);
    let stranger = env.stranger.insecure_clone();
    let agent_key = env.agent_key.pubkey();
    expect_error(
        env.expire_request_as(&stranger, address, agent_key),
        code(LeashError::RequestNotExpired),
    );
    env.warp(TTL - 1);
    expect_error(
        env.expire_request_as(&stranger, address, agent_key),
        code(LeashError::RequestNotExpired),
    );
    env.warp(1);
    let owner_key = env.owner.pubkey();
    expect_error(
        env.expire_request_as(&stranger, address, owner_key),
        code(LeashError::RequestMismatch),
    );
    let rent = env.lamports(&address);
    let before = env.lamports(&agent_key);
    let sent = env
        .expire_request_as(&stranger, address, agent_key)
        .unwrap();
    let expired = sent.events::<RequestExpired>();
    assert_eq!(
        (expired.len(), expired[0].request, expired[0].nonce),
        (1, address, 0)
    );
    assert!(!env.exists(&address));
    assert_eq!(env.lamports(&agent_key), before + rent);
    let agent: Agent = env.read(&env.agent);
    assert_eq!(agent.open_requests, 0);
}

#[test]
fn a_request_pays_only_the_exact_approved_payment() {
    let mut env = Env::new();
    let address = request(&mut env, 1);
    approve(&mut env, address);

    expect_error(
        env.pay_with_request(address, AMOUNT - 1, 1),
        code(LeashError::RequestMismatch),
    );
    expect_error(
        env.pay_with_request(address, AMOUNT, 2),
        code(LeashError::RequestMismatch),
    );

    // The request and its rent receiver come together, and the receiver is the rent payer.
    let base = env.pay_accounts(env.merchant_ata);
    let args = leash::PayArgs {
        amount: AMOUNT,
        reference: reference(1),
        memo: padded("A detailed market report"),
    };
    let owner_key = env.owner.pubkey();
    let agent_key = env.agent_key.pubkey();
    let cases = [
        (Some(address), None),
        (None, Some(agent_key)),
        (Some(address), Some(owner_key)),
    ];
    for (request, receiver) in cases {
        let accounts = leash::accounts::Pay {
            request,
            request_rent_receiver: receiver,
            ..env.pay_accounts(base.destination_token_account)
        };
        expect_error(
            env.pay_with(accounts, args),
            code(LeashError::RequestMismatch),
        );
    }

    // Another allowlisted payee cannot collect the merchant's approval.
    let attacker = env.attacker.pubkey();
    env.add_payee(attacker, merchant_limits()).unwrap();
    let accounts = leash::accounts::Pay {
        request: Some(address),
        request_rent_receiver: Some(agent_key),
        ..env.pay_accounts(env.attacker_ata)
    };
    expect_error(
        env.pay_with(accounts, args),
        code(LeashError::RequestMismatch),
    );

    // Expired approvals don't pay either.
    env.warp(TTL);
    expect_error(
        env.pay_with_request(address, AMOUNT, 1),
        code(LeashError::RequestExpired),
    );
    assert_eq!(env.token_balance(&env.merchant_ata), 0);
    assert_eq!(env.token_balance(&env.attacker_ata), 0);
}

#[test]
fn an_approved_request_still_respects_the_freeze_and_the_allowance() {
    let mut env = Env::new();
    let owner = env.owner.insecure_clone();
    let week = Policy {
        request_ttl_secs: 604_800,
        ..demo_policy()
    };
    env.update_policy_as(&owner, week).unwrap();
    let address = request(&mut env, 1);
    approve(&mut env, address);

    let guardian = env.guardian.insecure_clone();
    env.freeze_agent_as(&guardian).unwrap();
    expect_error(
        env.pay_with_request(address, AMOUNT, 1),
        code(LeashError::DeniedAgentFrozen),
    );
    env.unfreeze_agent_as(&owner).unwrap();

    // 3 USDC today already, so 2.5 more would pass the 5 USDC allowance (I1 holds for approvals).
    for _ in 0..3 {
        env.pay(USDC).unwrap();
    }
    expect_error(
        env.pay_with_request(address, AMOUNT, 1),
        code(LeashError::DeniedAllowanceExceeded),
    );
    assert!(env.exists(&address), "a failed payment keeps the request");
    env.warp(DAY);
    env.pay_with_request(address, AMOUNT, 1)
        .expect("the allowance renewed, the request is still live");
    assert!(!env.exists(&address));
}
