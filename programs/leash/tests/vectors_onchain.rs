//! Every case of `packages/contracts/test-vectors/policy.json` against the real program
//! (01-onchain-program §11.1). `tests/vectors.rs` runs the same file against the pure `evaluate`
//! on the host, and `@leash/sdk` against its TypeScript mirror; this suite proves the deployed
//! binary agrees with both.
//!
//! Each case's state is written into live accounts (principal, agent, allowlist entry, payment
//! request, Subscriptions delegation, the owner's balance, the clock), then the real `pay` runs,
//! with the real Subscriptions CPI for allowed cases. The outcome, the error code, and every
//! effect the case lists must match; a payment that fails must move nothing.

mod common;

use anchor_lang::{
    prelude::{AccountSerialize, Pubkey},
    Space,
};
use common::*;
use leash::{
    constants::REQUEST_SEED,
    errors::LeashError,
    state::{
        Agent, AgentStatus, FreezeReason, Payee, PayeeMode, PaymentRequest, Policy, Principal,
        RequestStatus,
    },
    PayArgs,
};
use serde_json::Value;
use solana_signer::Signer;

const VECTORS: &str = include_str!("../../../packages/contracts/test-vectors/policy.json");

fn amount(value: &Value) -> u64 {
    value
        .as_str()
        .expect("amounts are strings")
        .parse()
        .unwrap()
}

fn int(value: &Value) -> i64 {
    value.as_i64().expect("an integer")
}

fn bytes32(value: &Value) -> [u8; 32] {
    let hex = value.as_str().expect("hex");
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}

fn denial(name: &str) -> LeashError {
    match name {
        "principalFrozen" => LeashError::DeniedPrincipalFrozen,
        "agentFrozen" => LeashError::DeniedAgentFrozen,
        "agentExpired" => LeashError::DeniedAgentExpired,
        "payeeNotAllowed" => LeashError::DeniedPayeeNotAllowed,
        "exceedsPaymentLimit" => LeashError::DeniedExceedsPaymentLimit,
        "approvalRequired" => LeashError::DeniedApprovalRequired,
        "exceedsPayeePaymentLimit" => LeashError::DeniedExceedsPayeePaymentLimit,
        "exceedsPayeePeriodLimit" => LeashError::DeniedExceedsPayeePeriodLimit,
        "velocityExceeded" => LeashError::DeniedVelocityExceeded,
        "allowanceExpired" => LeashError::DeniedAllowanceExpired,
        "allowanceExceeded" => LeashError::DeniedAllowanceExceeded,
        "insufficientFunds" => LeashError::DeniedInsufficientFunds,
        other => panic!("unknown denial {other}"),
    }
}

fn error(name: &str) -> LeashError {
    match name {
        "InvalidAmount" => LeashError::InvalidAmount,
        "RequestMismatch" => LeashError::RequestMismatch,
        "RequestNotApproved" => LeashError::RequestNotApproved,
        "RequestExpired" => LeashError::RequestExpired,
        "UnsupportedDelegation" => LeashError::UnsupportedDelegation,
        "MathOverflow" => LeashError::MathOverflow,
        other => panic!("unknown error {other}"),
    }
}

fn policy(view: &Value) -> Policy {
    Policy {
        max_per_payment: amount(&view["maxPerPayment"]),
        max_per_request: amount(&view["maxPerRequest"]),
        payee_mode: match view["payeeMode"].as_str().unwrap() {
            "allowListOnly" => PayeeMode::AllowListOnly,
            _ => PayeeMode::AnyPayee,
        },
        velocity_max_payments: int(&view["velocityMaxPayments"]) as u16,
        velocity_window_secs: int(&view["velocityWindowSecs"]) as u32,
        tripwire_max_strikes: int(&view["tripwireMaxStrikes"]) as u8,
        tripwire_window_secs: int(&view["tripwireWindowSecs"]) as u32,
        request_ttl_secs: int(&view["requestTtlSecs"]) as u32,
        valid_until: view["validUntil"].as_i64().unwrap_or(0),
    }
}

/// The paying agent ("self") or a second agent of the same owner ("other").
fn agent_for(env: &mut Env, who: &str) -> Pubkey {
    if who == "self" {
        return env.agent;
    }
    let key = test_key("otherAgent").pubkey();
    let address = agent_pda(&env.principal, &key);
    if !env.exists(&address) {
        env.create_agent(key, demo_policy()).unwrap();
    }
    address
}

/// Writes a Leash account that no instruction can produce in this state.
fn put_leash_account<T: AccountSerialize + Space>(env: &mut Env, address: Pubkey, value: &T) {
    let mut data = Vec::with_capacity(8 + T::INIT_SPACE);
    value.try_serialize(&mut data).unwrap();
    env.put_account(address, leash::ID, data);
}

fn run(case: &Value) {
    let name = case["name"].as_str().unwrap();
    let now = int(&case["now"]);
    let delegation = &case["delegation"];
    let fixed = delegation["kind"] == "fixed";
    let allowance = if fixed {
        Allowance::Fixed {
            amount: 1,
            expiry_ts: 0,
        }
    } else {
        Allowance::Recurring {
            amount_per_period: 1,
            period_length_s: 86_400,
            start_ts: NOW,
            expiry_ts: 0,
        }
    };
    let mut env = Env::setup(Setup {
        allowance,
        merchant: None,
        ..Setup::default()
    });

    // The principal and the agent.
    if case["principal"]["frozen"].as_bool().unwrap() {
        let mut principal: Principal = env.read(&env.principal);
        principal.frozen = true;
        principal.frozen_at = now;
        principal.frozen_by = env.owner.pubkey();
        env.write(&env.principal.clone(), &principal);
    }
    let vector_agent = &case["agent"];
    let mut agent: Agent = env.read(&env.agent);
    if vector_agent["status"] == "frozen" {
        agent.status = AgentStatus::Frozen;
        agent.freeze_reason = FreezeReason::Owner;
        agent.frozen_at = now;
    }
    agent.policy = policy(&vector_agent["policy"]);
    let stats = &vector_agent["stats"];
    agent.stats.velocity_window_start = int(&stats["velocityWindowStart"]);
    agent.stats.velocity_count = int(&stats["velocityCount"]) as u16;
    agent.stats.strike_window_start = int(&stats["strikeWindowStart"]);
    agent.stats.strikes = int(&stats["strikes"]) as u8;
    if !case["request"].is_null() {
        agent.open_requests = 1; // the request below is live
    }
    env.write(&env.agent.clone(), &agent);

    // The allowlist entry, as found (it may belong to another agent or name another payee).
    let entry = if case["payee"].is_null() {
        None
    } else {
        let vector_entry = &case["payee"];
        let owner_agent = agent_for(&mut env, vector_entry["agent"].as_str().unwrap());
        let payee = test_key(vector_entry["payee"].as_str().unwrap()).pubkey();
        env.add_payee_for(owner_agent, payee, merchant_limits())
            .unwrap();
        let address = payee_pda(&owner_agent, &payee);
        let mut stored: Payee = env.read(&address);
        stored.max_per_payment = amount(&vector_entry["maxPerPayment"]);
        stored.period_limit = amount(&vector_entry["periodLimit"]);
        stored.period_secs = int(&vector_entry["periodSecs"]) as u32;
        stored.period_start = int(&vector_entry["periodStart"]);
        stored.spent_in_period = amount(&vector_entry["spentInPeriod"]);
        env.write(&address, &stored);
        Some(address)
    };

    // The payment request, as found.
    let request = if case["request"].is_null() {
        None
    } else {
        let vector_request = &case["request"];
        let owner_agent = agent_for(&mut env, vector_request["agent"].as_str().unwrap());
        let (address, bump) = Pubkey::find_program_address(
            &[REQUEST_SEED, owner_agent.as_ref(), &0u64.to_le_bytes()],
            &leash::ID,
        );
        let approved = vector_request["status"] == "approved";
        let stored = PaymentRequest {
            version: 1,
            bump,
            agent: owner_agent,
            nonce: 0,
            payee: test_key(vector_request["payee"].as_str().unwrap()).pubkey(),
            amount: amount(&vector_request["amount"]),
            reference: bytes32(&vector_request["reference"]),
            memo: [0; 64],
            status: if approved {
                RequestStatus::Approved
            } else {
                RequestStatus::Pending
            },
            created_at: now - 60,
            expires_at: int(&vector_request["expiresAt"]),
            approved_at: if approved { now - 30 } else { 0 },
            rent_payer: env.agent_key.pubkey(),
            reserved: [0; 32],
        };
        put_leash_account(&mut env, address, &stored);
        Some(address)
    };

    // The Subscriptions delegation's live fields.
    let mut data = env.data(&env.delegation);
    let mut put = |offset: usize, value: [u8; 8]| data[offset..offset + 8].copy_from_slice(&value);
    if fixed {
        put(171, amount(&delegation["amountRemaining"]).to_le_bytes());
        put(179, int(&delegation["expiryTs"]).to_le_bytes());
    } else {
        put(171, int(&delegation["currentPeriodStart"]).to_le_bytes());
        put(
            179,
            (int(&delegation["periodLengthSecs"]) as u64).to_le_bytes(),
        );
        put(187, int(&delegation["expiryTs"]).to_le_bytes());
        put(195, amount(&delegation["amountPerPeriod"]).to_le_bytes());
        put(203, amount(&delegation["pulledInPeriod"]).to_le_bytes());
    }
    let mut account = env.svm.get_account(&env.delegation).unwrap();
    account.data = data;
    env.svm.set_account(env.delegation, account).unwrap();

    // The owner's balance, the clock, and the payment.
    let owner = env.owner.pubkey();
    let owner_ata = env.owner_ata;
    env.set_token_balance(owner_ata, &owner, amount(&case["sourceAmount"]));
    env.set_time(now);
    let payment = &case["payment"];
    let destination_owner = test_key(payment["destinationOwner"].as_str().unwrap()).pubkey();
    let destination = if destination_owner == env.merchant.pubkey() {
        env.merchant_ata
    } else {
        env.attacker_ata
    };
    let accounts = leash::accounts::Pay {
        payee_entry: entry,
        request,
        request_rent_receiver: request.map(|_| env.agent_key.pubkey()),
        ..env.pay_accounts(destination)
    };
    let pay_amount = amount(&payment["amount"]);
    let args = PayArgs {
        amount: pay_amount,
        reference: bytes32(&payment["reference"]),
        memo: [0; 64],
    };
    let destination_before = env.token_balance(&destination);
    let owner_before = env.token_balance(&owner_ata);
    let result = env.pay_with(accounts, args);

    let expect = &case["expect"];
    match expect["outcome"].as_str().unwrap() {
        "allowed" => {
            if let Err(failure) = &result {
                panic!(
                    "{name}: expected allowed, got {:?}\n{}",
                    failure.err,
                    failure.meta.pretty_logs()
                );
            }
            assert_eq!(
                env.token_balance(&destination),
                destination_before + pay_amount,
                "{name}"
            );
            assert_eq!(
                env.token_balance(&owner_ata),
                owner_before - pay_amount,
                "{name}"
            );
            let effects = &expect["effects"];
            if effects.is_object() {
                let stored: Agent = env.read(&env.agent);
                if let Some(start) = effects["velocityWindowStart"].as_i64() {
                    assert_eq!(stored.stats.velocity_window_start, start, "{name}");
                }
                if let Some(count) = effects["velocityCount"].as_i64() {
                    assert_eq!(i64::from(stored.stats.velocity_count), count, "{name}");
                }
                if let Some(entry) = entry {
                    let stored: Payee = env.read(&entry);
                    if let Some(start) = effects["payeePeriodStart"].as_i64() {
                        assert_eq!(stored.period_start, start, "{name}");
                    }
                    if !effects["payeeSpentInPeriod"].is_null() {
                        assert_eq!(
                            stored.spent_in_period,
                            amount(&effects["payeeSpentInPeriod"]),
                            "{name}"
                        );
                    }
                }
                if fixed {
                    if !effects["delegationAmountRemaining"].is_null() {
                        let remaining = amount(&effects["delegationAmountRemaining"]);
                        assert_eq!(env.fixed_remaining(&env.delegation), remaining, "{name}");
                    }
                } else {
                    let (start, pulled) = env.recurring_state(&env.delegation);
                    if let Some(expected) = effects["delegationPeriodStart"].as_i64() {
                        assert_eq!(start, expected, "{name}");
                    }
                    if !effects["delegationPulledInPeriod"].is_null() {
                        assert_eq!(
                            pulled,
                            amount(&effects["delegationPulledInPeriod"]),
                            "{name}"
                        );
                    }
                }
            }
        }
        outcome => {
            let expected = if outcome == "denied" {
                denial(expect["reason"].as_str().unwrap())
            } else {
                error(expect["error"].as_str().unwrap())
            };
            match result {
                Ok(_) => panic!("{name}: expected {expected:?}, but the payment went through"),
                Err(failure) => assert_eq!(
                    error_code(&failure),
                    Some(code(expected)),
                    "{name}: {:?}\n{}",
                    failure.err,
                    failure.meta.pretty_logs()
                ),
            }
            assert_eq!(
                env.token_balance(&destination),
                destination_before,
                "{name}"
            );
            assert_eq!(env.token_balance(&owner_ata), owner_before, "{name}");
        }
    }
}

#[test]
fn every_policy_vector_holds_on_the_real_program() {
    let file: Value = serde_json::from_str(VECTORS).unwrap();
    let cases = file["cases"].as_array().unwrap();
    assert!(cases.len() >= 60);
    for case in cases {
        run(case);
    }
}
