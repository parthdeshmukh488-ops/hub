//! Parity with `@leash/sdk`: every case of `packages/contracts/test-vectors/policy.json` against
//! the program's `evaluate`, outcome and effects (01-onchain-program §11.1). The SDK runs the
//! same file against its TypeScript evaluator.
//!
//! Symbolic key names map to the public keys of ed25519 keypairs whose 32-byte seed is
//! `sha256("leash:test-key:" + name)`, as in every harness. The paying agent is "agent" and the
//! other agent is "otherAgent", as in the SDK's test.

use std::collections::HashMap;

use anchor_lang::prelude::Pubkey;
use leash::{
    policy::{evaluate, EvalInput, PayeeEntryState, Rejection, RequestState},
    state::{AgentStatus, DenialReason, PayeeMode, Policy, RequestStatus},
    subscriptions::{DelegationState, RecurringState},
};
use serde::Deserialize;
use sha2::{Digest, Sha256};

const VECTORS: &str = include_str!("../../../packages/contracts/test-vectors/policy.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct VectorFile {
    version: u8,
    keys: HashMap<String, String>,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    now: i64,
    principal: PrincipalCase,
    agent: AgentCase,
    payee: Option<PayeeCase>,
    request: Option<RequestCase>,
    delegation: DelegationCase,
    source_amount: String,
    payment: PaymentCase,
    expect: Expect,
}

#[derive(Deserialize)]
struct PrincipalCase {
    frozen: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentCase {
    status: String,
    policy: PolicyCase,
    stats: StatsCase,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyCase {
    max_per_payment: String,
    max_per_request: String,
    payee_mode: String,
    velocity_max_payments: u16,
    velocity_window_secs: u32,
    tripwire_max_strikes: u8,
    tripwire_window_secs: u32,
    request_ttl_secs: u32,
    valid_until: Option<i64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatsCase {
    velocity_window_start: i64,
    velocity_count: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PayeeCase {
    agent: String,
    payee: String,
    max_per_payment: String,
    period_limit: String,
    period_secs: u32,
    period_start: i64,
    spent_in_period: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestCase {
    agent: String,
    status: String,
    payee: String,
    amount: String,
    reference: String,
    expires_at: i64,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum DelegationCase {
    #[serde(rename_all = "camelCase")]
    Recurring {
        amount_per_period: String,
        period_length_secs: u64,
        current_period_start: i64,
        pulled_in_period: String,
        expiry_ts: i64,
    },
    #[serde(rename_all = "camelCase")]
    Fixed {
        amount_remaining: String,
        expiry_ts: i64,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaymentCase {
    amount: String,
    destination_owner: String,
    reference: String,
}

#[derive(Deserialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
enum Expect {
    Allowed { effects: Option<EffectsCase> },
    Denied { reason: String },
    Error { error: String },
}

#[derive(Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EffectsCase {
    velocity_window_start: Option<i64>,
    velocity_count: Option<u16>,
    payee_period_start: Option<i64>,
    payee_spent_in_period: Option<String>,
    delegation_period_start: Option<i64>,
    delegation_pulled_in_period: Option<String>,
    delegation_amount_remaining: Option<String>,
}

/// The public key of the test keypair named `name`.
fn test_key(name: &str) -> Pubkey {
    let seed: [u8; 32] = Sha256::digest(format!("leash:test-key:{name}")).into();
    let public = ed25519_dalek::SigningKey::from_bytes(&seed).verifying_key();
    Pubkey::new_from_array(public.to_bytes())
}

fn amount(value: &str) -> u64 {
    value.parse().expect("u64 amount string")
}

fn reference(hex: &str) -> [u8; 32] {
    assert_eq!(hex.len(), 64, "reference must be 32 bytes of hex");
    let mut bytes = [0u8; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).expect("hex");
    }
    bytes
}

/// The JSON name of a denial reason (02-contracts §4): the variant in lowerCamelCase.
fn reason_name(reason: DenialReason) -> String {
    let debug = format!("{reason:?}");
    let mut chars = debug.chars();
    let first = chars.next().expect("variant name");
    first.to_lowercase().chain(chars).collect()
}

fn owner_key(owner: &str) -> Pubkey {
    match owner {
        "self" => test_key("agent"),
        "other" => test_key("otherAgent"),
        other => panic!("unknown owner {other}"),
    }
}

fn to_input(case: &Case) -> EvalInput {
    let policy = &case.agent.policy;
    EvalInput {
        now: case.now,
        principal_frozen: case.principal.frozen,
        agent: test_key("agent"),
        status: match case.agent.status.as_str() {
            "active" => AgentStatus::Active,
            "frozen" => AgentStatus::Frozen,
            other => panic!("unknown status {other}"),
        },
        policy: Policy {
            max_per_payment: amount(&policy.max_per_payment),
            max_per_request: amount(&policy.max_per_request),
            payee_mode: match policy.payee_mode.as_str() {
                "allowListOnly" => PayeeMode::AllowListOnly,
                "anyPayee" => PayeeMode::AnyPayee,
                other => panic!("unknown payee mode {other}"),
            },
            velocity_max_payments: policy.velocity_max_payments,
            velocity_window_secs: policy.velocity_window_secs,
            tripwire_max_strikes: policy.tripwire_max_strikes,
            tripwire_window_secs: policy.tripwire_window_secs,
            request_ttl_secs: policy.request_ttl_secs,
            valid_until: policy.valid_until.unwrap_or(0),
        },
        velocity_window_start: case.agent.stats.velocity_window_start,
        velocity_count: case.agent.stats.velocity_count,
        payee_entry: case.payee.as_ref().map(|payee| PayeeEntryState {
            agent: owner_key(&payee.agent),
            payee: test_key(&payee.payee),
            max_per_payment: amount(&payee.max_per_payment),
            period_limit: amount(&payee.period_limit),
            period_secs: payee.period_secs,
            period_start: payee.period_start,
            spent_in_period: amount(&payee.spent_in_period),
        }),
        request: case.request.as_ref().map(|request| RequestState {
            agent: owner_key(&request.agent),
            status: match request.status.as_str() {
                "pending" => RequestStatus::Pending,
                "approved" => RequestStatus::Approved,
                other => panic!("unknown request status {other}"),
            },
            payee: test_key(&request.payee),
            amount: amount(&request.amount),
            reference: reference(&request.reference),
            expires_at: request.expires_at,
        }),
        delegation: match &case.delegation {
            DelegationCase::Recurring {
                amount_per_period,
                period_length_secs,
                current_period_start,
                pulled_in_period,
                expiry_ts,
            } => DelegationState::Recurring(RecurringState {
                current_period_start: *current_period_start,
                period_length_s: *period_length_secs,
                expiry_ts: *expiry_ts,
                amount_per_period: amount(amount_per_period),
                pulled_in_period: amount(pulled_in_period),
            }),
            DelegationCase::Fixed {
                amount_remaining,
                expiry_ts,
            } => DelegationState::Fixed {
                amount_remaining: amount(amount_remaining),
                expiry_ts: *expiry_ts,
            },
        },
        source_amount: amount(&case.source_amount),
        amount: amount(&case.payment.amount),
        destination_owner: test_key(&case.payment.destination_owner),
        reference: reference(&case.payment.reference),
    }
}

/// Checks one case; returns a description of the mismatch, if any.
fn check(case: &Case) -> Option<String> {
    let result = evaluate(&to_input(case));
    match (&case.expect, result) {
        (Expect::Denied { reason }, Err(Rejection::Denied(actual))) => (reason_name(actual)
            != *reason)
            .then(|| format!("denied {actual:?}, expected {reason}")),
        (Expect::Error { error }, Err(Rejection::Error(actual))) => {
            (actual.name() != *error).then(|| format!("error {actual:?}, expected {error}"))
        }
        (Expect::Allowed { effects }, Ok(actual)) => {
            let expected = effects.clone().unwrap_or_default();
            let mut problems = Vec::new();
            let mut compare = |field: &str, expected: Option<String>, actual: Option<String>| {
                if let Some(expected) = expected {
                    if actual.as_deref() != Some(expected.as_str()) {
                        problems.push(format!("{field}: {actual:?}, expected {expected}"));
                    }
                }
            };
            let (period_start, pulled, remaining) = match actual.delegation {
                DelegationState::Recurring(state) => (
                    Some(state.current_period_start.to_string()),
                    Some(state.pulled_in_period.to_string()),
                    None,
                ),
                DelegationState::Fixed {
                    amount_remaining, ..
                } => (None, None, Some(amount_remaining.to_string())),
            };
            compare(
                "velocityWindowStart",
                expected.velocity_window_start.map(|v| v.to_string()),
                Some(actual.velocity.start.to_string()),
            );
            compare(
                "velocityCount",
                expected.velocity_count.map(|v| v.to_string()),
                Some(actual.velocity.counter.to_string()),
            );
            compare(
                "payeePeriodStart",
                expected.payee_period_start.map(|v| v.to_string()),
                actual.payee.map(|window| window.start.to_string()),
            );
            compare(
                "payeeSpentInPeriod",
                expected.payee_spent_in_period,
                actual.payee.map(|window| window.counter.to_string()),
            );
            compare(
                "delegationPeriodStart",
                expected.delegation_period_start.map(|v| v.to_string()),
                period_start,
            );
            compare(
                "delegationPulledInPeriod",
                expected.delegation_pulled_in_period,
                pulled,
            );
            compare(
                "delegationAmountRemaining",
                expected.delegation_amount_remaining,
                remaining,
            );
            if actual.consumes_request != case.request.is_some() {
                problems.push("consumesRequest differs from the request's presence".into());
            }
            (!problems.is_empty()).then(|| problems.join("; "))
        }
        (_, actual) => Some(format!("got {actual:?}")),
    }
}

#[test]
fn every_policy_vector_matches_the_program() {
    let file: VectorFile = serde_json::from_str(VECTORS).expect("policy.json parses");
    assert_eq!(file.version, 1);
    assert!(file.cases.len() >= 60, "expected at least 60 cases");
    for case in &file.cases {
        for name in [&case.payment.destination_owner]
            .into_iter()
            .chain(case.payee.as_ref().map(|p| &p.payee))
            .chain(case.request.as_ref().map(|r| &r.payee))
        {
            assert!(
                file.keys.contains_key(name),
                "{}: unknown key {name}",
                case.name
            );
        }
    }
    let failures: Vec<String> = file
        .cases
        .iter()
        .filter_map(|case| check(case).map(|problem| format!("{}: {problem}", case.name)))
        .collect();
    assert!(
        failures.is_empty(),
        "{} of {} vectors failed:\n{}",
        failures.len(),
        file.cases.len(),
        failures.join("\n")
    );
}

#[test]
fn every_denial_reason_and_error_in_the_vectors_is_reachable() {
    let file: VectorFile = serde_json::from_str(VECTORS).expect("policy.json parses");
    let denied: std::collections::HashSet<&str> = file
        .cases
        .iter()
        .filter_map(|case| match &case.expect {
            Expect::Denied { reason } => Some(reason.as_str()),
            _ => None,
        })
        .collect();
    for reason in DenialReason::ALL {
        assert!(
            denied.contains(reason_name(reason).as_str()),
            "no vector denies with {reason:?}"
        );
    }
}
